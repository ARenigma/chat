'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  providerId: string;
  payable: boolean;
  amount: number;
}

// The manual Pay action. Disabled until the provider's account + PAN are verified;
// a founder can still force a below-minimum balance with a confirm.
export function PayoutActions({ providerId, payable, amount }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(ignoreMinimum: boolean) {
    if (!window.confirm(`Pay ₹${amount.toLocaleString('en-IN')} to ${providerId.slice(0, 8)}…?`)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, ignoreMinimum }),
      });
      const json = (await res.json()) as { error?: string; status?: string; recordError?: string };
      if (!res.ok || json.status === 'failed') {
        setError(json.error ?? 'Payout failed');
      } else {
        if (json.recordError) setError(json.recordError);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error ? (
        <span role="alert" className="max-w-56 truncate text-xs text-danger" title={error}>
          {error}
        </span>
      ) : null}
      <span title={payable ? undefined : 'Account + PAN not verified'}>
        <Button size="xs" variant="outline" disabled={!payable || pending} aria-busy={pending} onClick={() => pay(false)}>
          {pending ? 'Paying…' : 'Pay'}
          {!payable ? <span className="sr-only">(account and PAN not verified)</span> : null}
        </Button>
      </span>
    </div>
  );
}
