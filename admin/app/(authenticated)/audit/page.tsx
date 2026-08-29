import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  action: string;
  domain: string | null;
  actor: string;
  reason: string;
  confirmation: string | null;
  created_at: string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? '1', 10));
  const offset = (pageNum - 1) * PAGE_SIZE;

  const svc = createServiceClient();

  const { data, count, error } = await svc
    .schema('admin')
    .from('config_audit')
    .select('id, action, domain, actor, reason, confirmation, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={`Immutable record of all config changes. ${total.toLocaleString()} entries.`}
      />

      {error != null && (
        <div className="alert alert--error" style={{ marginBottom: '1.25rem', borderRadius: 'var(--r-lg)' }}>
          <span>✕</span>
          <span>Could not load audit log: {error.message}</span>
        </div>
      )}

      <Panel>
        {rows.length === 0 && error == null ? (
          <EmptyState
            cause="cold-start"
            icon="📋"
            title="No audit entries yet"
            body="Every config change is recorded here permanently once you publish a version."
          />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Domain</th>
                  <th>Reason</th>
                  <th>Actor</th>
                  <th style={{ whiteSpace: 'nowrap' }}>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <StatusBadge status={row.action} />
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                      {row.domain ?? '—'}
                    </td>
                    <td
                      style={{
                        maxWidth: '320px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.reason || '—'}
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        color: 'var(--text-secondary)',
                        maxWidth: '160px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {row.actor}
                    </td>
                    <td
                      style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {new Date(row.created_at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {totalPages > 1 && (
        <div className="pagination">
          {pageNum > 1 ? (
            <Link href={`/audit?page=${pageNum - 1}`} className="btn btn--secondary btn--sm">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="pagination-info">
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <Link href={`/audit?page=${pageNum + 1}`} className="btn btn--secondary btn--sm">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
