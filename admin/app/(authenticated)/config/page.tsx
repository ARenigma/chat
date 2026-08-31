import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, RuntimeBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import { CONFIG_REGISTRY, formatDisplayValue } from '@/lib/config-registry';

interface ActiveConfig {
  domain: string;
  version_id: string;
  updated_at: string;
  config_versions: { version_number: number; published_at: string | null } | null;
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
    (acc, row) => { acc[row.domain] = row as unknown as ActiveConfig; return acc; },
    {}
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="App config"
        subtitle="All runtime configuration domains. Changes take effect immediately on publish."
      />

      {(domains ?? []).length === 0 ? (
        <EmptyState cause="cold-start" title="No config domains" body="Run migrations to seed domains." />
      ) : (
        <Card className="py-0 gap-0">
          <CardContent className="p-0">
            <div className="divide-y">
              {(domains ?? []).map((domain: { key: string; description: string }) => {
                const act = activeByDomain[domain.key];
                const versionNum = act?.config_versions?.version_number;
                const publishedAt = act?.config_versions?.published_at;
                const registryDef = CONFIG_REGISTRY.find((d) => d.key === domain.key);
                const payload = act?.payload as Record<string, unknown> | null;

                const summaryFields = registryDef?.fields.slice(0, 2) ?? [];
                const summary = summaryFields
                  .map((f) => {
                    const v = payload?.[f.key];
                    if (v === undefined || v === null) return null;
                    return `${f.label}: ${formatDisplayValue(f, v)}`;
                  })
                  .filter(Boolean)
                  .join(' · ');

                const runtimeStatuses = registryDef?.fields.map((f) => f.runtime) ?? [];
                const overallRuntime =
                  runtimeStatuses.includes('seeded') ? 'seeded'
                  : runtimeStatuses.includes('partial') ? 'partial'
                  : 'live';

                return (
                  <div key={domain.key} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {registryDef && (
                          <span aria-hidden="true" className="text-base">{registryDef.icon}</span>
                        )}
                        <span className="font-semibold text-sm">{registryDef?.name ?? domain.key}</span>
                        <RuntimeBadge status={overallRuntime} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-md">
                        {summary || domain.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {versionNum != null ? (
                        <div className="text-right">
                          <StatusBadge status="active" />
                          <p className="text-xs text-muted-foreground mt-0.5">
                            v{versionNum}
                            {publishedAt != null && (
                              <> · {new Date(publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</>
                            )}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-accent)] font-medium">No active config</span>
                      )}
                      <Button asChild size="sm">
                        <Link href={`/config/${domain.key}`}>Edit</Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
