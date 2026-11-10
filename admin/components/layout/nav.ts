import {
  SquaresFour,
  UserCircle,
  Users,
  Wallet,
  Queue,
  Flag,
  Gear,
  Scroll,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Active only on an exact path match (for a parent route with children in the same nav). */
  exact?: boolean;
}
export interface NavGroup {
  /** Omit for the ungrouped top block. */
  label?: string;
  items: NavItem[];
}

/** Existing routes, grouped like Linear's sidebar. Hrefs are unchanged. */
export const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/dashboard', label: 'Dashboard', icon: SquaresFour }] },
  {
    label: 'Workspace',
    items: [
      { href: '/providers', label: 'Providers', icon: UserCircle },
      { href: '/applications', label: 'Applications', icon: Users },
      { href: '/payouts', label: 'Payouts', icon: Wallet },
      { href: '/queues', label: 'Queues', icon: Queue },
      { href: '/moderation', label: 'Moderation', icon: Flag },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/config', label: 'Config', icon: Gear },
      { href: '/audit', label: 'Audit log', icon: Scroll },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(pathname: string, href: string, exact = false): boolean {
  if (href === '/' || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
