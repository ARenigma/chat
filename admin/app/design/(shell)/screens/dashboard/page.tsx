import { DashboardView } from '@/app/(authenticated)/dashboard/DashboardView';
import { DASHBOARD_EMPTY, DASHBOARD_ERROR, DASHBOARD_POPULATED } from './fixtures';

/** /design/screens/dashboard?state=populated|empty|loading|error */
export default async function DashboardPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const data = state === 'empty' ? DASHBOARD_EMPTY : state === 'error' ? DASHBOARD_ERROR : DASHBOARD_POPULATED;
  return <DashboardView data={data} loading={state === 'loading'} />;
}
