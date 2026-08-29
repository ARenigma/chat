import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/moderation', label: 'Moderation' },
  { href: '/config', label: 'Config' },
  { href: '/audit', label: 'Audit Log' },
] as const;

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

  // Server-side allowlist check — defence in depth beyond middleware.
  const { data: allowed } = await createServiceClient()
    .schema('admin')
    .from('founder_allowlist')
    .select('email, role')
    .eq('email', user.email)
    .maybeSingle();

  if (!allowed) {
    redirect('/login?error=unauthorized');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: '220px',
          flexShrink: 0,
          background: 'var(--bg-inverse)',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem 0',
        }}
      >
        <div
          style={{
            padding: '0 1.25rem 1.5rem',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>
            Pappal Admin
          </span>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'rgba(255,255,255,0.45)',
              marginTop: '0.25rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.email}
          </p>
        </div>

        <nav style={{ flex: 1, padding: '1rem 0' }}>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              style={{
                display: 'block',
                padding: '0.625rem 1.25rem',
                color: 'rgba(255,255,255,0.8)',
                fontSize: '0.875rem',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>{children}</main>
    </div>
  );
}
