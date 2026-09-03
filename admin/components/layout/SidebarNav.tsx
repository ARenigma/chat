'use client';

import { usePathname } from 'next/navigation';
import { LayoutDashboard, Flag, Settings, ScrollText, LogOut, Users, Wallet } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PendingLink } from '@/components/ui/pending-link';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/applications', label: 'Applications', icon: Users },
  { href: '/payouts', label: 'Payouts', icon: Wallet },
  { href: '/moderation', label: 'Moderation', icon: Flag },
  { href: '/config', label: 'Config', icon: Settings },
  { href: '/audit', label: 'Audit log', icon: ScrollText },
] as const;

function NavItems({ onClose, pathname }: { onClose?: () => void; pathname: string }) {
  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Main navigation">
      {NAV.map(({ href, label, icon: Icon }) => (
        <PendingLink
          key={href}
          href={href}
          onClick={onClose}
          className={cn('sidebar-nav-item', isActive(href) && 'active')}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </PendingLink>
      ))}
    </nav>
  );
}

interface SidebarNavProps {
  email: string;
  open: boolean;
  onClose: () => void;
}

export function SidebarNav({ email, open, onClose }: SidebarNavProps) {
  const pathname = usePathname();

  const content = (
    <>
      <div className="flex items-center gap-2 px-4 py-4 border-b border-white/10">
        <span className="text-white font-bold text-base tracking-tight">Pappal</span>
        <span className="text-[10px] font-bold bg-[rgba(242,84,61,0.22)] text-[#ff7c68] px-1.5 py-0.5 rounded tracking-widest uppercase">
          ADMIN
        </span>
      </div>

      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-xs text-white/45 truncate" title={email}>{email}</p>
      </div>

      <div className="flex-1 py-3">
        <NavItems onClose={onClose} pathname={pathname} />
      </div>

      <div className="px-3 py-3 border-t border-white/10">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-white/50 hover:text-white/80 hover:bg-white/6 transition-colors min-h-[44px]"
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar (always visible ≥769px) */}
      <aside className="sidebar hidden md:flex flex-col">{content}</aside>

      {/* Mobile sheet */}
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="left" className="w-[var(--sidebar-width)] bg-[var(--bg-inverse)] p-0 flex flex-col">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    </>
  );
}
