import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';

interface ConfigDomain {
  key: string;
  description: string;
}

interface ActiveConfig {
  domain: string;
  version_id: string;
  updated_at: string;
  config_versions: {
    version_number: number;
    published_at: string | null;
  } | null;
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
    .select('domain, version_id, updated_at, config_versions(version_number, published_at)')
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
      <h1
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: '0.5rem',
        }}
      >
        Config Domains
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Runtime configuration domains. Changes take effect immediately on publish.
      </p>

      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        {(domains ?? []).map((domain: ConfigDomain, i: number) => {
          const act = activeByDomain[domain.key];
          const versionNum = act?.config_versions?.version_number;
          const publishedAt = act?.config_versions?.published_at;

          return (
            <div
              key={domain.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.25rem',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
              }}
            >
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{domain.key}</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginTop: '0.125rem' }}>
                  {domain.description}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                {versionNum != null ? (
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                    }}
                  >
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
                  </span>
                ) : (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--bg-accent)' }}>
                    no active config
                  </span>
                )}
                <Link
                  href={`/config/${domain.key}`}
                  style={{
                    display: 'inline-block',
                    padding: '0.375rem 0.875rem',
                    background: 'var(--bg-inverse)',
                    color: '#fff',
                    borderRadius: '7px',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Edit
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
