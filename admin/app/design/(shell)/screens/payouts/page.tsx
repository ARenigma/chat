import { PayoutsView } from '@/app/(authenticated)/payouts/PayoutsView';
import { PayoutsSkeleton } from '@/app/(authenticated)/payouts/PayoutsSkeleton';
import { HISTORY, MANY_HISTORY, NOW, QUEUE } from './fixtures';

/** ?state=default | empty | error | loading | many. Renders the real View with fixtures. */
export default async function PayoutsPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state = 'default' } = await searchParams;
  if (state === 'loading') return <PayoutsSkeleton />;
  const blank = state === 'empty' || state === 'error';
  return (
    <PayoutsView
      now={NOW}
      queue={blank ? [] : QUEUE}
      history={blank ? [] : state === 'many' ? MANY_HISTORY : HISTORY}
      queueError={state === 'error' ? 'permission denied for view admin.payable_providers' : null}
      historyError={state === 'error' ? 'permission denied for view admin.payout_history' : null}
    />
  );
}
