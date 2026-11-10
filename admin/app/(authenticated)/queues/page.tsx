import { createServiceClient } from '@/lib/supabase/service';
import { QueuesView } from './QueuesView';
import type { ContactGuardRow, RefundRow } from './types';

export const dynamic = 'force-dynamic';

export default async function QueuesPage() {
  const svc = createServiceClient();

  const [cgResult, refundResult] = await Promise.all([
    svc.from('contact_guard_review_queue').select('*').order('review_requested_at', { ascending: true }),
    svc.from('refund_reviews').select('*').order('created_at', { ascending: true }),
  ]);

  return (
    <QueuesView
      contactGuard={(cgResult.data ?? []) as ContactGuardRow[]}
      refunds={(refundResult.data ?? []) as RefundRow[]}
      contactGuardError={cgResult.error?.message}
      refundsError={refundResult.error?.message}
      now={Date.now()}
    />
  );
}
