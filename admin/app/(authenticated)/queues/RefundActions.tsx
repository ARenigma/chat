'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function RefundActions({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(status: string) {
    const note = window.prompt(`${status} — add a note (optional):`) ?? undefined;
    setPending(status);
    setError(null);
    try {
      const res = await fetch('/api/queues/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, status, note }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setError(json.error ?? 'Error');
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" disabled={pending !== null} onClick={() => resolve('approved')}>
        {pending === 'approved' ? 'Approving…' : 'Approve'}
      </Button>
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => resolve('denied')}>
        {pending === 'denied' ? 'Denying…' : 'Deny'}
      </Button>
      <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => resolve('processed')}>
        {pending === 'processed' ? 'Marking…' : 'Processed'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
