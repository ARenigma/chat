'use client';

import { useState } from 'react';
import { SidebarNav } from './SidebarNav';

interface AppShellProps {
  email: string;
  children: React.ReactNode;
}

export function AppShell({ email, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app-shell">
      {/* Mobile header */}
      <header className="mobile-header">
        <button
          className="mobile-hamburger"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? (
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" fill="none" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <span className="mobile-header-title">Pappal Admin</span>
      </header>

      <SidebarNav email={email} open={navOpen} onClose={() => setNavOpen(false)} />

      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
    </div>
  );
}
