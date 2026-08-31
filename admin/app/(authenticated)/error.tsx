'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mt-8">
      <EmptyState
        cause="error"
        body={error.message || 'An unexpected error occurred.'}
        action={
          <Button variant="outline" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
