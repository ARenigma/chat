import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { founderAllowlistRow } from '@/lib/auth/founder';

// POST /api/auth/reauth
// Records a fresh reauth_at timestamp in admin.admin_sessions.
// Called client-side after a re-authentication Google sign-in, before a
// high-risk action (e.g. promoting a config version to production).
export async function POST(request: NextRequest) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const svc = createServiceClient();

  // Requires a verified Google identity, not just an email match — see
  // admin/lib/auth/founder.ts. This route matters more than most: it is what
  // stamps the reauth_at row that /api/config/[domain]/publish trusts as
  // proof of a fresh Google sign-in, so a weak gate here would have let a
  // hijacked session manufacture its own "recently reauthenticated" record.
  const allowed = await founderAllowlistRow(user);

  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userAgent = request.headers.get('user-agent') ?? '';

  // `allowed.email`, not `user.email`: it is the lowercase-normalised value
  // migration 114 requires, and admin_sessions.email is a foreign key into
  // founder_allowlist(email) — inserting the session's own casing would
  // violate that FK the moment Google returns anything but lowercase.
  const { error } = await svc.schema('admin').from('admin_sessions').insert({
    email: allowed.email,
    reauth_at: new Date().toISOString(),
    user_agent: userAgent,
  });

  if (error != null) {
    console.error('Reauth insert error:', error.message);
    return NextResponse.json({ error: 'Failed to record reauth' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reauth_at: new Date().toISOString() });
}
