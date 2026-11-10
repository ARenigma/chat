'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ReasonDialog, type ReasonValues } from '../ReasonDialog';
import { ProviderDetailView } from '../ProviderDetailView';
import { shortId, type ProviderAction, type ProviderDetail, type ProviderNav } from '../model';

interface ActionConfig {
  title: string;
  description?: (id: string) => string;
  confirmLabel: string;
  done: string;
  destructive?: boolean;
  reasonRequired?: boolean;
  withDays?: boolean;
}

// Same rules the console always enforced: reason required on suspend, ban and delist.
const CONFIG: Record<ProviderAction, ActionConfig> = {
  suspend: { title: 'Suspend provider', confirmLabel: 'Suspend', done: 'Provider suspended', reasonRequired: true, withDays: true },
  lift: { title: 'Lift suspension', confirmLabel: 'Lift suspension', done: 'Suspension lifted' },
  ban: {
    title: 'Permanently ban this provider?',
    description: (id) => `Permanently ban ${shortId(id)}…? This sets suspended_until to year 2999.`,
    confirmLabel: 'Ban provider',
    done: 'Provider banned',
    destructive: true,
    reasonRequired: true,
  },
  delist: { title: 'Delist provider', confirmLabel: 'Delist', done: 'Provider delisted', reasonRequired: true },
  relist: { title: 'Relist provider', confirmLabel: 'Relist', done: 'Provider relisted' },
};

/** Owns the admin actions (POST /api/providers/[id]) and renders the presentational detail View. */
export function ProviderActions({ data, nav }: { data: ProviderDetail; nav: ProviderNav | null }) {
  const router = useRouter();
  const toast = useToast();
  // `action` outlives `open` so the dialog keeps its copy while it closes.
  const [action, setAction] = useState<ProviderAction>('suspend');
  const [open, setOpen] = useState(false);
  const providerId = data.profile.id;
  const cfg = CONFIG[action];

  async function act({ reason, days }: ReasonValues): Promise<string | null> {
    try {
      const res = await fetch(`/api/providers/${providerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'suspend' ? { days } : {}), reason }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) return json.error ?? 'Unknown error';
      toast.success(cfg.done);
      router.refresh();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Network error';
    }
  }

  return (
    <>
      <ProviderDetailView data={data} nav={nav} onAction={(a) => { setAction(a); setOpen(true); }} />
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={cfg.title}
        description={cfg.description?.(providerId)}
        confirmLabel={cfg.confirmLabel}
        destructive={cfg.destructive}
        reasonRequired={cfg.reasonRequired}
        withDays={cfg.withDays}
        onSubmit={act}
      />
    </>
  );
}
