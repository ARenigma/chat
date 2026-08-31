import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';

async function fetchDashboardStats() {
  const svc = createServiceClient();

  let safety: Record<string, unknown> | null = null;
  let safetyError = false;
  try {
    const result = await svc
      .from('safety_metrics' as 'profiles')
      .select('*')
      .maybeSingle();
    safety = result.data as Record<string, unknown> | null;
  } catch {
    safetyError = true;
  }

  let appStatuses: Array<{ status: string }> = [];
  let appsError = false;
  try {
    const result = await svc.from('provider_applications').select('status');
    appStatuses = (result.data ?? []) as Array<{ status: string }>;
  } catch {
    appsError = true;
  }

  let configHealth: { active: number; total: number } = { active: 0, total: 0 };
  try {
    const { data: domains } = await svc.schema('admin').from('config_domains').select('key');
    const { data: active } = await svc
      .schema('admin')
      .from('config_active')
      .select('domain')
      .eq('environment', 'prod');
    configHealth = { total: (domains ?? []).length, active: (active ?? []).length };
  } catch { /* non-fatal */ }

  let lastChange: { domain: string | null; actor: string; created_at: string } | null = null;
  try {
    const { data } = await svc
      .schema('admin')
      .from('config_audit')
      .select('domain, actor, created_at')
      .eq('action', 'promoted_prod')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lastChange = data as { domain: string | null; actor: string; created_at: string } | null;
  } catch { /* non-fatal */ }

  return { safety, safetyError, appStatuses, appsError, configHealth, lastChange };
}

export default async function DashboardPage() {
  const { safety, safetyError, appStatuses, appsError, configHealth, lastChange } =
    await fetchDashboardStats();

  const appsByStatus = appStatuses.reduce<Record<string, number>>((acc, row) => {
    const status = row.status ?? 'unknown';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  const missingConfigs = configHealth.total - configHealth.active;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        subtitle="Pappal operational overview"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/config">App config →</Link>
          </Button>
        }
      />

      {/* Config health callout */}
      {missingConfigs > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3 text-sm">
          <span className="text-amber-600 mt-0.5">⚠</span>
          <span className="text-amber-800">
            {missingConfigs} config domain{missingConfigs > 1 ? 's have' : ' has'} no active version.{' '}
            <Link href="/config" className="font-semibold underline">Publish defaults →</Link>
          </span>
        </div>
      )}

      {/* Last change */}
      {lastChange && (
        <p className="text-xs text-muted-foreground">
          Last config change:{' '}
          <span className="font-semibold text-foreground">{lastChange.domain ?? '—'}</span>
          {' by '}
          {lastChange.actor}
          {' · '}
          {new Date(lastChange.created_at).toLocaleString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
          {' · '}
          <Link href="/audit" className="underline">View audit log →</Link>
        </p>
      )}

      {/* Safety */}
      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Safety queue</p>
        {safetyError ? (
          <EmptyState cause="load-failure" body="Safety metrics view is not available in this environment." />
        ) : safety != null ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total reports" value={(safety['total_reports'] as number) ?? 0} />
            <StatCard
              label="Pending review"
              value={(safety['pending'] as number) ?? 0}
              sub={((safety['pending'] as number) ?? 0) > 0 ? 'Action needed' : 'All clear'}
            />
            <StatCard label="Open cases" value={(safety['open_cases'] as number) ?? 0} />
          </div>
        ) : (
          <EmptyState cause="cold-start" icon="🛡" title="No reports yet" body="Reports from members will appear here." />
        )}
      </section>

      {/* Provider applications */}
      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provider applications</p>
        {appsError ? (
          <EmptyState cause="load-failure" body="Could not load provider applications." />
        ) : Object.keys(appsByStatus).length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {Object.entries(appsByStatus).map(([status, count]) => (
                <StatCard key={status} label={status} value={count} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              <Link href="/applications" className="underline">Review queue →</Link>
            </p>
          </>

        ) : (
          <EmptyState cause="cold-start" icon="👤" title="No applications yet" body="Provider applications will appear here once submitted." />
        )}
      </section>
    </div>
  );
}
