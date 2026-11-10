'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { AsyncButton, Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ReasonValues {
  reason: string;
  days: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** The server rejects an empty reason for punitive actions; the dialog says so before sending. */
  reasonRequired?: boolean;
  /** Ask for a number of days first (suspension). */
  withDays?: boolean;
  /** Resolve with an error message to keep the dialog open, or null once it worked. */
  onSubmit: (v: ReasonValues) => Promise<string | null>;
}

/** Replaces the browser prompt()/confirm() chain with one accessible dialog. Same fields, same rules. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  reasonRequired,
  withDays,
  onSubmit,
}: Props) {
  const [reason, setReason] = React.useState('');
  const [days, setDays] = React.useState('7');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const reasonId = React.useId();
  const daysId = React.useId();

  React.useEffect(() => {
    if (open) {
      setReason('');
      setDays('7');
      setError(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let parsedDays: number | null = null;
    if (withDays) {
      parsedDays = parseInt(days, 10);
      if (isNaN(parsedDays) || parsedDays <= 0) {
        setError('Enter a valid number of days');
        return;
      }
    }
    if (reasonRequired && !reason.trim()) {
      setError('Reason is required');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const err = await onSubmit({ reason, days: parsedDays });
      if (err) setError(err);
      else onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {withDays && (
            <div className="grid gap-1.5">
              <Label htmlFor={daysId}>Days</Label>
              <Input
                id={daysId}
                type="number"
                min={1}
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                aria-describedby={error ? errorId : undefined}
                className="w-28"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={reasonId}>
              Reason {reasonRequired ? <span className="text-tertiary">(required)</span> : <span className="text-tertiary">(optional)</span>}
            </Label>
            <Textarea
              id={reasonId}
              rows={3}
              autoFocus={!withDays}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={error === 'Reason is required' || undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>
          {error && (
            <p id={errorId} role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>Cancel</Button>
            </DialogClose>
            <AsyncButton type="submit" variant={destructive ? 'destructive' : 'default'} pending={pending}>
              {confirmLabel}
            </AsyncButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
