import { Skeleton } from '@/components/ui/Skeleton';

export default function Loading() {
  return (
    <div>
      <div className="page-header">
        <Skeleton width="180px" height="1.875rem" />
        <Skeleton width="280px" height="1rem" style={{ marginTop: '0.5rem' }} />
      </div>
      <div className="grid-stat" style={{ marginBottom: '2rem' }}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="stat-card" style={{ minWidth: 148, flex: 1 }}>
            <Skeleton width="60%" height="0.75rem" />
            <Skeleton width="40%" height="2rem" style={{ marginTop: '0.5rem' }} />
          </div>
        ))}
      </div>
      <div className="panel">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="domain-row">
            <div className="domain-row-meta">
              <Skeleton width="140px" height="1rem" />
              <Skeleton width="220px" height="0.75rem" style={{ marginTop: '0.375rem' }} />
            </div>
            <Skeleton width="64px" height="28px" />
          </div>
        ))}
      </div>
    </div>
  );
}
