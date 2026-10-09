'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

interface Props {
  providerId: string;
  suspendedUntil: string | null;
  delistedAt: string | null;
}

export function ProviderActions({ providerId, suspendedUntil, delistedAt }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBanned = suspendedUntil?.startsWith('2999') ?? false;
  const isSuspended = !isBanned && !!suspendedUntil && new Date(suspendedUntil) > new Date();
  const isDelisted = !!delistedAt;

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/providers/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Unknown error');
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPending(null);
    }
  }

  function suspend() {
    const raw = window.prompt('Suspend for how many days?', '7');
    if (!raw) return;
    const days = parseInt(raw, 10);
    if (isNaN(days) || days <= 0) { setError('Enter a valid number of days'); return; }
    const reason = window.prompt('Reason (required):') ?? '';
    if (!reason.trim()) { setError('Reason is required'); return; }
    act('suspend', { days, reason });
  }

  function lift() {
    const reason = window.prompt('Reason for lifting suspension:') ?? '';
    act('lift', { reason });
  }

  function ban() {
    if (!window.confirm(`Permanently ban ${providerId.slice(0, 8)}…? This sets suspended_until to year 2999.`)) return;
    const reason = window.prompt('Reason (required):') ?? '';
    if (!reason.trim()) { setError('Reason is required'); return; }
    act('ban', { reason });
  }

  function delist() {
    const reason = window.prompt('Reason for delisting:') ?? '';
    if (!reason.trim()) { setError('Reason is required'); return; }
    act('delist', { reason });
  }

  function relist() {
    const reason = window.prompt('Reason for relisting:') ?? '';
    act('relist', { reason });
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {!isSuspended && !isBanned && (
        <Button size="sm" variant="outline" disabled={pending !== null} onClick={suspend}>
          {pending === 'suspend' ? 'Suspending…' : 'Suspend'}
        </Button>
      )}
      {(isSuspended || isBanned) && (
        <Button size="sm" variant="outline" disabled={pending !== null} onClick={lift}>
          {pending === 'lift' ? 'Lifting…' : 'Lift suspension'}
        </Button>
      )}
      {!isBanned && (
        <Button size="sm" variant="destructive" disabled={pending !== null} onClick={ban}>
          {pending === 'ban' ? 'Banning…' : 'Ban'}
        </Button>
      )}
      {!isDelisted ? (
        <Button size="sm" variant="outline" disabled={pending !== null} onClick={delist}>
          {pending === 'delist' ? 'Delisting…' : 'Delist'}
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending !== null} onClick={relist}>
          {pending === 'relist' ? 'Relisting…' : 'Relist'}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
