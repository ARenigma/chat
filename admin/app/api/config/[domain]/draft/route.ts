import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDomain, validatePayload } from '@/lib/config-registry';

// POST /api/config/[domain]/draft
// Saves or replaces the current draft version for the given config domain.
// Any existing draft for this domain is superseded; only one draft exists at a time.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();

  const { data: allowed } = await svc
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: domainRow } = await svc
    .schema('admin')
    .from('config_domains')
    .select('key')
    .eq('key', domain)
    .maybeSingle();

  if (domainRow == null) {
    return NextResponse.json({ error: 'Unknown domain' }, { status: 404 });
  }

  let body: { payload?: unknown };
  try {
    body = (await request.json()) as { payload?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.payload == null || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'payload must be a JSON object' }, { status: 400 });
  }

  // Server-side validation via registry.
  const domainDef = getDomain(domain);
  if (domainDef) {
    const errors = validatePayload(domainDef, body.payload as Record<string, unknown>);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: `Validation failed: ${errors[0]}`, details: errors },
        { status: 422 }
      );
    }
  }

  // Remove any existing draft (one draft at a time per domain).
  await svc
    .schema('admin')
    .from('config_versions')
    .update({ status: 'superseded', superseded_at: new Date().toISOString() })
    .eq('domain', domain)
    .eq('environment', 'prod')
    .eq('status', 'draft');

  // Determine next version number.
  const { data: maxRow } = await svc
    .schema('admin')
    .from('config_versions')
    .select('version_number')
    .eq('domain', domain)
    .eq('environment', 'prod')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = ((maxRow as { version_number?: number } | null)?.version_number ?? 0) + 1;

  const payloadText = JSON.stringify(body.payload);
  const msgBuffer = new TextEncoder().encode(payloadText);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const payloadSha256 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const { data: newVersion, error: insertError } = await svc
    .schema('admin')
    .from('config_versions')
    .insert({
      domain,
      environment: 'prod',
      version_number: nextVersion,
      status: 'draft',
      payload: body.payload,
      payload_sha256: payloadSha256,
      created_by: user.email,
    })
    .select('id')
    .single();

  if (insertError != null) {
    console.error('Draft insert error:', insertError.message);
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 });
  }

  await svc.schema('admin').from('config_audit').insert({
    action: 'draft_created',
    domain,
    version_id: (newVersion as { id: string }).id,
    actor: user.email,
    reason: `Draft v${nextVersion} created by ${user.email}`,
  });

  return NextResponse.json({ id: (newVersion as { id: string }).id, version_number: nextVersion });
}
