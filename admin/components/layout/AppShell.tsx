'use client';

import { useState } from 'react';
import { List as Menu } from '@phosphor-icons/react/dist/ssr';
import { SidebarNav } from './SidebarNav';
import { Button } from '@/components/ui/button';

interface AppShellProps {
  email: string;
  children: React.ReactNode;
}

export function AppShell({ email, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      {/* Mobile header (visible <769px) */}
      <header className="mobile-header">
        <Button
          variant="ghost"
          size="icon"
          className="text-white/70 hover:text-white hover:bg-white/10 -ml-1"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <Menu size={20} aria-hidden="true" />
        </Button>
        <span className="text-white font-semibold text-sm">Pappal Admin</span>
      </header>

      <SidebarNav email={email} open={navOpen} onClose={() => setNavOpen(false)} />

      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
    </div>
  );
}
