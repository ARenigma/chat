import { createServiceClient } from '@/lib/supabase/service';

interface StatCard {
  label: string;
  value: string | number;
  sub?: string;
}

function Card({ label, value, sub }: StatCard) {
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        minWidth: '160px',
      }}
    >
      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
        {label}
      </p>
      <p
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          marginTop: '0.25rem',
          letterSpacing: '-0.03em',
        }}
      >
        {value}
      </p>
      {sub != null && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

async function fetchDashboardStats() {
  const svc = createServiceClient();

  // Safety metrics — from migration 005/011 safety_metrics view.
  // Use try/catch because the view may not exist in all environments.
  let safety: Record<string, unknown> | null = null;
  try {
    const result = await svc
      .from('safety_metrics' as 'profiles')
      .select('*')
      .maybeSingle();
    safety = result.data as Record<string, unknown> | null;
  } catch {
    // View not available; dashboard shows placeholder.
  }

  // Provider applications by status.
  let appStatuses: Array<{ status: string }> = [];
  try {
    const result = await svc.from('provider_applications').select('status');
    appStatuses = (result.data ?? []) as Array<{ status: string }>;
  } catch {
    // Table may not exist yet.
  }

  return { safety, appStatuses };
}

export default async function DashboardPage() {
  const { safety, appStatuses } = await fetchDashboardStats();

  const appsByStatus = appStatuses.reduce<Record<string, number>>((acc, row) => {
    const status = row.status ?? 'unknown';
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

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
        Dashboard
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
        Pappal operational overview
      </p>

      <section style={{ marginBottom: '2rem' }}>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Safety
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {safety != null ? (
            <>
              <Card label="Total reports" value={(safety['total_reports'] as number) ?? 0} />
              <Card label="Pending" value={(safety['pending'] as number) ?? 0} />
              <Card label="Open cases" value={(safety['open_cases'] as number) ?? 0} />
            </>
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Safety metrics view not available.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Provider applications
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
          {Object.keys(appsByStatus).length > 0 ? (
            Object.entries(appsByStatus).map(([status, count]) => (
              <Card key={status} label={status} value={count} />
            ))
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              No provider applications yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
