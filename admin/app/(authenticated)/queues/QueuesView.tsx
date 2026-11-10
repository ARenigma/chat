'use client';

import * as React from 'react';
import { CalendarBlank, Gauge, Hash, Prohibit, User, WarningOctagon, Coins, Note } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, type Tone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Property, PropertyGroup } from '@/components/ui/property';
import { StatusIcon, type StatusIconState } from '@/components/ui/status-icon';
import { List, ListGroup } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatAge, formatInr, formatShortDate } from '@/lib/ops-format';
import { ContactGuardActions } from './ContactGuardActions';
import { RefundActions } from './RefundActions';
import { DetailSheet, QueueRow, QueueToolbar, onListKeyDown } from './QueuePrimitives';
import type { ContactGuardRow, RefundRow } from './types';

interface QueuesViewProps {
  contactGuard: ContactGuardRow[];
  refunds: RefundRow[];
  contactGuardError?: string | null;
  refundsError?: string | null;
  /** Epoch ms captured once on the server, so ages agree between SSR and hydration. */
  now: number;
}

// -- status mapping ------------------------------------------------------------

interface Ring {
  state: StatusIconState;
  tone: Tone;
}

function guardRing(reviewState: string | null): Ring {
  return reviewState === 'human_review' ? { state: 'progress', tone: 'danger' } : { state: 'todo', tone: 'warning' };
}

function refundRing(status: string): Ring {
  switch (status) {
    case 'approved':
      return { state: 'done', tone: 'success' };
    case 'processed':
      return { state: 'done', tone: 'info' };
    case 'denied':
      return { state: 'canceled', tone: 'neutral' };
    default:
      return { state: 'todo', tone: 'warning' };
  }
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const shortId = (id: string) => id.slice(0, 8);
// "Ban" sets suspended_until to 2999 (ContactGuardActions), so a far-future date means permanent.
const isPermanent = (ts: string | null) => !!ts && new Date(ts).getUTCFullYear() >= 2900;

/** Group rows by key, in the given key order first, then any remaining keys alphabetically. */
function groupBy<T>(rows: T[], key: (r: T) => string, order: string[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return keys.map((k) => [k, map.get(k) ?? []]);
}

function ErrorStrip({ message }: { message: string }) {
  return (
    <div role="alert" className="mx-(--page-pad) my-3 rounded-md border border-danger-dot/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
      {message}
    </div>
  );
}

/** Stepping through the flat, visible list while the panel is open. */
function useStepper(ids: string[], openId: string | null, setOpenId: (id: string | null) => void) {
  const index = openId ? ids.indexOf(openId) : -1;
  const step = (dir: 1 | -1) => {
    if (ids.length === 0) return;
    const next = index === -1 ? 0 : (index + dir + ids.length) % ids.length;
    setOpenId(ids[next] ?? null);
  };
  return { index, step };
}

// -- contact guard -------------------------------------------------------------

function ContactGuardQueue({ rows, error, now }: { rows: ContactGuardRow[]; error?: string | null; now: number }) {
  const [q, setQ] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      !needle ||
      (r.display_name ?? '').toLowerCase().includes(needle) ||
      r.user_id.toLowerCase().includes(needle) ||
      (r.categories ?? []).some((c) => c.toLowerCase().includes(needle))
  );
  const groups = groupBy(visible, (r) => r.review_state ?? 'unknown', ['human_review']);
  const flatIds = groups.flatMap(([, g]) => g.map((r) => r.user_id));
  const open = rows.find((r) => r.user_id === openId) ?? null;
  const { index, step } = useStepper(flatIds, open ? openId : null, setOpenId);

  return (
    <>
      <QueueToolbar label="Filter contact-guard reviews" value={q} onChange={setQ} summary={`${visible.length} of ${rows.length}`} />
      {error && <ErrorStrip message={error} />}
      {rows.length === 0 && !error ? (
        <EmptyState cause="cold-start" inline className="py-24" title="Queue is empty" body="No contact-guard reviews pending." />
      ) : visible.length === 0 && rows.length > 0 ? (
        <EmptyState cause="no-results" inline className="py-24" />
      ) : (
        <List onKeyDown={onListKeyDown}>
          {groups.map(([state, group]) => {
            const ring = guardRing(state);
            return (
              <ListGroup
                key={state}
                icon={<StatusIcon state={ring.state} tone={ring.tone} />}
                title={label(state)}
                count={group.length}
              >
                {group.map((r) => {
                  const cats = r.categories ?? [];
                  return (
                    <QueueRow
                      key={r.user_id}
                      ring={ring.state}
                      tone={ring.tone}
                      id={shortId(r.user_id)}
                      title={r.display_name ?? 'Unnamed user'}
                      meta={r.role ?? undefined}
                      label={`Open review for ${r.display_name ?? shortId(r.user_id)}`}
                      chips={
                        <>
                          {cats.slice(0, 2).map((c) => (
                            <Badge key={c} dot="warning">{c}</Badge>
                          ))}
                          {cats.length > 2 && <span className="text-xs text-tertiary">+{cats.length - 2}</span>}
                          <span className="w-16 text-right text-xs text-secondary tabular-nums">
                            {r.active_strikes} {r.active_strikes === 1 ? 'strike' : 'strikes'}
                          </span>
                        </>
                      }
                      age={formatAge(r.review_requested_at, now)}
                      selected={openId === r.user_id}
                      onOpen={() => setOpenId(r.user_id)}
                      actions={<ContactGuardActions userId={r.user_id} reviewState={r.review_state ?? ''} variant="icons" />}
                    />
                  );
                })}
              </ListGroup>
            );
          })}
        </List>
      )}

      <DetailSheet
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open?.display_name ?? 'Unnamed user'}
        description={open ? `Contact-guard review · requested ${formatAge(open.review_requested_at, now)} ago` : ''}
        position={index >= 0 ? { index, total: flatIds.length } : undefined}
        onStep={step}
        footer={open && <ContactGuardActions userId={open.user_id} reviewState={open.review_state ?? ''} />}
      >
        {open && <GuardProperties row={open} now={now} />}
      </DetailSheet>
    </>
  );
}

function GuardProperties({ row, now }: { row: ContactGuardRow; now: number }) {
  const ring = guardRing(row.review_state);
  const until = (ts: string | null) => (ts ? (isPermanent(ts) ? 'Permanent' : formatShortDate(ts, now)) : 'None');
  return (
    <div className="flex flex-col gap-6">
      <PropertyGroup title="Properties">
        <Property icon={<StatusIcon state={ring.state} tone={ring.tone} />}>{label(row.review_state ?? 'unknown')}</Property>
        <Property icon={<WarningOctagon size={16} />} hint="Active strikes">{row.active_strikes}</Property>
        <Property icon={<User size={16} />} hint="Role">{row.role ?? '-'}</Property>
        <Property icon={<CalendarBlank size={16} />} hint="Requested">{formatShortDate(row.review_requested_at, now)}</Property>
        <Property icon={<CalendarBlank size={16} />} hint="Last event">{formatShortDate(row.last_event_at, now)}</Property>
      </PropertyGroup>
      <PropertyGroup title="Restrictions">
        <Property icon={<Gauge size={16} />} hint="Paused until">{until(row.paused_until)}</Property>
        <Property icon={<Gauge size={16} />} hint="Hidden from directory">{until(row.directory_hidden_until)}</Property>
        <Property icon={<Prohibit size={16} />} hint="Suspended until">{until(row.suspended_until)}</Property>
      </PropertyGroup>
      <PropertyGroup title="Flags">
        {(row.categories ?? []).length === 0 ? (
          <p className="text-sm text-tertiary">No categories recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(row.categories ?? []).map((c) => (
              <Badge key={c} dot="warning" className="h-6 px-2.5 text-sm">{c}</Badge>
            ))}
          </div>
        )}
      </PropertyGroup>
      <PropertyGroup title="User ID">
        <Property icon={<Hash size={16} />}><span className="font-mono text-xs">{row.user_id}</span></Property>
      </PropertyGroup>
    </div>
  );
}

// -- refunds -------------------------------------------------------------------

function RefundQueue({ rows, error, now }: { rows: RefundRow[]; error?: string | null; now: number }) {
  const [q, setQ] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const visible = rows.filter(
    (r) => !needle || r.id.toLowerCase().includes(needle) || r.user_id.toLowerCase().includes(needle) || r.status.includes(needle)
  );
  const groups = groupBy(visible, (r) => r.status, ['pending', 'approved', 'processed', 'denied']);
  const flatIds = groups.flatMap(([, g]) => g.map((r) => r.id));
  const open = rows.find((r) => r.id === openId) ?? null;
  const { index, step } = useStepper(flatIds, open ? openId : null, setOpenId);
  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <>
      <QueueToolbar
        label="Filter refund reviews"
        value={q}
        onChange={setQ}
        summary={`${pendingCount} pending of ${rows.length}`}
      />
      {error && <ErrorStrip message={error} />}
      {rows.length === 0 && !error ? (
        <EmptyState cause="cold-start" inline className="py-24" title="No refund reviews" body="No account-closure refund cases have been queued." />
      ) : visible.length === 0 && rows.length > 0 ? (
        <EmptyState cause="no-results" inline className="py-24" />
      ) : (
        <List onKeyDown={onListKeyDown}>
          {groups.map(([status, group]) => {
            const ring = refundRing(status);
            return (
              <ListGroup
                key={status}
                icon={<StatusIcon state={ring.state} tone={ring.tone} />}
                title={label(status)}
                count={group.length}
              >
                {group.map((r) => (
                  <QueueRow
                    key={r.id}
                    ring={ring.state}
                    tone={ring.tone}
                    id={shortId(r.id)}
                    title={formatInr(r.amount_paise / 100)}
                    meta={`${r.purchased_tokens.toLocaleString('en-IN')} tokens · user ${shortId(r.user_id)}`}
                    label={`Open refund ${shortId(r.id)}`}
                    chips={
                      r.notes ? <span className="max-w-56 truncate text-xs text-tertiary">{r.notes}</span> : undefined
                    }
                    age={formatAge(r.created_at, now)}
                    selected={openId === r.id}
                    onOpen={() => setOpenId(r.id)}
                    actions={r.status === 'pending' ? <RefundActions reviewId={r.id} variant="icons" /> : undefined}
                  />
                ))}
              </ListGroup>
            );
          })}
        </List>
      )}

      <DetailSheet
        open={open !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open ? `Refund ${formatInr(open.amount_paise / 100)}` : ''}
        description={open ? `Account-closure refund · requested ${formatAge(open.created_at, now)} ago` : ''}
        position={index >= 0 ? { index, total: flatIds.length } : undefined}
        onStep={step}
        footer={
          open && open.status === 'pending' ? (
            <RefundActions reviewId={open.id} />
          ) : (
            <p className="text-sm text-tertiary">This review is {open?.status}. No further action.</p>
          )
        }
      >
        {open && <RefundProperties row={open} now={now} />}
      </DetailSheet>
    </>
  );
}

function RefundProperties({ row, now }: { row: RefundRow; now: number }) {
  const ring = refundRing(row.status);
  return (
    <div className="flex flex-col gap-6">
      <PropertyGroup title="Properties">
        <Property icon={<StatusIcon state={ring.state} tone={ring.tone} />}>{label(row.status)}</Property>
        <Property icon={<Coins size={16} />} hint="Tokens">{row.purchased_tokens.toLocaleString('en-IN')}</Property>
        <Property icon={<CalendarBlank size={16} />} hint="Created">{formatShortDate(row.created_at, now)}</Property>
        <Property icon={<CalendarBlank size={16} />} hint="Resolved">{formatShortDate(row.resolved_at, now)}</Property>
        <Property icon={<User size={16} />} hint="Resolved by">{row.resolved_by ?? '-'}</Property>
      </PropertyGroup>
      <PropertyGroup title="Notes">
        {row.notes ? (
          <p className="flex gap-2 text-sm text-body"><Note size={16} className="mt-0.5 shrink-0 text-secondary" />{row.notes}</p>
        ) : (
          <p className="text-sm text-tertiary">No notes.</p>
        )}
      </PropertyGroup>
      <PropertyGroup title="IDs">
        <Property icon={<Hash size={16} />} hint="Review"><span className="font-mono text-xs">{row.id}</span></Property>
        <Property icon={<User size={16} />} hint="User"><span className="font-mono text-xs">{row.user_id}</span></Property>
      </PropertyGroup>
    </div>
  );
}

// -- page ----------------------------------------------------------------------

export function QueuesView({ contactGuard, refunds, contactGuardError, refundsError, now }: QueuesViewProps) {
  const [tab, setTab] = React.useState('contact-guard');
  const pendingRefunds = refunds.filter((r) => r.status === 'pending').length;

  return (
    <Tabs value={tab} onValueChange={setTab} className="-mx-(--page-pad) -my-5 gap-0 md:-my-6">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader className="mb-4" title="Queues" description="Contact-guard reviews and refund reviews" />
        <TabsList className="border-b-0">
          <TabsTrigger value="contact-guard">
            Contact guard <span className="text-tertiary tabular-nums">{contactGuard.length}</span>
          </TabsTrigger>
          <TabsTrigger value="refunds">
            Refunds <span className="text-tertiary tabular-nums">{pendingRefunds}</span>
          </TabsTrigger>
        </TabsList>
      </div>
      <div className="border-t border-hairline">
        <TabsContent value="contact-guard">
          <ContactGuardQueue rows={contactGuard} error={contactGuardError} now={now} />
        </TabsContent>
        <TabsContent value="refunds">
          <RefundQueue rows={refunds} error={refundsError} now={now} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
