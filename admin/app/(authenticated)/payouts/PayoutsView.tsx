'use client';

import * as React from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { FilterChips } from '@/components/ops/FilterChips';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge, type Tone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/property';
import { StatCard } from '@/components/ui/stat-card';
import { StatusIcon, type StatusIconState } from '@/components/ui/status-icon';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatInr, formatShortDate } from '@/lib/ops-format';
import { RUPEES_PER_TOKEN } from '@/lib/money';
import { PayoutActions } from './PayoutActions';
import type { HistoryRow, PayableRow } from './types';

interface PayoutsViewProps {
  queue: PayableRow[];
  history: HistoryRow[];
  queueError?: string | null;
  historyError?: string | null;
  /** Epoch ms captured once on the server, so "this week" agrees between SSR and hydration. */
  now: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const shortId = (id: string) => id.slice(0, 8);

function batchRing(status: string): { state: StatusIconState; tone: Tone } {
  switch (status) {
    case 'completed':
      return { state: 'done', tone: 'success' };
    case 'processing':
      return { state: 'progress', tone: 'info' };
    case 'failed':
      return { state: 'canceled', tone: 'danger' };
    default:
      return { state: 'todo', tone: 'neutral' };
  }
}

/** Verification states for the payout account and PAN. */
function verifyTone(status: string): Tone {
  if (status === 'verified') return 'success';
  if (status === 'rejected' || status === 'failed') return 'danger';
  if (status === 'pending' || status === 'submitted') return 'warning';
  return 'neutral';
}

function ErrorStrip({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-(--page-pad) my-3 rounded-md border border-danger-dot/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

function Toolbar<T extends string>({
  q,
  setQ,
  searchLabel,
  chipLabel,
  chip,
  setChip,
  options,
  summary,
}: {
  q: string;
  setQ: (v: string) => void;
  searchLabel: string;
  chipLabel: string;
  chip: T;
  setChip: (v: T) => void;
  options: { value: T; label: string; count: number }[];
  summary: string;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-(--page-pad) py-1.5">
      <div className="relative w-full max-w-56">
        <MagnifyingGlass size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary" />
        <Input aria-label={searchLabel} placeholder="Filter by provider…" value={q} onChange={(e) => setQ(e.target.value)} className="h-7 pl-8" />
      </div>
      <FilterChips label={chipLabel} value={chip} onChange={setChip} options={options} />
      <span className="ml-auto text-xs text-tertiary tabular-nums">{summary}</span>
    </div>
  );
}

// -- ready to pay ----------------------------------------------------------------

type QueueFilter = 'all' | 'payable' | 'blocked';

function QueueTable({ rows, error }: { rows: PayableRow[]; error?: string | null }) {
  const [q, setQ] = React.useState('');
  const [chip, setChip] = React.useState<QueueFilter>('all');
  const needle = q.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (chip === 'all' || (chip === 'payable' ? r.payable : !r.payable)) &&
      (!needle || (r.display_name ?? '').toLowerCase().includes(needle) || r.provider_id.toLowerCase().includes(needle))
  );
  const payable = rows.filter((r) => r.payable).length;

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        searchLabel="Filter payable providers"
        chipLabel="Payable filter"
        chip={chip}
        setChip={setChip}
        options={[
          { value: 'all', label: 'All', count: rows.length },
          { value: 'payable', label: 'Payable', count: payable },
          { value: 'blocked', label: 'Blocked', count: rows.length - payable },
        ]}
        summary={`${visible.length} of ${rows.length}`}
      />
      {error ? (
        <ErrorStrip message={error} />
      ) : rows.length === 0 ? (
        <EmptyState cause="cold-start" inline className="py-24" title="Nothing to pay" body="No provider has a cleared, past-hold balance yet." />
      ) : visible.length === 0 ? (
        <EmptyState cause="no-results" inline className="py-24" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Claimable</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>PAN</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.provider_id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={r.display_name ?? r.provider_id} />
                    <span className="font-medium text-primary">{r.display_name ?? shortId(r.provider_id)}</span>
                    <span className="font-mono text-xs text-tertiary">{shortId(r.provider_id)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-primary tabular-nums">
                  {formatInr(r.claimable_tokens * RUPEES_PER_TOKEN)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.account_status ?? 'none'} tone={verifyTone(r.account_status ?? 'none')} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.pan_status ?? 'not_provided'} tone={verifyTone(r.pan_status ?? 'not_provided')} />
                </TableCell>
                <TableCell className="text-right">
                  <PayoutActions providerId={r.provider_id} payable={r.payable} amount={r.claimable_tokens} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

// -- history ---------------------------------------------------------------------

type HistoryFilter = 'all' | 'completed' | 'processing' | 'pending' | 'failed';

function HistoryTable({ rows, error, now }: { rows: HistoryRow[]; error?: string | null; now: number }) {
  const [q, setQ] = React.useState('');
  const [chip, setChip] = React.useState<HistoryFilter>('all');
  const needle = q.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      (chip === 'all' || r.status === chip) &&
      (!needle || (r.provider_name ?? '').toLowerCase().includes(needle) || r.provider_id.toLowerCase().includes(needle))
  );
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        searchLabel="Filter payout history"
        chipLabel="Status filter"
        chip={chip}
        setChip={setChip}
        options={[
          { value: 'all', label: 'All', count: rows.length },
          { value: 'completed', label: 'Completed', count: count('completed') },
          { value: 'processing', label: 'Processing', count: count('processing') },
          { value: 'pending', label: 'Pending', count: count('pending') },
          { value: 'failed', label: 'Failed', count: count('failed') },
        ]}
        summary={`${visible.length} of ${rows.length} (last 50)`}
      />
      {error ? (
        <ErrorStrip message={error} />
      ) : rows.length === 0 ? (
        <EmptyState cause="cold-start" inline className="py-24" title="No payouts yet" body="Batches appear here once you pay a provider." />
      ) : visible.length === 0 ? (
        <EmptyState cause="no-results" inline className="py-24" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Status</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Initiated by</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Settled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((b) => {
              const ring = batchRing(b.status);
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-body">
                      <StatusIcon state={ring.state} tone={ring.tone} />
                      {label(b.status)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={b.provider_name ?? b.provider_id} />
                      <span className="font-medium text-primary">{b.provider_name ?? shortId(b.provider_id)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-primary tabular-nums">{formatInr(b.total_paise / 100)}</TableCell>
                  <TableCell className="text-right text-secondary tabular-nums">{b.total_tokens.toLocaleString('en-IN')}</TableCell>
                  <TableCell className="font-mono text-xs text-tertiary">{b.cashfree_batch_id ?? shortId(b.id)}</TableCell>
                  <TableCell className="text-secondary">{b.initiated_by ?? '-'}</TableCell>
                  <TableCell className="text-secondary">{formatShortDate(b.initiated_at ?? b.created_at, now)}</TableCell>
                  <TableCell className="text-secondary">{formatShortDate(b.completed_at, now)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}

// -- page ------------------------------------------------------------------------

export function PayoutsView({ queue, history, queueError, historyError, now }: PayoutsViewProps) {
  const [tab, setTab] = React.useState('queue');

  const pendingRupees = queue.reduce((n, r) => n + r.claimable_tokens * RUPEES_PER_TOKEN, 0);
  const payable = queue.filter((r) => r.payable).length;
  const paidWeek = history.filter(
    (b) => b.status === 'completed' && now - new Date(b.completed_at ?? b.created_at).getTime() <= WEEK_MS
  );
  const failed = history.filter((b) => b.status === 'failed');
  const sum = (rows: HistoryRow[]) => rows.reduce((n, b) => n + b.total_paise / 100, 0);

  return (
    <Tabs value={tab} onValueChange={setTab} className="-mx-(--page-pad) -my-5 gap-0 md:-my-6">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader
          className="mb-5"
          title="Payouts"
          description="Providers with a claimable balance. Payouts are triggered manually."
        />
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Pending payout"
            value={pendingRupees}
            prefix="₹"
            separator="en-IN"
            sub={`${payable} of ${queue.length} providers payable`}
          />
          <StatCard
            label="Paid this week"
            value={sum(paidWeek)}
            prefix="₹"
            separator="en-IN"
            sub={`${paidWeek.length} ${paidWeek.length === 1 ? 'payout' : 'payouts'}, last 7 days`}
          />
          <StatCard
            label="Failed"
            value={failed.length}
            sub={failed.length > 0 ? `${formatInr(sum(failed))} to retry` : 'Nothing to retry'}
          />
        </div>
        <TabsList className="border-b-0">
          <TabsTrigger value="queue">
            Ready to pay <span className="text-tertiary tabular-nums">{queue.length}</span>
          </TabsTrigger>
          <TabsTrigger value="history">
            History <span className="text-tertiary tabular-nums">{history.length}</span>
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="border-t border-hairline">
        <TabsContent value="queue">
          <QueueTable rows={queue} error={queueError} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTable rows={history} error={historyError} now={now} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
