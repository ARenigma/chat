import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { ConfigVersionEditor } from './ConfigVersionEditor';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { CONFIG_REGISTRY } from '@/lib/config-registry';

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={displayName}
        subtitle={description}
        breadcrumbs={[
          { label: 'App config', href: '/config' },
          { label: displayName },
        ]}
      />

      <ConfigVersionEditor domain={domain} activeVersion={activeVersion} draftVersion={draftVersion} />

      {/* Version history */}
      <section className="flex flex-col gap-3 mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version history</p>
        {history.length === 0 ? (
          <EmptyState
            cause="cold-start"
            icon="📋"
            title="No published versions yet"
            body="Publish a draft to create the first production version."
          />
        ) : (
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <div className="divide-y">
                {history.map((v) => (
                  <div key={v.id} className="px-5 py-3 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">v{v.version_number}</span>
                      <StatusBadge status={v.status} />
                    </div>
                    <div className="text-right">
                      {v.publish_reason && (
                        <p className="text-xs text-muted-foreground mb-0.5 max-w-xs text-right">{v.publish_reason}</p>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(v.published_at ?? v.created_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
