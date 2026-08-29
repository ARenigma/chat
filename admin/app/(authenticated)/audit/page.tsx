import { createServiceClient } from '@/lib/supabase/service';

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

  const { data, count } = await svc
    .schema('admin')
    .from('config_audit')
    .select('id, action, domain, actor, reason, confirmation, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const ACTION_COLOUR: Record<string, string> = {
    draft_created: '#f1f5f9',
    published_staging: '#dbeafe',
    promoted_prod: '#dcfce7',
    scheduled: '#fef9c3',
    rollback: '#fee2e2',
    activation_cron: '#f0fdf4',
  };

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
        Audit log
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Immutable record of all config changes. {total.toLocaleString()} entries.
      </p>

      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '1.5rem',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 100px 1fr 120px 160px',
            padding: '0.75rem 1.25rem',
            background: 'var(--bg-sunken)',
            fontSize: '0.75rem',
            fontWeight: 700,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            gap: '1rem',
          }}
        >
          <span>Action</span>
          <span>Domain</span>
          <span>Reason</span>
          <span>Actor</span>
          <span>When</span>
        </div>

        {rows.length === 0 ? (
          <p style={{ padding: '1.25rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            No audit entries yet.
          </p>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 100px 1fr 120px 160px',
                padding: '0.75rem 1.25rem',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
                fontSize: '0.8125rem',
                gap: '1rem',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '0.125rem 0.5rem',
                  borderRadius: '6px',
                  background: ACTION_COLOUR[row.action] ?? '#f1f5f9',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {row.action}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {row.domain ?? '—'}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-primary)',
                }}
              >
                {row.reason || '—'}
              </span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-secondary)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {row.actor}
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                {new Date(row.created_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {pageNum > 1 && (
            <a
              href={`/audit?page=${pageNum - 1}`}
              style={{
                padding: '0.375rem 0.75rem',
                background: 'var(--bg-sunken)',
                borderRadius: '7px',
                fontSize: '0.875rem',
                fontWeight: 600,
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              ← Previous
            </a>
          )}
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Page {pageNum} of {totalPages}
          </span>
          {pageNum < totalPages && (
            <a
              href={`/audit?page=${pageNum + 1}`}
              style={{
                padding: '0.375rem 0.75rem',
                background: 'var(--bg-sunken)',
                borderRadius: '7px',
                fontSize: '0.875rem',
                fontWeight: 600,
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
