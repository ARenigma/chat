import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { ConfigIndexView } from '@/components/config/ConfigIndexView';
import { CONFIG_REGISTRY } from '@/lib/config-registry';
import { toIndexDomain } from '@/lib/config-view';

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

  const rows = (domains ?? []).map((domain: { key: string; description: string }) => {
    const act = activeByDomain[domain.key];
    return toIndexDomain({
      key: domain.key,
      description: domain.description,
      def: CONFIG_REGISTRY.find((d) => d.key === domain.key),
      versionNumber: act?.config_versions?.version_number ?? null,
      publishedAt: act?.config_versions?.published_at ?? null,
      payload: act?.payload ?? null,
    });
  });

  return (
    <div className="mx-auto max-w-[1040px]">
      <PageHeader
        title="App config"
        description="All runtime configuration domains. Changes take effect immediately on publish."
        breadcrumbs={[{ label: 'App config' }]}
      />
      <ConfigIndexView domains={rows} />
    </div>
  );
}
