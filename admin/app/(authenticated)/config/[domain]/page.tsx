import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { ConfigVersionEditor } from './ConfigVersionEditor';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
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

  if (domainRow == null) {
    notFound();
  }

  const { data: versions } = await svc
    .schema('admin')
    .from('config_versions')
    .select(
      'id, version_number, status, payload, published_at, publish_reason, created_at, created_by'
    )
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
    <div>
      <PageHeader
        title={displayName}
        subtitle={description}
        breadcrumbs={[
          { label: 'App config', href: '/config' },
          { label: displayName },
        ]}
      />

      <ConfigVersionEditor
        domain={domain}
        activeVersion={activeVersion}
        draftVersion={draftVersion}
      />

      {/* Version history */}
      <section style={{ marginTop: '2.5rem' }}>
        <p className="section-label" style={{ marginBottom: '0.75rem' }}>Version history</p>
        <Panel>
          {history.length === 0 ? (
            <EmptyState
              cause="cold-start"
              icon="📋"
              title="No published versions yet"
              body="Publish a draft to create the first production version."
            />
          ) : (
            history.map((v, i) => (
              <div
                key={v.id}
                className="version-row"
                style={{ borderTop: i === 0 ? 'none' : undefined }}
              >
                <div className="version-row-header">
                  <div className="version-row-left">
                    <span className="version-number">v{v.version_number}</span>
                    <StatusBadge status={v.status} />
                  </div>
                  <span className="version-date">
                    {v.published_at != null
                      ? new Date(v.published_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : new Date(v.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                  </span>
                </div>
                {v.publish_reason && (
                  <p className="version-reason">{v.publish_reason}</p>
                )}
              </div>
            ))
          )}
        </Panel>
      </section>
    </div>
  );
}
