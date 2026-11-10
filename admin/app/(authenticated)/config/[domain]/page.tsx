import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { ConfigVersionEditor } from './ConfigVersionEditor';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/ui/badge';
import { VersionHistory } from '@/components/config/VersionHistory';
import { CONFIG_REGISTRY } from '@/lib/config-registry';
import { formatConfigDateTime } from '@/lib/config-view';

interface ConfigVersion {
  id: string;
  version_number: number;
  status: string;
  payload: unknown;
  published_at: string | null;
  publish_reason: string | null;
  created_at: string;
  created_by: string;
}

export default async function ConfigDomainPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const svc = createServiceClient();

  const { data: domainRow } = await svc
    .schema('admin')
    .from('config_domains')
    .select('key, description')
    .eq('key', domain)
    .maybeSingle();

  if (domainRow == null) notFound();

  const { data: versions } = await svc
    .schema('admin')
    .from('config_versions')
    .select('id, version_number, status, payload, published_at, publish_reason, created_at, created_by')
    .eq('domain', domain)
    .eq('environment', 'prod')
    .order('version_number', { ascending: false })
    .limit(20);

  const versionList = (versions ?? []) as ConfigVersion[];
  const activeVersion = versionList.find((v) => v.status === 'active') ?? null;
  const draftVersion = versionList.find((v) => v.status === 'draft') ?? null;
  const history = versionList.filter((v) => v.status !== 'draft');

  const registryDef = CONFIG_REGISTRY.find((d) => d.key === domain);
  const displayName = registryDef?.name ?? domain;
  const description = (domainRow as { description: string }).description;

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title={displayName}
        description={description}
        breadcrumbs={[
          { label: 'App config', href: '/config' },
          { label: displayName },
        ]}
        actions={
          <>
            {draftVersion && <StatusBadge status="draft">Draft v{draftVersion.version_number}</StatusBadge>}
            {activeVersion && <StatusBadge status="active">Live v{activeVersion.version_number}</StatusBadge>}
          </>
        }
      />

      <ConfigVersionEditor domain={domain} activeVersion={activeVersion} draftVersion={draftVersion} />

      <VersionHistory
        items={history.map((v) => ({
          id: v.id,
          versionNumber: v.version_number,
          status: v.status,
          reason: v.publish_reason,
          whenLabel: formatConfigDateTime(v.published_at ?? v.created_at),
        }))}
      />
    </div>
  );
}
