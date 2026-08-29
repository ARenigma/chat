import { type CookieOptions } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// OAuth callback: exchanges the code for a Supabase session and redirects to
// the authenticated dashboard. Also records a fresh admin_sessions reauth_at
// row so the publish route can verify re-authentication server-side.
// https://supabase.com/docs/guides/auth/server-side/nextjs
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>
        ) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error, data } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('OAuth exchange error:', error.message);
    return NextResponse.redirect(`${origin}/login?error=auth_error`);
  }

  // Record a server-side reauth_at entry so the publish flow can
  // verify the user authenticated recently without trusting client timestamps.
  if (data.user?.email) {
    const svc = createServiceClient();
    try {
      await svc.schema('admin').from('admin_sessions').insert({
        email: data.user.email,
        reauth_at: new Date().toISOString(),
        user_agent: request.headers.get('user-agent') ?? '',
      });
    } catch {
      // Non-fatal: publish will reject if reauth record is missing.
    }
  }

  return response;
}
