interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({ width, height = '1rem', className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{ display: 'block', width, height }}
      aria-hidden="true"
    />
  );
}

export function SkeletonStatCard() {
  return (
    <div className="stat-card" aria-hidden="true">
      <Skeleton width="60%" height="0.75rem" />
      <Skeleton width="40%" height="2rem" style={{ marginTop: '0.5rem' }} />
    </div>
  );
}

interface SkeletonProps {
  style?: React.CSSProperties;
}
