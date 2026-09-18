import { type CookieOptions } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { founderAllowlistRow } from '@/lib/auth/founder';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes: skip auth entirely.
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return NextResponse.next();
  }

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Read the session from cookies via the anon client.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (
          cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>
        ) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Defense in depth: check the founder allowlist on every request. The
  // admin schema is RLS-restricted; service_role bypasses it. This is a
  // server-side check — the service key never reaches the client.
  //
  // The check is `founderAllowlistRow`, not a bare email match: a session
  // authorises admin access only when Google itself vouches for the
  // identity. See admin/lib/auth/founder.ts for why a mutable email column
  // by itself was not enough (2026-09-17 audit).
  const allowed = await founderAllowlistRow(user);

  if (!allowed) {
    return NextResponse.redirect(new URL('/login?error=unauthorized', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
