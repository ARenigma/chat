'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { useTheme } from 'next-themes';
import {
  CaretDown,
  CaretRight,
  MagnifyingGlass,
  Moon,
  NotePencil,
  SignOut,
  Sun,
} from '@phosphor-icons/react/dist/ssr';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PendingLink } from '@/components/ui/pending-link';
import { Kbd } from '@/components/ui/kbd';
import { Avatar } from '@/components/ui/property';
import { useShell } from '@/components/layout/shell-context';
import { isActive, type NavGroup } from '@/components/layout/nav';
import { cn } from '@/lib/utils';

const EASE = [0.23, 1, 0.32, 1] as const;

function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-5 items-center justify-center rounded-[5px] bg-accent text-[11px] leading-none font-bold text-on-accent', className)}
    >
      P
    </span>
  );
}

function NavSection({ group, pathname, onNavigate }: { group: NavGroup; pathname: string; onNavigate?: () => void }) {
  const [open, setOpen] = React.useState(true);
  const id = React.useId();
  return (
    <div className="flex flex-col gap-px">
      {group.label && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="group/label flex h-7 items-center gap-1 rounded-sm px-2 text-left text-xs font-medium text-secondary transition-colors hover:text-primary"
        >
          {group.label}
          <span className="text-quaternary transition-colors group-hover/label:text-secondary">
            {open ? <CaretDown size={9} weight="fill" /> : <CaretRight size={9} weight="fill" />}
          </span>
        </button>
      )}
      {open && (
        <ul id={id} className="flex flex-col gap-px">
          {group.items.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <li key={href}>
                <PendingLink
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-7 w-full items-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors duration-100',
                    active ? 'text-primary' : 'text-body hover:bg-hover hover:text-primary'
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-sm bg-selected"
                      transition={{ duration: 0.15, ease: EASE }}
                    />
                  )}
                  <Icon size={16} aria-hidden="true" className={cn('relative shrink-0', active ? 'text-accent-fg' : 'text-secondary')} />
                  <span className="relative truncate">{label}</span>
                </PendingLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SidebarBody({ email, onNavigate }: { email: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { nav, setCommandOpen, newItem } = useShell();
  const { resolvedTheme, setTheme } = useTheme();
  // Read after mount: the server cannot know the platform, so reading it during render
  // would print "Ctrl" on the server and "⌘" on a Mac client and trip a hydration warning.
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Workspace header */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-3.5">
        <BrandMark />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em] text-primary">Pappal Admin</span>
        {newItem && (
          <Link
            href={newItem.href}
            onClick={onNavigate}
            aria-label={newItem.label}
            title={newItem.label}
            className="inline-flex size-7 items-center justify-center rounded-full border border-hairline-strong bg-raised text-secondary transition-colors hover:bg-selected hover:text-primary"
          >
            <NotePencil size={16} aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Search / command */}
      <div className="px-2.5 pb-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            setCommandOpen(true);
          }}
          className="flex h-7 w-full items-center gap-2 rounded-sm bg-hover px-2 text-sm text-secondary transition-colors hover:bg-selected hover:text-primary"
        >
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="flex-1 text-left">Search</span>
          <Kbd aria-hidden="true">{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd aria-hidden="true" className="-ml-1">K</Kbd>
        </button>
      </div>

      <nav aria-label="Main navigation" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pt-2 pb-3">
        {nav.map((g, i) => (
          <NavSection key={g.label ?? i} group={g} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* User */}
      <div className="shrink-0 p-2.5">
        <form id="signout-form" action="/auth/signout" method="post" className="hidden" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-body transition-colors hover:bg-hover data-[state=open]:bg-hover"
            >
              <Avatar name={email} />
              <span className="min-w-0 flex-1 truncate" title={email}>{email}</span>
              <CaretDown size={10} weight="fill" className="text-quaternary" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel className="truncate text-xs font-normal text-secondary">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')}>
              {resolvedTheme === 'light' ? <Moon /> : <Sun />}
              {resolvedTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (document.getElementById('signout-form') as HTMLFormElement | null)?.requestSubmit()}>
              <SignOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface SidebarNavProps {
  email: string;
}

export function SidebarNav({ email }: SidebarNavProps) {
  const { navOpen, setNavOpen } = useShell();
  return (
    <>
      {/* Desktop: sits directly on the shell, no divider. */}
      <aside className="hidden w-(--sidebar-width) shrink-0 bg-sidebar md:block">
        <SidebarBody email={email} />
      </aside>

      {/* Mobile: the same content in a Sheet. */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-(--sidebar-width) max-w-[85vw] gap-0 bg-sidebar p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarBody email={email} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
