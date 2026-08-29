import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

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

  const { data: allowed } = await svc
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const userAgent = request.headers.get('user-agent') ?? '';

  const { error } = await svc.schema('admin').from('admin_sessions').insert({
    email: user.email,
    reauth_at: new Date().toISOString(),
    user_agent: userAgent,
  });

  if (error != null) {
    console.error('Reauth insert error:', error.message);
    return NextResponse.json({ error: 'Failed to record reauth' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, reauth_at: new Date().toISOString() });
}
