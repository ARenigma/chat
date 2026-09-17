import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';
import { founderAllowlistRow } from '@/lib/auth/founder';
import { AppShell } from '@/components/layout/AppShell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSessionClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect('/login');
  }

  // Defence-in-depth allowlist check beyond middleware. See
  // admin/lib/auth/founder.ts: this also requires a verified Google identity,
  // not just an email match.
  const allowed = await founderAllowlistRow(user);

  if (!allowed) {
    redirect('/login?error=unauthorized');
  }

  return <AppShell email={user.email}>{children}</AppShell>;
}
