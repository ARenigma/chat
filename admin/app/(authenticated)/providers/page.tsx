import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProvidersTable } from './ProvidersTable';

export const dynamic = 'force-dynamic';

export interface ProviderRow {
  id: string;
  display_name: string | null;
  provider_category: string | null;
  is_available: boolean;
  presence_online: boolean;
  identity_verified: boolean;
  suspended_until: string | null;
  delisted_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  photo_count: number;
  pending_tokens: number;
  paid_tokens: number;
  active_strikes: number;
  created_at: string;
}

export default async function ProvidersPage() {
  const svc = createServiceClient();
  const { data, error } = await svc
    .schema('admin')
    .from('providers_list')
    .select('*')
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as ProviderRow[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Providers"
        subtitle={`${rows.length} provider${rows.length !== 1 ? 's' : ''} total`}
      />
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load providers: {error.message}
        </div>
      )}
      <ProvidersTable rows={rows} />
    </div>
  );
}
