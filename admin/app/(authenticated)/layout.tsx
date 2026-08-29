import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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

  // Defence-in-depth allowlist check beyond middleware.
  const { data: allowed } = await createServiceClient()
    .schema('admin')
    .from('founder_allowlist')
    .select('email, role')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    redirect('/login?error=unauthorized');
  }

  return <AppShell email={user.email}>{children}</AppShell>;
}
