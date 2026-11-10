import { fetchDashboardData } from '@/lib/dashboard/queries';
import { DashboardView } from './DashboardView';

export const dynamic = 'force-dynamic';

// Access is enforced by middleware and the (authenticated) layout's founder gate;
// this page only reads, through the service client, after both have passed.
export default async function DashboardPage() {
  const data = await fetchDashboardData();
  return <DashboardView data={data} />;
}
