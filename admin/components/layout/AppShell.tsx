'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { List as MenuIcon } from '@phosphor-icons/react/dist/ssr';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { CommandMenu } from '@/components/layout/CommandMenu';
import { ShellProvider, useShell, type Crumb } from '@/components/layout/shell-context';
import { isActive, type NavGroup } from '@/components/layout/nav';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

interface AppShellProps {
  email: string;
  children: React.ReactNode;
  /** Override the sidebar navigation (the design preview uses its own). */
  nav?: NavGroup[];
  /** Optional new-item button in the sidebar header. */
  newItem?: { href: string; label: string };
}

/** Automatic breadcrumb from the path: nav label of the longest matching item, then raw segments. */
function autoCrumbs(pathname: string, nav: NavGroup[]): Crumb[] {
  const items = nav.flatMap((g) => g.items).filter((n) => isActive(pathname, n.href, n.exact));
  const root = items.sort((a, b) => b.href.length - a.href.length)[0];
  if (!root) return [{ label: decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? 'Dashboard') }];
  const rest = pathname.slice(root.href === '/' ? 0 : root.href.length).split('/').filter(Boolean);
  const out: Crumb[] = [{ label: root.label, href: rest.length ? root.href : undefined }];
  rest.forEach((s, i) => {
    const last = i === rest.length - 1;
    out.push({ label: decodeURIComponent(s), href: last ? undefined : `${root.href === '/' ? '' : root.href}/${rest.slice(0, i + 1).join('/')}` });
  });
  return out;
}

function TopBar() {
  const { crumbs, setActionsEl, setNavOpen, navOpen, nav } = useShell();
  const pathname = usePathname();
  const items = crumbs ?? autoCrumbs(pathname, nav);
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline px-3 md:px-4">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
        onClick={() => setNavOpen(!navOpen)}
      >
        <MenuIcon size={16} aria-hidden="true" />
      </Button>
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap gap-0.5 overflow-hidden">
          {items.map((c, i) => (
            <React.Fragment key={`${c.label}-${i}`}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {c.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={c.href} className="truncate">{c.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate">{c.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      {/* Slot for view controls / filters / actions: <HeaderActions>…</HeaderActions> */}
      <div ref={setActionsEl} className="flex shrink-0 items-center gap-1.5" data-slot="shell-header-actions" />
    </header>
  );
}

function Shell({ email, children }: Pick<AppShellProps, 'email' | 'children'>) {
  return (
    <div className="flex h-dvh bg-shell text-body">
      <SidebarNav email={email} />
      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <main
          id="main"
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-lg md:border md:border-hairline"
        >
          <TopBar />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 py-5 md:px-6 md:py-6 [--page-pad:16px] md:[--page-pad:24px]">{children}</div>
          </div>
        </main>
      </div>
      <CommandMenu />
    </div>
  );
}

export function AppShell({ email, children, nav, newItem }: AppShellProps) {
  return (
    <ShellProvider nav={nav} newItem={newItem}>
      <Shell email={email}>{children}</Shell>
    </ShellProvider>
  );
}
