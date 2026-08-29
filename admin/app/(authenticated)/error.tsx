'use client';

import { Button } from '@/components/ui/Button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="panel" style={{ marginTop: '2rem' }}>
      <div className="empty-state">
        <div className="empty-state-icon">⚡</div>
        <p className="empty-state-title">Something went wrong</p>
        <p className="empty-state-body">{error.message ?? 'An unexpected error occurred.'}</p>
        <Button variant="secondary" size="sm" onClick={reset} style={{ marginTop: '0.5rem' }}>
          Try again
        </Button>
      </div>
    </div>
  );
}
