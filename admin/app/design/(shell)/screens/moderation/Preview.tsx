'use client';

import { ModerationSkeleton, ModerationView } from '@/app/(authenticated)/moderation/ModerationView';
import { LONG, MANY, NOW, REPORTS } from './fixtures';

/** ?state=populated | empty | loading | error | many | long */
export function ModerationPreview({ state, open }: { state: string; open?: boolean }) {
  if (state === 'loading') return <ModerationSkeleton />;
  const props = {
    populated: { rows: REPORTS },
    empty: { rows: [] },
    error: { rows: [], error: 'relation "moderation_queue" does not exist' },
    many: { rows: MANY },
    long: { rows: LONG },
  }[state] ?? { rows: REPORTS };
  return <ModerationView {...props} now={NOW} defaultOpenId={open ? String(props.rows[0]?.id ?? '') : null} />;
}
