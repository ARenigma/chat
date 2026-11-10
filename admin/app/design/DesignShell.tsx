'use client';

import {
  Cube,
  ChartLineUp,
  Rows,
  Sidebar as SidebarIcon,
  SlidersHorizontal,
  SignIn,
} from '@phosphor-icons/react/dist/ssr';
import { AppShell } from '@/components/layout/AppShell';
import type { NavGroup } from '@/components/layout/nav';

const NAV: NavGroup[] = [
  { items: [{ href: '/design', label: 'Kitchen sink', icon: Cube, exact: true }] },
  {
    label: 'Screens',
    items: [
      { href: '/design/list', label: 'List', icon: Rows },
      { href: '/design/detail', label: 'Detail', icon: SidebarIcon },
      { href: '/design/dashboard', label: 'Dashboard', icon: ChartLineUp },
      { href: '/design/form', label: 'Form', icon: SlidersHorizontal },
      { href: '/design/login', label: 'Login', icon: SignIn },
    ],
  },
];

/** The real AppShell with the preview's own nav and a fixture user. */
export function DesignShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell email="founder@pappal.dev" nav={NAV} newItem={{ href: '/design/form', label: 'New config' }}>
      {children}
    </AppShell>
  );
}
