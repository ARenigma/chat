'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Props {
  photoId: string;
  providerId: string;
}

export function PhotoRemoveButton({ photoId, providerId }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm('Remove this photo? This bypasses the 3-photo minimum floor.')) return;
    const reason = window.prompt('Reason:') ?? '';
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_photo', photoId, reason }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setError(json.error ?? 'Error');
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <Button size="sm" variant="destructive" disabled={pending} onClick={remove}>
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      {error && <span className="text-xs text-destructive ml-2">{error}</span>}
    </span>
  );
}
