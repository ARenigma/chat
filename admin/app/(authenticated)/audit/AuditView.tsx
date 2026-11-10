'use client';

import * as React from 'react';
import Link from 'next/link';
import { CaretDown, Check, Plus, WarningCircle, X } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge, StatusBadge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/EmptyState';
import { Avatar, Property, PropertyGroup } from '@/components/ui/property';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { List, ListGroup, ListRow } from '@/components/ui/table';
import { actorName, clockTime, dayKey, dayTitle, describe, fullTime, timeAgo } from '@/lib/audit/format';
import { AUDIT_ACTIONS, AUDIT_RANGES, type AuditDetail, type AuditFilters, type AuditRow } from '@/lib/audit/types';
import { cn } from '@/lib/utils';

export interface AuditViewProps {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: AuditFilters;
  /** Distinct actors for the filter menu. */
  actors: string[];
  details: Record<string, AuditDetail>;
  /** ISO time the data was read; every relative time is measured against it. */
  nowIso: string;
  error?: string | null;
  loading?: boolean;
  /** Route the filter and pagination links point at. */
  basePath?: string;
}

function href(base: string, f: AuditFilters, page = 1): string {
  const q = new URLSearchParams();
  if (f.actor) q.set('actor', f.actor);
  if (f.action) q.set('action', f.action);
  if (f.range) q.set('range', f.range);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

function FilterChip({
  name,
  value,
  valueLabel,
  options,
  clearHref,
}: {
  name: string;
  value?: string;
  valueLabel?: string;
  options: { value: string; label: string; href: string }[];
  clearHref: string;
}) {
  const menu = (
    <DropdownMenuContent align="start" className="max-h-72 min-w-44 overflow-y-auto">
      <DropdownMenuItem asChild>
        <Link href={clearHref}>
          <span className="flex-1">Any</span>
          {!value && <Check size={14} />}
        </Link>
      </DropdownMenuItem>
      {options.map((o) => (
        <DropdownMenuItem key={o.value} asChild>
          <Link href={o.href}>
            <span className="flex-1 truncate">{o.label}</span>
            {o.value === value && <Check size={14} />}
          </Link>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );

  if (!value) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="xs" className="text-secondary">
            <Plus /> {name}
          </Button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }
  return (
    <span className="inline-flex h-6 items-stretch overflow-hidden rounded-sm border border-hairline-strong bg-raised text-xs">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-2 text-body transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ring"
          >
            <span className="text-secondary">{name}</span>
            <span className="text-tertiary">is</span>
            <span className="max-w-32 truncate font-medium text-primary">{valueLabel ?? value}</span>
            <CaretDown size={10} className="text-tertiary" />
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      <Link
        href={clearHref}
        aria-label={`Clear ${name.toLowerCase()} filter`}
        className="inline-flex w-6 items-center justify-center border-l border-hairline text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ring"
      >
        <X size={12} />
      </Link>
    </span>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 2 }, (_, g) => (
        <div key={g}>
          <div className="flex h-9 items-center border-b border-hairline bg-hover px-4">
            <Skeleton className="h-3.5 w-24" />
          </div>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex h-9 items-center gap-3 border-b border-hairline px-4">
              <Skeleton className="size-[18px] rounded-full" />
              <Skeleton className="h-3.5 w-72 max-w-[60%]" />
              <Skeleton className="ml-auto h-3.5 w-12" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DiffBlock({ detail }: { detail: AuditDetail }) {
  if (detail.changes.length === 0) {
    return <p className="text-sm text-tertiary">No changes against the previous version.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {detail.changes.map((c) => (
        <li key={c.path} className="overflow-hidden rounded-md border border-hairline bg-raised">
          <p className="border-b border-hairline px-2.5 py-1.5 font-mono text-xs text-secondary">{c.path}</p>
          {c.before !== undefined && (
            <p className="flex gap-2 bg-danger-subtle px-2.5 py-1 font-mono text-xs break-all text-danger">
              <span aria-label="Removed" className="select-none">-</span>
              <span>{c.before}</span>
            </p>
          )}
          {c.after !== undefined && (
            <p className="flex gap-2 bg-success-subtle px-2.5 py-1 font-mono text-xs break-all text-success">
              <span aria-label="Added" className="select-none">+</span>
              <span>{c.after}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function DetailSheet({
  row,
  detail,
  nowIso,
  onClose,
}: {
  row: AuditRow | null;
  detail?: AuditDetail;
  nowIso: string;
  onClose: () => void;
}) {
  const meta = row?.metadata && Object.keys(row.metadata).length > 0 ? row.metadata : null;
  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md" aria-describedby={undefined}>
        {row && (
          <>
            <SheetHeader className="gap-2 pr-12">
              <SheetTitle className="flex items-start gap-2.5 text-base leading-6 text-primary">
                <Avatar name={actorName(row.actor)} size={22} className="mt-0.5" />
                <span>
                  {actorName(row.actor)} <span className="font-normal text-secondary">{describe(row.action, row.domain)}</span>
                </span>
              </SheetTitle>
              <SheetDescription className="text-xs text-tertiary">
                {fullTime(row.created_at)} · {timeAgo(row.created_at, nowIso)}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6">
              <PropertyGroup title="Details">
                <Property hint="Action"><StatusBadge status={row.action} /></Property>
                <Property hint="Domain">{row.domain ?? '-'}</Property>
                <Property hint="Actor"><span className="font-mono text-xs">{row.actor}</span></Property>
                {detail?.version != null && (
                  <Property hint="Version">
                    v{detail.version}
                    {detail.environment ? ` · ${detail.environment}` : ''}
                  </Property>
                )}
                {row.confirmation && (
                  <Property hint="Confirmed"><span className="font-mono text-xs">{row.confirmation}</span></Property>
                )}
              </PropertyGroup>

              <section>
                <h3 className="mb-1.5 text-sm font-medium text-secondary">Reason</h3>
                <p className="text-sm text-body">{row.reason || <span className="text-tertiary">No reason recorded.</span>}</p>
              </section>

              {detail && (
                <section>
                  <h3 className="mb-2 text-sm font-medium text-secondary">
                    Changes <span className="text-tertiary">{detail.changes.length}</span>
                  </h3>
                  <DiffBlock detail={detail} />
                </section>
              )}

              {meta && (
                <section>
                  <h3 className="mb-2 text-sm font-medium text-secondary">Metadata</h3>
                  <pre className="overflow-x-auto rounded-md border border-hairline bg-raised p-2.5 font-mono text-xs text-body">
                    {JSON.stringify(meta, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Linear-style activity: day-grouped dense rows, filter chips, detail sheet with a before/after diff. */
export function AuditView({
  rows,
  total,
  page,
  pageSize,
  filters,
  actors,
  details,
  nowIso,
  error,
  loading,
  basePath = '/audit',
}: AuditViewProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const active = Boolean(filters.actor || filters.action || filters.range);

  const groups = React.useMemo(() => {
    const out: { key: string; title: string; rows: AuditRow[] }[] = [];
    for (const r of rows) {
      const key = dayKey(r.created_at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(r);
      else out.push({ key, title: dayTitle(r.created_at, nowIso), rows: [r] });
    }
    return out;
  }, [rows, nowIso]);

  const openRow = rows.find((r) => r.id === openId) ?? null;
  const without = (k: keyof AuditFilters): AuditFilters => ({ ...filters, [k]: undefined });
  const with_ = (k: keyof AuditFilters, v: string): AuditFilters => ({ ...filters, [k]: v });

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader
          className="mb-4"
          title="Audit log"
          description={`Immutable record of all config changes. ${total.toLocaleString('en-IN')} ${total === 1 ? 'entry' : 'entries'}.`}
        />
      </div>

      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-y border-hairline px-(--page-pad) py-1.5">
        <FilterChip
          name="Actor"
          value={filters.actor}
          valueLabel={filters.actor ? actorName(filters.actor) : undefined}
          options={actors.map((a) => ({ value: a, label: a, href: href(basePath, with_('actor', a)) }))}
          clearHref={href(basePath, without('actor'))}
        />
        <FilterChip
          name="Action"
          value={filters.action}
          valueLabel={filters.action ? label(filters.action) : undefined}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: label(a), href: href(basePath, with_('action', a)) }))}
          clearHref={href(basePath, without('action'))}
        />
        <FilterChip
          name="Date"
          value={filters.range}
          valueLabel={filters.range ? AUDIT_RANGES[filters.range] : undefined}
          options={Object.entries(AUDIT_RANGES).map(([k, v]) => ({ value: k, label: v, href: href(basePath, with_('range', k)) }))}
          clearHref={href(basePath, without('range'))}
        />
        {active && (
          <Link
            href={basePath}
            className="ml-1 rounded-xs px-1 text-xs text-tertiary hover:text-primary focus-visible:outline-2 focus-visible:outline-accent-ring"
          >
            Clear all
          </Link>
        )}
      </div>

      {error != null && (
        <div role="alert" className="mx-(--page-pad) mt-4 flex items-start gap-2.5 rounded-lg border border-hairline bg-danger-subtle px-3.5 py-2.5 text-sm text-body">
          <WarningCircle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <span>Could not load audit log: {error}</span>
        </div>
      )}

      {loading ? (
        <RowSkeleton />
      ) : rows.length === 0 && error == null ? (
        active ? (
          <EmptyState
            cause="no-results"
            inline
            className="py-20"
            title="No entries match these filters"
            body="Try a wider date range or clear a filter."
            action={<Button asChild size="sm" variant="secondary"><Link href={basePath}>Clear filters</Link></Button>}
          />
        ) : (
          <EmptyState
            cause="cold-start"
            inline
            className="py-20"
            title="No audit entries yet"
            body="Every config change is recorded here permanently once you publish a version."
          />
        )
      ) : (
        <List>
          {groups.map((g) => (
            <ListGroup key={g.key} title={g.title} count={g.rows.length}>
              {g.rows.map((r) => {
                const d = details[r.id];
                return (
                  <ListRow key={r.id} selected={r.id === openId} className="p-0">
                    <button
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      aria-label={`${actorName(r.actor)} ${describe(r.action, r.domain)}, ${timeAgo(r.created_at, nowIso)}. Open details`}
                      className={cn(
                        'flex h-full w-full min-w-0 items-center gap-3 px-4 text-left',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ring'
                      )}
                    >
                      <Avatar name={actorName(r.actor)} size={18} />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-primary">{actorName(r.actor)}</span>{' '}
                        <span className="text-secondary">{describe(r.action, r.domain)}</span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        {r.domain && <Badge dot={statusTone(r.action)}>{r.domain}</Badge>}
                        {d?.version != null && <Badge className="font-mono text-2xs">v{d.version}</Badge>}
                      </span>
                      {r.reason && (
                        <span className="hidden max-w-60 shrink truncate text-xs text-tertiary xl:block">{r.reason}</span>
                      )}
                      <time
                        dateTime={r.created_at}
                        title={fullTime(r.created_at)}
                        className="w-16 shrink-0 text-right text-xs text-tertiary tabular-nums"
                      >
                        {timeAgo(r.created_at, nowIso)}
                      </time>
                      <span className="sr-only">{clockTime(r.created_at)}</span>
                    </button>
                  </ListRow>
                );
              })}
            </ListGroup>
          ))}
        </List>
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex h-11 items-center justify-between gap-4 px-(--page-pad)">
          {page > 1 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href(basePath, filters, page - 1)} rel="prev">Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-xs text-tertiary tabular-nums">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href(basePath, filters, page + 1)} rel="next">Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}

      <DetailSheet row={openRow} detail={openId ? details[openId] : undefined} nowIso={nowIso} onClose={() => setOpenId(null)} />
    </div>
  );
}
