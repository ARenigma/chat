'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pause, Prohibit } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  userId: string;
  reviewState: string;
  /** `buttons` for the detail panel, `icons` for the hover actions on a list row. */
  variant?: 'buttons' | 'icons';
}

export function ContactGuardActions({ userId, variant = 'buttons' }: Props) {
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
    // The prompt is also the confirmation: Cancel (null) clears nothing.
    const note = window.prompt(`Clear review for ${userId.slice(0, 8)}…? Add a note (optional):`);
    if (note === null) return;
    resolve('clear', undefined, note || undefined);
  }
  function suspend() {
    const raw = window.prompt('Suspend for how many days?', '7');
    if (!raw) return;
    const days = parseInt(raw, 10);
    if (isNaN(days) || days <= 0) { setError('Invalid days'); return; }
    const note = window.prompt('Note (optional):');
    if (note === null) return;
    resolve('suspend', days, note || undefined);
  }
  function ban() {
    if (!window.confirm(`Ban ${userId.slice(0, 8)}…? Sets suspended_until to 2999.`)) return;
    const note = window.prompt('Reason:');
    if (note === null) return;
    resolve('ban', undefined, note || undefined);
  }

  if (variant === 'icons') {
    const items = [
      { key: 'clear', label: 'Clear review', icon: <Check />, run: clear, danger: false },
      { key: 'suspend', label: 'Suspend', icon: <Pause />, run: suspend, danger: false },
      { key: 'ban', label: 'Ban', icon: <Prohibit />, run: ban, danger: true },
    ];
    return (
      <div className="flex items-center gap-0.5">
        {error && <span role="alert" className="max-w-40 truncate pr-1 text-xs text-danger" title={error}>{error}</span>}
        {items.map((a) => (
          <Tooltip key={a.key}>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={a.label}
                disabled={pending !== null}
                aria-busy={pending === a.key}
                onClick={a.run}
                className={a.danger ? 'hover:text-danger' : undefined}
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
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={clear}>
        {pending === 'clear' ? 'Clearing…' : 'Clear'}
      </Button>
      <Button size="sm" variant="outline" disabled={pending !== null} onClick={suspend}>
        {pending === 'suspend' ? 'Suspending…' : 'Suspend'}
      </Button>
      <Button size="sm" variant="destructive" disabled={pending !== null} onClick={ban}>
        {pending === 'ban' ? 'Banning…' : 'Ban'}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
