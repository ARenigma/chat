'use client';

import * as React from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { HeaderActions } from '@/components/layout/shell-context';
import { Badge, StatusBadge, type Tone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Property, PropertyGroup } from '@/components/ui/property';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusIcon } from '@/components/ui/status-icon';
import { List, ListGroup, ListId, ListRow } from '@/components/ui/table';
import { Notice } from '@/components/triage/Notice';
import { fmtDate, relTime } from '@/components/triage/format';

export interface ModerationRow {
  id: string;
  reported_user_id?: string;
  reporter_id?: string;
  reason?: string;
  status?: string;
  created_at?: string;
  // Columns the moderation_queue view exposes beyond the original four (migration 150).
  detail?: string | null;
  evidence_body?: string | null;
  subject_user_id?: string | null;
  subject_role?: string | null;
  reports_against_subject?: number | null;
  suspended_until?: string | null;
  conversation_id?: string | null;
  story_id?: string | null;
  evidence_surface?: string | null;
  evidence_author_name?: string | null;
  [key: string]: unknown;
}

// Same set the queue view sorts first (migration 150): child safety under either name, then self harm.
const URGENT = new Set(['minor_safety', 'child_safety', 'self_harm']);

const reasonOf = (r: ModerationRow) => String(r.reason ?? r['report_reason'] ?? '—');
const reasonLabel = (s: string) => s.replace(/_/g, ' ');
const isUrgent = (r: ModerationRow) => URGENT.has(reasonOf(r));
const idOf = (r: ModerationRow, i: number) => String(r.id ?? i);
const shortId = (s: string) => `${s.slice(0, 8)}…`;
const tone = (r: ModerationRow): Tone => (isUrgent(r) ? 'danger' : 'neutral');

function matches(r: ModerationRow, q: string) {
  if (!q) return true;
  const hay = [reasonOf(r), r.detail, r.evidence_body, r.subject_role, r.evidence_author_name, r.id].join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

interface Props {
  rows: ModerationRow[];
  error?: string | null;
  /** Server clock, so relative times hydrate identically. */
  now: number;
  /** Open the detail panel for this report id on first render (preview screenshots). */
  defaultOpenId?: string | null;
}

/** Linear-style list of open reports with a read-only detail panel. Pure props. */
export function ModerationView({ rows, error, now, defaultOpenId = null }: Props) {
  const [q, setQ] = React.useState('');
  const [openIdx, setOpenIdx] = React.useState<string | null>(defaultOpenId);

  const keyed = rows.map((r, i) => ({ r, key: idOf(r, i) }));
  const shown = keyed.filter(({ r }) => matches(r, q));
  const open = keyed.find((k) => k.key === openIdx)?.r ?? null;
  const groups = [
    { label: 'Urgent', tone: 'danger' as Tone, items: shown.filter(({ r }) => isUrgent(r)) },
    { label: 'Open', tone: 'neutral' as Tone, items: shown.filter(({ r }) => !isUrgent(r)) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        <span className="text-xs text-tertiary tabular-nums">{rows.length} reports</span>
      </HeaderActions>

      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader className="mb-4" title="Moderation queue" breadcrumbs={[{ label: 'Moderation' }]} description="Pending reports awaiting review." />
        <div className="flex flex-col gap-3 pb-4">
          <Notice>
            This queue is read-only. Enforcement actions (approve, dismiss, ban) require a separate
            policy workflow and will be added in the next release.
          </Notice>
          {error != null && <Notice tone="danger">Could not load moderation queue: {error}</Notice>}
        </div>
      </div>

      <div className="flex h-11 items-center gap-2 border-y border-hairline px-(--page-pad)">
        <div className="relative w-full max-w-64">
          <MagnifyingGlass size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tertiary" />
          <Input
            aria-label="Filter reports"
            placeholder="Filter by reason, detail…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-7 pl-8"
          />
        </div>
      </div>

      {rows.length === 0 && error == null ? (
        <EmptyState inline cause="cold-start" title="Queue is empty" body="No pending reports at the moment. All clear." className="py-20" />
      ) : groups.length === 0 && error == null ? (
        <EmptyState inline cause="no-results" className="py-20" />
      ) : (
        <List>
          {groups.map((g) => (
            <ListGroup key={g.label} title={g.label} count={g.items.length} icon={<StatusIcon state={g.tone === 'danger' ? 'progress' : 'todo'} tone={g.tone} />}>
              {g.items.map(({ r, key }) => (
                <ReportItem key={key} row={r} now={now} selected={key === openIdx} onOpen={() => setOpenIdx(key)} />
              ))}
            </ListGroup>
          ))}
        </List>
      )}

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <SheetContent className="gap-0 p-0 sm:max-w-[460px]">
          {open && <ReportDetail row={open} now={now} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReportItem({ row: r, now, selected, onOpen }: { row: ModerationRow; now: number; selected: boolean; onOpen: () => void }) {
  const text = r.detail || r.evidence_body || '';
  const count = Number(r.reports_against_subject ?? 0);
  return (
    <ListRow selected={selected} onClick={onOpen} className="group/row h-11 cursor-default">
      <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xs text-left">
        <StatusIcon state={isUrgent(r) ? 'progress' : 'todo'} tone={tone(r)} />
        <ListId className="hidden w-[76px] sm:block">{shortId(String(r.id ?? '—'))}</ListId>
        <span className="w-40 shrink-0 truncate font-medium text-primary first-letter:uppercase">{reasonLabel(reasonOf(r))}</span>
        <span className="hidden min-w-0 flex-1 truncate text-secondary md:block">{text}</span>
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 lg:flex">
          {r.subject_role && <Badge className="h-[18px] px-1.5 text-2xs">{r.subject_role}</Badge>}
          {count > 1 && <Badge dot="warning" className="h-[18px] px-1.5 text-2xs">{count} reports</Badge>}
        </span>
        <span className="ml-auto w-12 shrink-0 text-right text-xs text-tertiary tabular-nums lg:ml-0" title={fmtDate(r.created_at)}>
          {relTime(r.created_at, now)}
        </span>
      </button>
    </ListRow>
  );
}

function ReportDetail({ row: r, now }: { row: ModerationRow; now: number }) {
  const count = Number(r.reports_against_subject ?? 0);
  const subject = r.subject_user_id ?? r.reported_user_id;
  return (
    <>
      <SheetHeader className="gap-1 border-b border-hairline px-5 py-4 pr-12">
        <div className="flex items-center gap-2 text-xs text-tertiary">
          <StatusIcon state={isUrgent(r) ? 'progress' : 'todo'} tone={tone(r)} />
          <span>{isUrgent(r) ? 'Urgent' : 'Open'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{shortId(String(r.id ?? '—'))}</span>
          <span aria-hidden="true">·</span>
          <span>{relTime(r.created_at, now)} ago</span>
        </div>
        <SheetTitle className="text-xl font-semibold tracking-[-0.02em] text-primary first-letter:uppercase">
          {reasonLabel(reasonOf(r))}
        </SheetTitle>
        <SheetDescription className="text-sm text-secondary">
          {r.detail || 'The reporter gave no detail.'}
        </SheetDescription>
      </SheetHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <PropertyGroup title="Properties">
          <Property icon={<StatusIcon state="todo" tone={tone(r)} size={16} />} hint="Status">
            <StatusBadge status={String(r.status ?? 'unknown')} />
          </Property>
          <Property hint="Reported">{fmtDate(r.created_at)}</Property>
          {r.subject_role && <Property hint="Subject role">{r.subject_role}</Property>}
          {count > 0 && <Property hint="Reports against subject">{count}</Property>}
          {r.suspended_until && <Property hint="Suspended until">{fmtDate(r.suspended_until)}</Property>}
          {r.evidence_surface && <Property hint="Surface">{r.evidence_surface}</Property>}
          {r.evidence_author_name && <Property hint="Author">{r.evidence_author_name}</Property>}
        </PropertyGroup>

        <PropertyGroup title="References">
          {subject && <Property hint="Subject"><span className="font-mono text-xs">{subject}</span></Property>}
          {r.conversation_id && <Property hint="Conversation"><span className="font-mono text-xs">{r.conversation_id}</span></Property>}
          {r.story_id && <Property hint="Story"><span className="font-mono text-xs">{r.story_id}</span></Property>}
          <Property hint="Report"><span className="font-mono text-xs">{String(r.id ?? '—')}</span></Property>
        </PropertyGroup>

        {r.evidence_body && (
          <PropertyGroup title="Evidence">
            <blockquote className="rounded-lg border border-hairline bg-raised px-3.5 py-3 text-sm whitespace-pre-wrap text-body">
              {r.evidence_body}
            </blockquote>
          </PropertyGroup>
        )}
      </div>

      <div className="border-t border-hairline px-5 py-3 text-xs text-tertiary">
        Read-only. Enforcement actions are not available in the console yet.
      </div>
    </>
  );
}

export function ModerationSkeleton() {
  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6" aria-busy="true" aria-label="Loading reports">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 mb-4 h-4 w-64 max-w-full" />
      </div>
      <div className="flex h-11 items-center border-y border-hairline px-(--page-pad)">
        <Skeleton className="h-7 w-56" />
      </div>
      {[2, 4].map((n, g) => (
        <div key={g}>
          <div className="flex h-9 items-center gap-2 border-b border-hairline bg-hover px-4">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="flex h-11 items-center gap-3 border-b border-hairline px-4">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="ml-4 hidden h-3.5 w-72 md:block" />
              <Skeleton className="ml-auto h-3 w-8" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
