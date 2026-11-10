import { createServiceClient } from '@/lib/supabase/service';
import { PayoutsView } from './PayoutsView';
import type { HistoryRow, PayableRow } from './types';

export const dynamic = 'force-dynamic';

// The manual payout queue: providers with cleared, past-hold, unpaid earnings.
// Disbursement is triggered by hand (no cron) via the Pay action, which calls the
// cashfree-payout Edge function. A provider is only `payable` once both their
// payout account AND PAN are verified. See docs/provider-payouts.md.

export default async function PayoutsPage() {
  const svc = createServiceClient();
  const [queue, history] = await Promise.all([
    svc.schema('admin').from('payable_providers').select('*').order('claimable_tokens', { ascending: false }),
    svc.schema('admin').from('payout_history').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  return (
    <PayoutsView
      queue={(queue.data ?? []) as PayableRow[]}
      history={(history.data ?? []) as HistoryRow[]}
      queueError={queue.error?.message}
      historyError={history.error?.message}
      now={Date.now()}
    />
  );
}
