import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/service';
import { ConfigVersionEditor } from './ConfigVersionEditor';

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

  // Verify domain exists.
  const { data: domainRow } = await svc
    .schema('admin')
    .from('config_domains')
    .select('key, description')
    .eq('key', domain)
    .maybeSingle();

  if (domainRow == null) {
    notFound();
  }

  // Fetch version history (newest first, limit 20).
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
        <Link href="/config" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          ← Config
        </Link>
      </div>
      <h1
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: '0.25rem',
        }}
      >
        {domain}
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        {(domainRow as { description: string }).description}
      </p>

      <ConfigVersionEditor
        domain={domain}
        activeVersion={activeVersion}
        draftVersion={draftVersion}
      />

      {/* Version history */}
      <section>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Version history
        </h2>
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          {history.length === 0 ? (
            <p
              style={{
                padding: '1.25rem',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
              }}
            >
              No published versions yet.
            </p>
          ) : (
            history.map((v, i) => (
              <div
                key={v.id}
                style={{
                  padding: '0.875rem 1.25rem',
                  borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                      v{v.version_number}
                    </span>{' '}
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '999px',
                        background: v.status === 'active' ? '#dcfce7' : '#f1f5f9',
                        color: v.status === 'active' ? '#166534' : '#64748b',
                        fontWeight: 600,
                      }}
                    >
                      {v.status}
                    </span>
                    {v.publish_reason != null && (
                      <p
                        style={{
                          fontSize: '0.8125rem',
                          color: 'var(--text-secondary)',
                          marginTop: '0.25rem',
                        }}
                      >
                        {v.publish_reason}
                      </p>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {v.published_at != null
                      ? new Date(v.published_at).toLocaleString('en-IN')
                      : new Date(v.created_at).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
