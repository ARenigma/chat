'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/Toast';
import { ReasonDialog } from '../ReasonDialog';

interface Props {
  photoId: string;
  providerId: string;
}

export function PhotoRemoveButton({ photoId, providerId }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  async function remove({ reason }: { reason: string }): Promise<string | null> {
    try {
      const res = await fetch(`/api/providers/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_photo', photoId, reason }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) return json.error ?? 'Error';
      toast.success('Photo removed');
      router.refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Network error';
    }
  }

  return (
    <>
      <Button size="xs" variant="destructive" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this photo?"
        description="This bypasses the 3-photo minimum floor."
        confirmLabel="Remove photo"
        destructive
        onSubmit={remove}
      />
    </>
  );
}
