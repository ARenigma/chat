'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { NAV_GROUPS, type NavGroup } from '@/components/layout/nav';

export interface Crumb {
  label: string;
  href?: string;
}

interface ShellContextValue {
  crumbs: Crumb[] | null;
  setCrumbs: (c: Crumb[] | null) => void;
  actionsEl: HTMLElement | null;
  setActionsEl: (el: HTMLElement | null) => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  /** Sidebar navigation. Defaults to the real admin routes; the design preview swaps in its own. */
  nav: NavGroup[];
  /** Optional new-item action shown beside the workspace name (Linear's compose button). */
  newItem?: { href: string; label: string };
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function ShellProvider({
  children,
  nav = NAV_GROUPS,
  newItem,
}: {
  children: React.ReactNode;
  nav?: NavGroup[];
  newItem?: { href: string; label: string };
}) {
  const [crumbs, setCrumbs] = React.useState<Crumb[] | null>(null);
  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [navOpen, setNavOpen] = React.useState(false);
  const value = React.useMemo(
    () => ({ crumbs, setCrumbs, actionsEl, setActionsEl, commandOpen, setCommandOpen, navOpen, setNavOpen, nav, newItem }),
    [crumbs, actionsEl, commandOpen, navOpen, nav, newItem]
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <ShellProvider>');
  return ctx;
}

/** Declare the breadcrumb shown in the shell's top bar. Overrides the automatic one while mounted. */
export function useShellCrumbs(crumbs: Crumb[] | undefined) {
  const { setCrumbs } = useShell();
  const key = crumbs ? JSON.stringify(crumbs) : '';
  React.useEffect(() => {
    setCrumbs(key ? (JSON.parse(key) as Crumb[]) : null);
    return () => setCrumbs(null);
  }, [key, setCrumbs]);
}

/** Render children into the right side of the shell's top bar (view controls, filters, actions). */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  const { actionsEl } = useShell();
  return actionsEl ? createPortal(children, actionsEl) : null;
}
