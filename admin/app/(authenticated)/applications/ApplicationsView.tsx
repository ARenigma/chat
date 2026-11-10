'use client';

import * as React from 'react';
import { CalendarBlank, CalendarCheck, Cake, Fingerprint, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { HeaderActions } from '@/components/layout/shell-context';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Avatar, Property, PropertyGroup } from '@/components/ui/property';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusIcon, type StatusIconState } from '@/components/ui/status-icon';
import { List, ListGroup, ListId, ListRow } from '@/components/ui/table';
import type { Tone } from '@/components/ui/badge';
import { Notice } from '@/components/triage/Notice';
import { ageYears, fmtDate, relTime } from '@/components/triage/format';
import { ApplicationActions, type ApplicationAct } from './ApplicationActions';

export interface ApplicationRow {
  user_id: string;
  status: string;
  display_name?: string | null;
  date_of_birth?: string | null;
  languages?: string[] | null;
  headline?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewer_note?: string | null;
}

// Stage order is the order the groups render in. Rings follow Linear: dashed backlog,
// empty todo, half-filled in progress, filled done, crossed canceled.
const STAGES: { status: string; label: string; state: StatusIconState; tone: Tone }[] = [
  { status: 'submitted', label: 'Submitted', state: 'todo', tone: 'info' },
  { status: 'under_review', label: 'Under review', state: 'progress', tone: 'warning' },
  { status: 'needs_info', label: 'Needs info', state: 'backlog', tone: 'warning' },
  { status: 'approved', label: 'Approved', state: 'done', tone: 'success' },
  { status: 'rejected', label: 'Rejected', state: 'canceled', tone: 'danger' },
];
const STAGE = Object.fromEntries(STAGES.map((s) => [s.status, s]));
const RESOLVED = new Set(['approved', 'rejected']);

function stageOf(status: string) {
  return STAGE[status] ?? { status, label: status.replace(/_/g, ' '), state: 'backlog' as const, tone: 'neutral' as const };
}

const shortId = (id: string) => `${id.slice(0, 8)}…`;

function matches(r: ApplicationRow, q: string) {
  if (!q) return true;
  const hay = [r.display_name, r.headline, r.user_id, ...(r.languages ?? [])].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

interface Props {
  /** Active queue: submitted, under_review, needs_info. */
  queue: ApplicationRow[];
  /** Recently resolved: approved, rejected. */
  recent: ApplicationRow[];
  /** Load error from the queue query. */
  error?: string | null;
  /** Server clock, so relative times hydrate identically. */
  now: number;
  onAct?: ApplicationAct;
  /** Open the detail sheet for this user on first render (preview screenshots). */
  defaultOpenId?: string | null;
}

/** Linear-style triage inbox. Pure props, no data fetching: the page and the preview both render it. */
export function ApplicationsView({ queue, recent, error, now, onAct, defaultOpenId = null }: Props) {
  const [q, setQ] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(defaultOpenId);

  const all = React.useMemo(() => [...queue, ...recent], [queue, recent]);
  const open = all.find((r) => r.user_id === openId) ?? null;

  const groups = STAGES.map((s) => ({
    ...s,
    rows: (RESOLVED.has(s.status) ? recent : queue).filter((r) => r.status === s.status && matches(r, q)),
  })).filter((g) => g.rows.length > 0);

  const queueEmpty = queue.length === 0 && !error;

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        <span className="text-xs text-tertiary tabular-nums">{queue.length} open</span>
      </HeaderActions>

      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader
          className="mb-4"
          title="Provider applications"
          breadcrumbs={[{ label: 'Applications' }]}
          description="Triage queue. Claim an application, request more info, or decline."
        />
        {error && <Notice tone="danger" className="mb-4">Could not load applications: {error}</Notice>}
      </div>

      <div className="flex h-11 items-center gap-2 border-y border-hairline px-(--page-pad)">
        <div className="relative w-full max-w-64">
          <MagnifyingGlass size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary" />
          <Input
            aria-label="Filter applications"
            placeholder="Filter by name, language…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-7 pl-8"
          />
        </div>
      </div>

      {queueEmpty && (
        <EmptyState
          inline
          cause="cold-start"
          title="Queue is empty"
          body="No applications in submitted, under_review, or needs_info."
          className="border-b border-hairline py-16"
        />
      )}

      {groups.length === 0 && !queueEmpty && !error && (
        <EmptyState inline cause="no-results" className="py-20" />
      )}

      <List>
        {groups.map((g) => (
          <ListGroup
            key={g.status}
            title={g.label}
            count={g.rows.length}
            icon={<StatusIcon state={g.state} tone={g.tone} />}
          >
            {g.rows.map((r) => (
              <ApplicationItem
                key={r.user_id}
                row={r}
                now={now}
                selected={r.user_id === openId}
                onOpen={() => setOpenId(r.user_id)}
                onAct={onAct}
              />
            ))}
          </ListGroup>
        ))}
      </List>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="gap-0 p-0 sm:max-w-[460px]">
          {open && <ApplicationDetail row={open} now={now} onAct={onAct} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ApplicationItem({
  row: r,
  now,
  selected,
  onOpen,
  onAct,
}: {
  row: ApplicationRow;
  now: number;
  selected: boolean;
  onOpen: () => void;
  onAct?: ApplicationAct;
}) {
  const stage = stageOf(r.status);
  const resolved = RESOLVED.has(r.status);
  const name = r.display_name ?? 'Unnamed applicant';
  const when = resolved ? r.reviewed_at : r.submitted_at;
  const secondary = resolved ? r.reviewer_note : r.headline;
  return (
    <ListRow selected={selected} onClick={onOpen} className="group/row h-11 cursor-default">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xs text-left"
      >
        <StatusIcon state={stage.state} tone={stage.tone} />
        <ListId className="hidden w-[76px] sm:block">{shortId(r.user_id)}</ListId>
        <Avatar name={name} size={20} />
        <span className="max-w-[40%] shrink-0 truncate font-medium text-primary">{name}</span>
        <span className="hidden min-w-0 flex-1 truncate text-secondary md:block">{secondary || ''}</span>
        <span className="ml-auto hidden shrink-0 items-center gap-1 lg:flex lg:group-focus-within/row:invisible lg:group-hover/row:invisible">
          {(r.languages ?? []).slice(0, 3).map((l) => (
            <Badge key={l} className="h-[18px] px-1.5 text-2xs">{l}</Badge>
          ))}
        </span>
        <span className="hidden w-8 shrink-0 text-right text-xs text-tertiary tabular-nums lg:block lg:group-focus-within/row:invisible lg:group-hover/row:invisible" title="Age">
          {r.date_of_birth ? `${ageYears(r.date_of_birth, now)}y` : ''}
        </span>
        <span
          className="ml-auto w-12 shrink-0 text-right text-xs text-tertiary tabular-nums md:ml-0 md:group-focus-within/row:invisible md:group-hover/row:invisible"
          title={fmtDate(when)}
        >
          {relTime(when, now)}
        </span>
      </button>
      {!resolved && (
        <div className="relative -ml-3 hidden h-full w-0 items-center md:flex">
          <div className="absolute right-0 flex items-center bg-hover pl-6 group-data-[selected=true]/row:bg-selected opacity-0 transition-opacity duration-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100">
            <ApplicationActions userId={r.user_id} status={r.status} name={r.display_name} size="xs" onAct={onAct} />
          </div>
        </div>
      )}
    </ListRow>
  );
}

function ApplicationDetail({ row: r, now, onAct }: { row: ApplicationRow; now: number; onAct?: ApplicationAct }) {
  const stage = stageOf(r.status);
  const resolved = RESOLVED.has(r.status);
  const name = r.display_name ?? 'Unnamed applicant';
  return (
    <>
      <SheetHeader className="gap-1 border-b border-hairline px-5 py-4 pr-12">
        <div className="flex items-center gap-2 text-xs text-tertiary">
          <StatusIcon state={stage.state} tone={stage.tone} />
          <span>{stage.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{shortId(r.user_id)}</span>
        </div>
        <SheetTitle className="text-xl font-semibold tracking-[-0.02em] text-primary">{name}</SheetTitle>
        <SheetDescription className="text-sm text-secondary">
          {r.headline || 'No headline provided.'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <PropertyGroup title="Properties">
          <Property icon={<StatusIcon state={stage.state} tone={stage.tone} size={16} />}>{stage.label}</Property>
          <Property icon={<Cake size={16} />} hint="Age">{r.date_of_birth ? `${ageYears(r.date_of_birth, now)} years` : '—'}</Property>
          <Property icon={<CalendarBlank size={16} />} hint="Submitted">{fmtDate(r.submitted_at)}</Property>
          {r.reviewed_at && <Property icon={<CalendarCheck size={16} />} hint="Reviewed">{fmtDate(r.reviewed_at)}</Property>}
          <Property icon={<Fingerprint size={16} />} hint="User ID"><span className="font-mono text-xs">{r.user_id}</span></Property>
        </PropertyGroup>

        <PropertyGroup title="Languages">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(r.languages ?? []).length > 0 ? (
              (r.languages ?? []).map((l) => <Badge key={l} className="h-6 px-2.5 text-sm">{l}</Badge>)
            ) : (
              <span className="text-sm text-tertiary">None listed</span>
            )}
          </div>
        </PropertyGroup>

        {r.reviewer_note && (
          <PropertyGroup title="Reviewer note">
            <p className="rounded-lg border border-hairline bg-raised px-3.5 py-3 text-sm text-body">{r.reviewer_note}</p>
          </PropertyGroup>
        )}
      </div>

      {!resolved && (
        <SheetFooter className="mt-0 flex-row items-center border-t border-hairline px-5 py-3">
          <ApplicationActions userId={r.user_id} status={r.status} name={r.display_name} primary onAct={onAct} />
        </SheetFooter>
      )}
    </>
  );
}

/** Loading skeleton: same chrome as the view, so the page does not jump when data lands. */
export function ApplicationsSkeleton() {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading applications">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="mt-2 mb-4 h-4 w-80 max-w-full" />
      </div>
      <div className="flex h-11 items-center border-y border-hairline px-(--page-pad)">
        <Skeleton className="h-7 w-56" />
      </div>
      {[3, 4].map((n, g) => (
        <div key={g}>
          <div className="flex h-9 items-center gap-2 border-b border-hairline bg-hover px-4">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 border-b border-hairline px-4">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="ml-4 hidden h-3.5 w-64 md:block" />
              <Skeleton className="ml-auto h-3 w-8" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
