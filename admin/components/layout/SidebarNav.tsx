'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '⌂' },
  { href: '/moderation', label: 'Moderation', icon: '⚑' },
  { href: '/config', label: 'Config', icon: '⊞' },
  { href: '/audit', label: 'Audit log', icon: '◎' },
];

export function SidebarNav({
  email,
  open,
  onClose,
}: {
  email: string;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Overlay (mobile) */}
      <div
        className={`sidebar-overlay ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-wordmark">
          <span className="sidebar-wordmark-text">Pappal</span>
          <span
            style={{
              fontSize: '0.6875rem',
              background: 'rgba(242,84,61,0.22)',
              color: '#ff7c68',
              borderRadius: '4px',
              padding: '0.1rem 0.35rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            ADMIN
          </span>
        </div>

        <div className="sidebar-user">
          <p className="sidebar-user-email" title={email}>
            {email}
          </p>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV.map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className={`sidebar-nav-item ${isActive(href) ? 'active' : ''}`}
              onClick={onClose}
            >
              <span aria-hidden="true" style={{ fontSize: '0.9375rem', lineHeight: 1 }}>
                {icon}
              </span>
              {label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <form action="/auth/signout" method="post">
            <button type="submit" className="sidebar-signout-btn">
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
