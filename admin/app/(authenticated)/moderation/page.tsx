import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

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

  const { data: queue, error } = await svc
    .from('moderation_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (queue ?? []) as ModerationRow[];

  return (
    <div>
      <PageHeader
        title="Moderation queue"
        subtitle="Pending reports awaiting review."
      />

      <div
        className="alert alert--info"
        style={{ marginBottom: '1.5rem', borderRadius: 'var(--r-lg)' }}
      >
        <span>ℹ</span>
        <span>
          This queue is read-only. Enforcement actions (approve, dismiss, ban) require a
          separate policy workflow and will be added in the next release.
        </span>
      </div>

      {error != null && (
        <div className="alert alert--error" style={{ marginBottom: '1.25rem', borderRadius: 'var(--r-lg)' }}>
          <span>✕</span>
          <span>Could not load moderation queue: {error.message}</span>
        </div>
      )}

      <Panel>
        {rows.length === 0 && error == null ? (
          <EmptyState
            cause="cold-start"
            icon="✓"
            title="Queue is empty"
            body="No pending reports at the moment. All clear."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report ID</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={String(row.id ?? i)}>
                      <td>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {String(row.id ?? '—').slice(0, 8)}…
                        </span>
                      </td>
                      <td>{String(row.reason ?? row['report_reason'] ?? '—')}</td>
                      <td>
                        <StatusBadge status={String(row.status ?? 'unknown')} />
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                        {row.created_at != null
                          ? new Date(String(row.created_at)).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
