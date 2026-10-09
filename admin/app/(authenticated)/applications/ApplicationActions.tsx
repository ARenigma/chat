'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  userId: string;
  status: string;
}

export function ApplicationActions({ userId, status }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, extra?: Record<string, unknown>) {
    if (action === 'decline') {
      if (!window.confirm(`Decline application for ${userId.slice(0, 8)}…?`)) return;
    }
    setPending(action);
    setError(null);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, userId, ...extra }),
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

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {status === 'submitted' && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => act('claim')}
        >
          {pending === 'claim' ? 'Claiming…' : 'Claim'}
        </Button>
      )}
      {/* 191 E4: Admit removed — providers onboard themselves via complete_provider_onboarding */}
      {(status === 'under_review' || status === 'submitted' || status === 'needs_info') && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => {
            const raw = window.prompt('Fields to request (comma-separated, e.g. about,headline):');
            if (!raw) return;
            const fields = raw.split(',').map(f => f.trim()).filter(Boolean);
            if (fields.length === 0) return;
            act('needinfo', { fields });
          }}
        >
          {pending === 'needinfo' ? 'Sending…' : 'Need info'}
        </Button>
      )}
      {status !== 'approved' && status !== 'rejected' && (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending !== null}
          onClick={() => act('decline')}
        >
          {pending === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
      )}
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
