import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

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

  // Config health: any domain missing active config
  let configHealth: { active: number; total: number } = { active: 0, total: 0 };
  try {
    const { data: domains } = await svc.schema('admin').from('config_domains').select('key');
    const { data: active } = await svc
      .schema('admin')
      .from('config_active')
      .select('domain')
      .eq('environment', 'prod');
    configHealth = {
      total: (domains ?? []).length,
      active: (active ?? []).length,
    };
  } catch { /* non-fatal */ }

  // Last published change
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

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Pappal operational overview"
        actions={
          <Link href="/config" className="btn btn--secondary btn--sm">
            App config →
          </Link>
        }
      />

      {/* Config health callout */}
      {configHealth.total > 0 && configHealth.active < configHealth.total && (
        <div
          className="alert alert--warning"
          style={{ marginBottom: '1.5rem', borderRadius: 'var(--r-lg)' }}
        >
          <span>⚠</span>
          <span>
            {configHealth.total - configHealth.active} config domain
            {configHealth.total - configHealth.active > 1 ? 's have' : ' has'} no active version.{' '}
            <Link href="/config">Publish defaults →</Link>
          </span>
        </div>
      )}

      {/* Last change */}
      {lastChange && (
        <div style={{ marginBottom: '1.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          Last config change:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{lastChange.domain ?? '—'}</strong>
          {' by '}
          {lastChange.actor}
          {' · '}
          {new Date(lastChange.created_at).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          <Link href="/audit">View audit log →</Link>
        </div>
      )}

      {/* Safety */}
      <section style={{ marginBottom: '2rem' }}>
        <p className="section-label" style={{ marginBottom: '0.75rem' }}>Safety queue</p>
        {safetyError ? (
          <EmptyState
            cause="load-failure"
            body="Safety metrics view is not available in this environment."
          />
        ) : safety != null ? (
          <div className="grid-stat">
            <StatCard label="Total reports" value={(safety['total_reports'] as number) ?? 0} />
            <StatCard
              label="Pending review"
              value={(safety['pending'] as number) ?? 0}
              sub={
                ((safety['pending'] as number) ?? 0) > 0 ? 'Action needed' : 'All clear'
              }
            />
            <StatCard label="Open cases" value={(safety['open_cases'] as number) ?? 0} />
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              cause="cold-start"
              icon="🛡"
              title="No reports yet"
              body="Reports from members will appear here."
            />
          </div>
        )}
      </section>

      {/* Provider applications */}
      <section style={{ marginBottom: '2rem' }}>
        <p className="section-label" style={{ marginBottom: '0.75rem' }}>Provider applications</p>
        {appsError ? (
          <EmptyState cause="load-failure" body="Could not load provider applications." />
        ) : Object.keys(appsByStatus).length > 0 ? (
          <div className="grid-stat">
            {Object.entries(appsByStatus).map(([status, count]) => (
              <StatCard key={status} label={status} value={count} />
            ))}
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              cause="cold-start"
              icon="👤"
              title="No applications yet"
              body="Provider applications will appear here once submitted."
            />
          </div>
        )}
      </section>
    </div>
  );
}
