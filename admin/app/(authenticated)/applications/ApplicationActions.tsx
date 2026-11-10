'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AsyncButton, Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ConfirmDialog,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';

/** Resolves to an error message, or null on success. */
export type ApplicationAct = (
  userId: string,
  action: string,
  extra?: Record<string, unknown>,
) => Promise<string | null>;

/** The real call: POST /api/applications. Contract unchanged. */
const postApplicationAction: ApplicationAct = async (userId, action, extra) => {
  try {
    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId, ...extra }),
    });
    const json = (await res.json()) as { error?: string };
    return res.ok ? null : (json.error ?? 'Unknown error');
  } catch (e) {
    return e instanceof Error ? e.message : 'Network error';
  }
};

interface Props {
  userId: string;
  status: string;
  /** Name shown in the confirm copy; falls back to the short id as before. */
  name?: string | null;
  size?: 'xs' | 'sm';
  /** Detail sheet: Claim is the primary action there, an outline button in rows. */
  primary?: boolean;
  /** Preview hook: the fixture routes pass a fake so nothing hits the API. */
  onAct?: ApplicationAct;
}

const SUCCESS: Record<string, string> = {
  claim: 'Application claimed',
  needinfo: 'Info request sent',
  decline: 'Application declined',
};

export function ApplicationActions({ userId, status, name, size = 'sm', primary, onAct = postApplicationAction }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [fieldsRaw, setFieldsRaw] = useState('');

  const fields = fieldsRaw.split(',').map((f) => f.trim()).filter(Boolean);

  async function act(action: string, extra?: Record<string, unknown>) {
    setPending(action);
    const error = await onAct(userId, action, extra);
    setPending(null);
    if (error) {
      toast.error(error);
      return false;
    }
    toast.success(SUCCESS[action] ?? 'Done');
    router.refresh();
    return true;
  }

  const busy = pending !== null;
  const label = name ?? `${userId.slice(0, 8)}…`;
  const canAct = status !== 'approved' && status !== 'rejected';

  return (
    // Stop bubbling: the row behind this opens the detail sheet on click, and React
    // events bubble out of the dialog portals below.
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {status === 'submitted' && (
        <Button size={size} variant={primary ? 'default' : 'outline'} disabled={busy} onClick={() => act('claim')}>
          {pending === 'claim' ? 'Claiming…' : 'Claim'}
        </Button>
      )}
      {/* 191 E4: Admit removed — providers onboard themselves via complete_provider_onboarding */}
      {canAct && (
        <Button size={size} variant="outline" disabled={busy} onClick={() => setInfoOpen(true)}>
          {pending === 'needinfo' ? 'Sending…' : 'Need info'}
        </Button>
      )}
      {canAct && (
        <Button size={size} variant="destructive" disabled={busy} onClick={() => setDeclineOpen(true)}>
          {pending === 'decline' ? 'Declining…' : 'Decline'}
        </Button>
      )}

      <ConfirmDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title={`Decline application for ${label}?`}
        description="The applicant is told their application was not accepted."
        confirmLabel="Decline"
        destructive
        pending={pending === 'decline'}
        onConfirm={async () => {
          if (await act('decline')) setDeclineOpen(false);
        }}
      />

      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="sm:max-w-md">
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (fields.length === 0) return;
              if (await act('needinfo', { fields })) {
                setInfoOpen(false);
                setFieldsRaw('');
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Request more info from {label}</DialogTitle>
              <DialogDescription>
                Fields to request, comma-separated, e.g. about,headline.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={`needinfo-${userId}`}>Fields</Label>
              <Input
                id={`needinfo-${userId}`}
                autoFocus
                placeholder="about, headline"
                value={fieldsRaw}
                onChange={(e) => setFieldsRaw(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={pending === 'needinfo'} onClick={() => setInfoOpen(false)}>
                Cancel
              </Button>
              <AsyncButton type="submit" pending={pending === 'needinfo'} disabled={fields.length === 0}>
                Send request
              </AsyncButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
