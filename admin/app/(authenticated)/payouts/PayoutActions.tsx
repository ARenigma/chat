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
      const json = (await res.json()) as { error?: string; status?: string };
      if (!res.ok || json.status === 'failed') {
        setError(json.error ?? 'Payout failed');
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={!payable || pending} onClick={() => pay(false)}>
        {pending ? 'Paying…' : 'Pay'}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {!payable ? (
        <span className="text-xs text-muted-foreground">Account + PAN not verified</span>
      ) : null}
    </div>
  );
}
