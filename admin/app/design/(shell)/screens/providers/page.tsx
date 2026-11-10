import { ProvidersListView } from '@/app/(authenticated)/providers/ProvidersListView';
import { ProvidersListSkeleton } from '@/app/(authenticated)/providers/ProvidersListSkeleton';
import { LONG_ROW, MANY_ROWS, NOW, PROVIDER_ROWS } from './fixtures';

/** Fixture states for the real Providers list View: ?state=populated|empty|loading|error|many|long */
export default async function ProvidersListPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state = 'populated' } = await searchParams;
  if (state === 'loading') return <ProvidersListSkeleton />;
  if (state === 'empty') return <ProvidersListView rows={[]} now={NOW} />;
  if (state === 'error') return <ProvidersListView rows={[]} now={NOW} error='relation "admin.providers_list" does not exist' />;
  if (state === 'many') return <ProvidersListView rows={MANY_ROWS} now={NOW} />;
  if (state === 'long') return <ProvidersListView rows={[LONG_ROW, ...PROVIDER_ROWS]} now={NOW} />;
  return <ProvidersListView rows={PROVIDER_ROWS} now={NOW} />;
}
