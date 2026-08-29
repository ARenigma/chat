import { createServiceClient } from '@/lib/supabase/service';

interface ModerationRow {
  id: string;
  reported_user_id?: string;
  reporter_id?: string;
  reason?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export default async function ModerationPage() {
  const svc = createServiceClient();

  // moderation_queue is a view from migration 005/011.
  const { data: queue, error } = await svc
    .from('moderation_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (queue ?? []) as ModerationRow[];

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
        Moderation queue
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Pending reports awaiting review.
      </p>

      {error != null && (
        <p style={{ color: 'var(--bg-accent-strong)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Could not load moderation queue: {error.message}
        </p>
      )}

      {rows.length === 0 && error == null ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Queue is empty.</p>
      ) : (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 160px',
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
            <span>Report ID</span>
            <span>Reason</span>
            <span>Status</span>
            <span>Created</span>
          </div>

          {rows.map((row, i) => (
            <div
              key={row.id ?? i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr 160px',
                padding: '0.875rem 1.25rem',
                borderTop: '1px solid var(--border-hairline)',
                fontSize: '0.875rem',
                gap: '1rem',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {String(row.id ?? '—').slice(0, 8)}…
              </span>
              <span>{String(row.reason ?? row['report_reason'] ?? '—')}</span>
              <span>{String(row.status ?? '—')}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {row.created_at != null
                  ? new Date(String(row.created_at)).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })
                  : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
