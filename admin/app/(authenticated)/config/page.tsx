import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui/Card';
import { StatusBadge, RuntimeBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CONFIG_REGISTRY, formatDisplayValue } from '@/lib/config-registry';

interface ActiveConfig {
  domain: string;
  version_id: string;
  updated_at: string;
  config_versions: {
    version_number: number;
    published_at: string | null;
  } | null;
  payload: Record<string, unknown> | null;
}

export default async function ConfigPage() {
  const svc = createServiceClient();

  const { data: domains } = await svc
    .schema('admin')
    .from('config_domains')
    .select('key, description')
    .order('key');

  const { data: active } = await svc
    .schema('admin')
    .from('config_active')
    .select('domain, version_id, updated_at, payload, config_versions(version_number, published_at)')
    .eq('environment', 'prod');

  const activeByDomain = (active ?? []).reduce<Record<string, ActiveConfig>>(
    (acc, row) => {
      acc[row.domain] = row as unknown as ActiveConfig;
      return acc;
    },
    {}
  );

  return (
    <div>
      <PageHeader
        title="App config"
        subtitle="All runtime configuration domains. Changes take effect immediately on publish."
      />

      {(domains ?? []).length === 0 ? (
        <EmptyState cause="cold-start" title="No config domains" body="Run migrations to seed domains." />
      ) : (
        <Panel>
          {(domains ?? []).map((domain: { key: string; description: string }, i: number) => {
            const act = activeByDomain[domain.key];
            const versionNum = act?.config_versions?.version_number;
            const publishedAt = act?.config_versions?.published_at;
            const registryDef = CONFIG_REGISTRY.find((d) => d.key === domain.key);
            const payload = act?.payload as Record<string, unknown> | null;

            // Summary: first 2 fields from active payload
            const summaryFields = registryDef?.fields.slice(0, 2) ?? [];
            const summary = summaryFields
              .map((f) => {
                const v = payload?.[f.key];
                if (v === undefined || v === null) return null;
                return `${f.label}: ${formatDisplayValue(f, v)}`;
              })
              .filter(Boolean)
              .join(' · ');

            // Runtime status: worst status among fields
            const runtimeStatuses = registryDef?.fields.map((f) => f.runtime) ?? [];
            const overallRuntime =
              runtimeStatuses.includes('seeded')
                ? 'seeded'
                : runtimeStatuses.includes('partial')
                ? 'partial'
                : 'live';

            return (
              <div key={domain.key} className="domain-row" style={{ borderTop: i === 0 ? 'none' : undefined }}>
                <div className="domain-row-meta">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {registryDef && (
                      <span aria-hidden="true" style={{ fontSize: '1rem' }}>
                        {registryDef.icon}
                      </span>
                    )}
                    <p className="domain-row-name">
                      {registryDef?.name ?? domain.key}
                    </p>
                    <RuntimeBadge status={overallRuntime} />
                  </div>
                  <p className="domain-row-desc">
                    {summary || domain.description}
                  </p>
                </div>

                <div className="domain-row-right">
                  {versionNum != null ? (
                    <div style={{ textAlign: 'right' }}>
                      <StatusBadge status="active" />
                      <p className="domain-row-version" style={{ marginTop: '0.25rem' }}>
                        v{versionNum}
                        {publishedAt != null && (
                          <>
                            {' · '}
                            {new Date(publishedAt).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: '2-digit',
                            })}
                          </>
                        )}
                      </p>
                    </div>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.8125rem',
                        color: 'var(--bg-accent-strong)',
                        fontWeight: 500,
                      }}
                    >
                      No active config
                    </span>
                  )}
                  <Link href={`/config/${domain.key}`} className="btn btn--primary btn--sm">
                    Edit
                  </Link>
                </div>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}
