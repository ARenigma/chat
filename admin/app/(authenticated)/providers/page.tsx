import { createServiceClient } from '@/lib/supabase/service';
import { ProvidersListView } from './ProvidersListView';
import type { ProviderRow } from './model';

export type { ProviderRow } from './model';

export const dynamic = 'force-dynamic';

export default async function ProvidersPage() {
  const svc = createServiceClient();
  const { data, error } = await svc
    .schema('admin')
    .from('providers_list')
    .select('*')
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as ProviderRow[];

  return <ProvidersListView rows={rows} now={new Date().toISOString()} error={error?.message ?? null} />;
}
