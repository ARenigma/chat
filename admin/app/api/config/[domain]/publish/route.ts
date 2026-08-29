import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const REQUIRED_PHRASE = 'publish to production';
const REAUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// POST /api/config/[domain]/publish
// Atomically promotes a draft version to active.
//
// Required body fields:
//   draft_version_id    — UUID of the draft to promote
//   confirmation_phrase — must equal "publish to production"
//   reason              — non-empty string
//   reauth_timestamp    — ISO timestamp; must be within 15 minutes
//
// Implementation notes:
//   • Supersedes the current active version before activating the draft, so
//     the partial unique index (config_versions_one_active) is never violated.
//   • Refreshes config_active so billing RPCs see the new payload immediately.
//   • Writes an immutable audit record.
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

  let body: {
    draft_version_id?: string;
    confirmation_phrase?: string;
    reason?: string;
    reauth_timestamp?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate confirmation phrase.
  if (body.confirmation_phrase !== REQUIRED_PHRASE) {
    return NextResponse.json({ error: 'Confirmation phrase does not match' }, { status: 400 });
  }

  // Validate reason.
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  }

  // Validate reauth timestamp (must be within 15 minutes).
  if (!body.reauth_timestamp) {
    return NextResponse.json({ error: 'reauth_timestamp is required' }, { status: 400 });
  }
  const reauthAt = new Date(body.reauth_timestamp);
  if (Number.isNaN(reauthAt.getTime()) || Date.now() - reauthAt.getTime() > REAUTH_WINDOW_MS) {
    return NextResponse.json(
      { error: 'reauth_timestamp is older than 15 minutes; re-authenticate and retry' },
      { status: 403 }
    );
  }

  if (!body.draft_version_id) {
    return NextResponse.json({ error: 'draft_version_id is required' }, { status: 400 });
  }

  // Load the draft version.
  const { data: draftVersion } = await svc
    .schema('admin')
    .from('config_versions')
    .select('id, domain, environment, version_number, status, payload')
    .eq('id', body.draft_version_id)
    .eq('domain', domain)
    .eq('environment', 'prod')
    .maybeSingle();

  if (draftVersion == null) {
    return NextResponse.json({ error: 'Draft version not found' }, { status: 404 });
  }
  const draft = draftVersion as {
    id: string;
    domain: string;
    environment: string;
    version_number: number;
    status: string;
    payload: unknown;
  };
  if (draft.status !== 'draft') {
    return NextResponse.json({ error: `Version is ${draft.status}, not draft` }, { status: 409 });
  }

  const now = new Date().toISOString();

  // 1. Supersede current active version.
  await svc
    .schema('admin')
    .from('config_versions')
    .update({ status: 'superseded', superseded_at: now })
    .eq('domain', domain)
    .eq('environment', 'prod')
    .eq('status', 'active');

  // 2. Activate the draft.
  const { error: activateError } = await svc
    .schema('admin')
    .from('config_versions')
    .update({
      status: 'active',
      published_by: user.email,
      published_at: now,
      publish_reason: body.reason.trim(),
    })
    .eq('id', draft.id);

  if (activateError != null) {
    console.error('Activate error:', activateError.message);
    return NextResponse.json({ error: 'Failed to activate version' }, { status: 500 });
  }

  // 3. Refresh config_active projection.
  await svc
    .schema('admin')
    .from('config_active')
    .upsert(
      {
        domain,
        environment: 'prod',
        version_id: draft.id,
        payload: draft.payload,
        effective_from: now,
        updated_at: now,
      },
      { onConflict: 'domain,environment' }
    );

  // 4. Immutable audit record.
  await svc.schema('admin').from('config_audit').insert({
    action: 'promoted_prod',
    domain,
    version_id: draft.id,
    actor: user.email,
    reason: body.reason.trim(),
    confirmation: REQUIRED_PHRASE,
  });

  return NextResponse.json({ ok: true, version_number: draft.version_number });
}
