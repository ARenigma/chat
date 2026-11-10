import { createServiceClient } from '@/lib/supabase/service';
import { ApplicationsView, type ApplicationRow } from './ApplicationsView';

// Active statuses shown in the main queue; recently resolved shown below.
const QUEUE_STATUSES = ['submitted', 'under_review', 'needs_info'];
const RECENT_STATUSES = ['approved', 'rejected'];

export default async function ApplicationsPage() {
  const svc = createServiceClient();

  const { data: queue, error: queueError } = await svc
    .from('provider_applications')
    .select('*')
    .in('status', QUEUE_STATUSES)
    .order('submitted_at', { ascending: true });

  const { data: recent } = await svc
    .from('provider_applications')
    .select('*')
    .in('status', RECENT_STATUSES)
    .order('reviewed_at', { ascending: false })
    .limit(20);

  return (
    <ApplicationsView
      queue={(queue ?? []) as ApplicationRow[]}
      recent={(recent ?? []) as ApplicationRow[]}
      error={queueError?.message ?? null}
      now={Date.now()}
    />
  );
}
