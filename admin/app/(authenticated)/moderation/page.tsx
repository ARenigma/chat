import { createServiceClient } from '@/lib/supabase/service';
import { ModerationView, type ModerationRow } from './ModerationView';

export default async function ModerationPage() {
  const svc = createServiceClient();
  const { data: queue, error } = await svc
    .from('moderation_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  return <ModerationView rows={(queue ?? []) as ModerationRow[]} error={error?.message ?? null} now={Date.now()} />;
}
