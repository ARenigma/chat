import { QueuesView } from '@/app/(authenticated)/queues/QueuesView';
import { QueuesSkeleton } from '@/app/(authenticated)/queues/QueuesSkeleton';
import { CONTACT_GUARD, MANY_CONTACT_GUARD, NOW, REFUNDS } from './fixtures';

/** ?state=default | empty | error | loading | many. Renders the real View with fixtures. */
export default async function QueuesPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state = 'default' } = await searchParams;
  if (state === 'loading') return <QueuesSkeleton />;
  return (
    <QueuesView
      now={NOW}
      contactGuard={state === 'empty' || state === 'error' ? [] : state === 'many' ? MANY_CONTACT_GUARD : CONTACT_GUARD}
      refunds={state === 'empty' || state === 'error' ? [] : REFUNDS}
      contactGuardError={state === 'error' ? 'permission denied for view contact_guard_review_queue' : null}
      refundsError={state === 'error' ? 'permission denied for table refund_reviews' : null}
    />
  );
}
