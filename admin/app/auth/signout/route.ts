import { createSessionClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// POST /auth/signout
// Clears the Supabase session cookie and redirects to login.
export async function POST() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001'), {
    status: 302,
  });
}
