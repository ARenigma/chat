'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle, X } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  reviewId: string;
  /** `buttons` for the detail panel, `icons` for the hover actions on a list row. */
  variant?: 'buttons' | 'icons';
}

export function RefundActions({ reviewId, variant = 'buttons' }: Props) {
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

  if (variant === 'icons') {
    const items = [
      { status: 'approved', label: 'Approve', icon: <Check /> },
      { status: 'denied', label: 'Deny', icon: <X /> },
      { status: 'processed', label: 'Mark processed', icon: <CheckCircle /> },
    ];
    return (
      <div className="flex items-center gap-0.5">
        {error && <span role="alert" className="max-w-40 truncate pr-1 text-xs text-danger" title={error}>{error}</span>}
        {items.map((a) => (
          <Tooltip key={a.status}>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={a.label}
                disabled={pending !== null}
                aria-busy={pending === a.status}
                onClick={() => resolve(a.status)}
              >
                {a.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{a.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={pending !== null} onClick={() => resolve('approved')}>
        {pending === 'approved' ? 'Approving…' : 'Approve'}
      </Button>
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => resolve('denied')}>
        {pending === 'denied' ? 'Denying…' : 'Deny'}
      </Button>
      <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => resolve('processed')}>
        {pending === 'processed' ? 'Marking…' : 'Processed'}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
