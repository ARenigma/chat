'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Panel } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CONFIG_SETTINGS as C } from '../../fixtures';

function Field({ label, hint, children, id }: { label: string; hint?: string; children: React.ReactNode; id: string }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="mt-1 text-xs text-tertiary">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Settings / config form pattern: labelled rows in a bordered panel, sticky save bar. */
export function FormDemo() {
  const [auto, setAuto] = React.useState(C.autoApprove);
  const [hold, setHold] = React.useState(C.holdNewProviders);
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <PageHeader
        title={C.name}
        description={C.description}
        breadcrumbs={[{ label: 'Config', href: '/design/form' }, { label: 'payouts' }]}
        actions={<StatusBadge status="draft" />}
      />
      <Panel heading="Schedule">
        <div className="flex flex-col gap-5">
          <Field id="cadence" label="Cadence" hint="How often payouts run.">
            <Select defaultValue={C.cadence}>
              <SelectTrigger id="cadence" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="min" label="Minimum payout (INR)" hint="Below this, the balance rolls over.">
            <Input id="min" type="number" defaultValue={C.minimumPayout} className="w-48" />
          </Field>
          <Field id="note" label="Note to providers">
            <Textarea id="note" defaultValue={C.note} />
          </Field>
        </div>
      </Panel>
      <Panel heading="Rules">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-6">
            <div>
              <Label htmlFor="auto">Auto-approve payouts</Label>
              <p className="mt-1 text-xs text-tertiary">Skip manual review under the threshold.</p>
            </div>
            <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
          </div>
          <div className="flex items-center justify-between gap-6">
            <div>
              <Label htmlFor="hold">Hold new providers</Label>
              <p className="mt-1 text-xs text-tertiary">First payout is delayed 7 days.</p>
            </div>
            <Switch id="hold" checked={hold} onCheckedChange={setHold} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bad">Invalid example</Label>
            <Input id="bad" aria-invalid defaultValue="abc" />
            <p className="text-xs text-danger">Enter a number.</p>
          </div>
        </div>
      </Panel>
      <div className="save-bar rounded-lg border border-hairline">
        <span className="text-sm text-secondary">Not live until published.</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm">Discard</Button>
          <Button size="sm" onClick={() => toast.success('Draft saved', { description: 'Payout config v13' })}>Save draft</Button>
        </div>
      </div>
    </div>
  );
}
