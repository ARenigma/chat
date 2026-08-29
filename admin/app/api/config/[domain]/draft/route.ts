import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/config/[domain]/draft
// Saves a new draft version for the given config domain.
// Server-only: uses service_role to write into admin.config_versions.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const { domain } = await params;

  // Verify caller has a valid session.
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();

  // Confirm allowlist membership (defence in depth; middleware also checks).
  const { data: allowed } = await svc
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Validate domain exists.
  const { data: domainRow } = await svc
    .schema('admin')
    .from('config_domains')
    .select('key')
    .eq('key', domain)
    .maybeSingle();

  if (domainRow == null) {
    return NextResponse.json({ error: 'Unknown domain' }, { status: 404 });
  }

  // Parse and validate payload.
  let body: { payload?: unknown };
  try {
    body = (await request.json()) as { payload?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.payload == null || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'payload must be a JSON object' }, { status: 400 });
  }

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

  // Audit record.
  await svc.schema('admin').from('config_audit').insert({
    action: 'draft_created',
    domain,
    version_id: (newVersion as { id: string }).id,
    actor: user.email,
    reason: `Draft v${nextVersion} created by ${user.email}`,
  });

  return NextResponse.json({ id: (newVersion as { id: string }).id, version_number: nextVersion });
}
