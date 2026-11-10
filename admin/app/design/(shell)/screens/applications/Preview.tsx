'use client';

import { ApplicationsSkeleton, ApplicationsView } from '@/app/(authenticated)/applications/ApplicationsView';
import type { ApplicationAct } from '@/app/(authenticated)/applications/ApplicationActions';
import { LONG, MANY, NOW, QUEUE, RECENT } from './fixtures';

// Fixture routes never hit /api/applications.
const fakeAct: ApplicationAct = (_u, action) =>
  new Promise((resolve) => setTimeout(() => resolve(action === 'decline' ? 'RPC failed: fixture decline error' : null), 700));

/** ?state=populated | empty | loading | error | many | long */
export function ApplicationsPreview({ state, open }: { state: string; open?: boolean }) {
  if (state === 'loading') return <ApplicationsSkeleton />;
  const props = {
    populated: { queue: QUEUE, recent: RECENT },
    empty: { queue: [], recent: RECENT },
    error: { queue: [], recent: [], error: 'permission denied for table provider_applications' },
    many: { queue: MANY, recent: RECENT },
    long: { queue: LONG, recent: [] },
  }[state] ?? { queue: QUEUE, recent: RECENT };
  return <ApplicationsView {...props} now={NOW} onAct={fakeAct} defaultOpenId={open ? (props.queue[0]?.user_id ?? null) : null} />;
}
