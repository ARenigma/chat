import { ProviderActions } from '@/app/(authenticated)/providers/[id]/ProviderActions';
import { detailFixture, NAV, type DetailState } from '../fixtures';

/** Fixture states for the real provider detail View: ?state=populated|suspended|banned|bare|long */
export default async function ProviderDetailPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state = 'populated' } = await searchParams;
  return <ProviderActions data={detailFixture(state as DetailState)} nav={NAV} />;
}
