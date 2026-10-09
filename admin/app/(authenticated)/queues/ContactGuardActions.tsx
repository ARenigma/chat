'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Props {
  userId: string;
  reviewState: string;
}

export function ContactGuardActions({ userId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(action: string, days?: number, note?: string) {
    setPending(action);
    setError(null);
    try {
      const res = await fetch('/api/queues/contact-guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, days, note }),
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

  function clear() {
    const note = window.prompt(`Clear review for ${userId.slice(0, 8)}…? Add a note (optional):`) ?? undefined;
    resolve('clear', undefined, note);
  }
  function suspend() {
    const raw = window.prompt('Suspend for how many days?', '7');
    if (!raw) return;
    const days = parseInt(raw, 10);
    if (isNaN(days) || days <= 0) { setError('Invalid days'); return; }
    const note = window.prompt('Note (optional):') ?? undefined;
    resolve('suspend', days, note);
  }
  function ban() {
    if (!window.confirm(`Ban ${userId.slice(0, 8)}…? Sets suspended_until to 2999.`)) return;
    const note = window.prompt('Reason:') ?? undefined;
    resolve('ban', undefined, note);
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={clear}>
        {pending === 'clear' ? 'Clearing…' : 'Clear'}
      </Button>
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={suspend}>
        {pending === 'suspend' ? 'Suspending…' : 'Suspend'}
      </Button>
      <Button size="sm" variant="destructive" disabled={pending !== null} onClick={ban}>
        {pending === 'ban' ? 'Banning…' : 'Ban'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
