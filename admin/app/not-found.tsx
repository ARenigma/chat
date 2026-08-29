import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.05em', color: 'var(--border-hairline)' }}>
        404
      </p>
      <h1 className="page-title">Page not found</h1>
      <p className="page-subtitle">This page does not exist or has been moved.</p>
      <Link href="/" className="btn btn--secondary btn--sm" style={{ marginTop: '0.5rem' }}>
        ← Back to dashboard
      </Link>
    </div>
  );
}
