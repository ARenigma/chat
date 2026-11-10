'use client';

import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  SlidersHorizontal,
  Star,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { HeaderActions } from '@/components/layout/shell-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Avatar } from '@/components/ui/property';
import { StatusIcon } from '@/components/ui/status-icon';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { List, ListGroup, ListId, ListRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { rupeesFromTokens } from '@/lib/money';
import { cn } from '@/lib/utils';
import {
  STATUS_META,
  STATUS_ORDER,
  fmtDate,
  providerStatus,
  shortId,
  type ProviderRow,
  type ProviderStatusKey,
} from './model';

type Tab = 'all' | 'live' | 'unverified' | 'restricted';
type SortKey = 'joined' | 'name' | 'rating' | 'pending';
type SortDir = 'asc' | 'desc';

const TAB_STATUSES: Record<Exclude<Tab, 'all'>, ProviderStatusKey[]> = {
  live: ['online', 'available'],
  unverified: ['unverified'],
  restricted: ['suspended', 'banned', 'delisted'],
};

/** Natural direction when a sort key is first chosen. */
const DEFAULT_DIR: Record<SortKey, SortDir> = { joined: 'desc', name: 'asc', rating: 'desc', pending: 'desc' };
const SORT_LABEL: Record<SortKey, string> = { joined: 'Newest', name: 'Name', rating: 'Rating', pending: 'Pending payout' };

// Column widths shared by the header row and every data row, so they line up.
const COL = {
  id: 'hidden w-[68px] shrink-0 md:block',
  status: 'hidden w-24 shrink-0 md:block',
  category: 'hidden w-28 shrink-0 truncate md:block',
  strikes: 'hidden w-12 shrink-0 lg:flex lg:justify-end',
  photos: 'hidden w-14 shrink-0 text-right lg:block',
  rating: 'hidden w-16 shrink-0 text-right md:block',
  pending: 'w-20 shrink-0 text-right md:w-24',
  joined: 'hidden w-20 shrink-0 text-right lg:block',
} as const;

function compare(a: ProviderRow, b: ProviderRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  // Missing values always sink to the bottom, whatever the direction.
  const nullLast = (x: number | string | null, y: number | string | null) => {
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return null;
  };
  let av: number | string | null;
  let bv: number | string | null;
  switch (key) {
    case 'name':
      av = a.display_name?.toLowerCase() ?? null;
      bv = b.display_name?.toLowerCase() ?? null;
      break;
    case 'rating':
      av = a.rating_avg;
      bv = b.rating_avg;
      break;
    case 'pending':
      av = a.pending_tokens;
      bv = b.pending_tokens;
      break;
    default:
      av = a.created_at;
      bv = b.created_at;
  }
  const missing = nullLast(av, bv);
  if (missing !== null) return missing;
  return av! < bv! ? -sign : av! > bv! ? sign : 0;
}

function FilterChip({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100 hover:bg-hover data-[state=open]:bg-hover',
            active ? 'border-accent-ring/50 bg-accent-subtle text-accent-fg' : 'border-hairline-strong text-body'
          )}
        >
          <span className={active ? 'text-accent-fg' : 'text-secondary'}>{label}</span>
          {value}
          <CaretDown size={10} aria-hidden="true" className="text-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const right = className?.includes('text-right');
  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded-xs text-xs font-medium text-tertiary transition-colors duration-100 hover:text-primary',
          active && 'text-primary',
          right && 'flex-row-reverse'
        )}
      >
        {label}
        {active && (sort.dir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />)}
      </button>
    </div>
  );
}

function ProviderListRow({ row, status, showStatus }: { row: ProviderRow; status: ProviderStatusKey; showStatus: boolean }) {
  const meta = STATUS_META[status];
  const name = row.display_name ?? 'Unnamed provider';
  return (
    <ListRow href={`/providers/${row.id}`} className="outline-offset-[-2px]">
      <ListId className={COL.id}>{shortId(row.id)}</ListId>
      <StatusIcon state={meta.state} tone={meta.tone} />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Avatar name={name} size={18} />
        <span className={cn('truncate font-medium', row.display_name ? 'text-primary' : 'text-tertiary')}>{name}</span>
      </span>
      {showStatus && <span className={cn(COL.status, 'truncate text-secondary')}>{meta.label}</span>}
      <span className={cn(COL.category, 'text-secondary')}>{row.provider_category ?? <span className="text-tertiary">—</span>}</span>
      <span className={COL.strikes}>
        {row.active_strikes > 0 && (
          <Badge variant="destructive" className="h-[18px] px-1.5 text-2xs tabular-nums" title={`${row.active_strikes} active strike${row.active_strikes === 1 ? '' : 's'}`}>
            {row.active_strikes}
          </Badge>
        )}
      </span>
      <span className={cn(COL.photos, 'tabular-nums', row.photo_count < 3 ? 'text-warning' : 'text-secondary')}>
        {row.photo_count}
      </span>
      <span className={cn(COL.rating, 'tabular-nums')}>
        {row.rating_avg != null ? (
          <span className="inline-flex items-center gap-1">
            <Star size={12} weight="fill" aria-hidden="true" className="text-warning-dot" />
            {Number(row.rating_avg).toFixed(1)}
            <span className="text-tertiary">({row.rating_count})</span>
          </span>
        ) : (
          <span className="text-tertiary">—</span>
        )}
      </span>
      <span className={cn(COL.pending, 'tabular-nums', row.pending_tokens > 0 ? 'text-body' : 'text-tertiary')}>
        {rupeesFromTokens(row.pending_tokens)}
      </span>
      <span className={cn(COL.joined, 'text-tertiary tabular-nums')}>{fmtDate(row.created_at)}</span>
    </ListRow>
  );
}

interface Props {
  rows: ProviderRow[];
  /** ISO timestamp used for suspension checks. Pass the server's so hydration matches. */
  now: string;
  /** Query error from the server, shown above the list. */
  error?: string | null;
}

/** Linear-style issue list: tabs, filter chips, collapsible status groups, dense sortable rows. */
export function ProvidersListView({ rows, now, error }: Props) {
  const nowDate = React.useMemo(() => new Date(now), [now]);
  const [tab, setTab] = React.useState<Tab>('all');
  const [q, setQ] = React.useState('');
  const [category, setCategory] = React.useState('any');
  const [strikesOnly, setStrikesOnly] = React.useState(false);
  const [grouped, setGrouped] = React.useState(true);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({ key: 'joined', dir: 'desc' });
  const searchRef = React.useRef<HTMLInputElement>(null);

  // "/" focuses the filter box, like Linear. Ignored while typing elsewhere.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const withStatus = React.useMemo(
    () => rows.map((row) => ({ row, status: providerStatus(row, nowDate) })),
    [rows, nowDate]
  );

  const categories = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.provider_category).filter((c): c is string => !!c))).sort(),
    [rows]
  );

  const tabCount = (t: Tab) =>
    t === 'all' ? withStatus.length : withStatus.filter((x) => TAB_STATUSES[t].includes(x.status)).length;

  const needle = q.trim().toLowerCase();
  const filtered = withStatus
    .filter(({ row, status }) => {
      if (tab !== 'all' && !TAB_STATUSES[tab].includes(status)) return false;
      if (category !== 'any' && row.provider_category !== category) return false;
      if (strikesOnly && row.active_strikes === 0) return false;
      if (!needle) return true;
      return (
        row.display_name?.toLowerCase().includes(needle) ||
        row.provider_category?.toLowerCase().includes(needle) ||
        row.id.startsWith(needle)
      );
    })
    .sort((a, b) => compare(a.row, b.row, sort.key, sort.dir));

  const hasFilters = needle !== '' || category !== 'any' || strikesOnly;
  function clearFilters() {
    setQ('');
    setCategory('any');
    setStrikesOnly(false);
  }
  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: DEFAULT_DIR[key] }));
  }

  const groups = grouped
    ? STATUS_ORDER.map((key) => ({ key, items: filtered.filter((x) => x.status === key) })).filter((g) => g.items.length > 0)
    : [];

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <SlidersHorizontal /> <span className="hidden sm:inline">Display</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuLabel>Grouping</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={grouped ? 'status' : 'none'} onValueChange={(v) => setGrouped(v === 'status')}>
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">No grouping</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ordering</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort.key} onValueChange={(v) => setSort({ key: v as SortKey, dir: DEFAULT_DIR[v as SortKey] })}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <DropdownMenuRadioItem key={k} value={k}>{SORT_LABEL[k]}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </HeaderActions>

      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader
          className="mb-4"
          title="Providers"
          description={`${rows.length} provider${rows.length === 1 ? '' : 's'} total`}
        />
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0">
          <TabsList className="overflow-x-auto border-b-0">
            <TabsTrigger value="all">All <span className="text-tertiary tabular-nums">{tabCount('all')}</span></TabsTrigger>
            <TabsTrigger value="live">Live <span className="text-tertiary tabular-nums">{tabCount('live')}</span></TabsTrigger>
            <TabsTrigger value="unverified">Unverified <span className="text-tertiary tabular-nums">{tabCount('unverified')}</span></TabsTrigger>
            <TabsTrigger value="restricted">Restricted <span className="text-tertiary tabular-nums">{tabCount('restricted')}</span></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <div role="alert" className="mx-(--page-pad) mb-3 rounded-md border border-danger-dot/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
          Could not load providers: {error}
        </div>
      )}

      {/* Toolbar: filter box, chips, count */}
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-hairline px-(--page-pad) py-1.5">
        <div className="relative">
          <Input
            ref={searchRef}
            aria-label="Search providers"
            placeholder="Filter by name, category or ID…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-7 w-56 pr-7 sm:w-64"
          />
          {!q && <Kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2">/</Kbd>}
        </div>
        <FilterChip label="Category" value={category === 'any' ? 'Any' : category} active={category !== 'any'}>
          <DropdownMenuRadioGroup value={category} onValueChange={setCategory}>
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            {categories.map((c) => (
              <DropdownMenuRadioItem key={c} value={c}>{c}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </FilterChip>
        <FilterChip label="Strikes" value={strikesOnly ? 'Active' : 'Any'} active={strikesOnly}>
          <DropdownMenuRadioGroup value={strikesOnly ? 'active' : 'any'} onValueChange={(v) => setStrikesOnly(v === 'active')}>
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="active">Has active strikes</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </FilterChip>
        {hasFilters && (
          <Button size="xs" variant="ghost" onClick={clearFilters}>
            <X /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-tertiary tabular-nums" aria-live="polite">
          {filtered.length === rows.length ? `${rows.length} providers` : `${filtered.length} of ${rows.length}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          cause="cold-start"
          inline
          className="py-20"
          title="No providers yet"
          body="Providers appear here once they finish onboarding in the app."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          cause="no-results"
          inline
          className="py-20"
          title="No providers match"
          body="Try a different search or clear the filters."
          action={hasFilters ? <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          {/* Column heads: sticky inside the shell's scroller */}
          <div
            role="row"
            className="sticky top-0 z-[2] flex h-8 items-center gap-3 border-b border-hairline bg-surface px-4"
          >
            <span className={COL.id} aria-hidden="true" />
            <span className="w-3.5 shrink-0" aria-hidden="true" />
            <SortHead label="Provider" sortKey="name" sort={sort} onSort={toggleSort} className="min-w-0 flex-1" />
            {!grouped && <span role="columnheader" className={cn(COL.status, 'text-xs font-medium text-tertiary')}>Status</span>}
            <span role="columnheader" className={cn(COL.category, 'text-xs font-medium text-tertiary')}>Category</span>
            <span role="columnheader" className={cn(COL.strikes, 'text-xs font-medium text-tertiary')}>Strikes</span>
            <span role="columnheader" className={cn(COL.photos, 'text-xs font-medium text-tertiary')}>Photos</span>
            <SortHead label="Rating" sortKey="rating" sort={sort} onSort={toggleSort} className={COL.rating} />
            <SortHead label="Pending" sortKey="pending" sort={sort} onSort={toggleSort} className={COL.pending} />
            <SortHead label="Joined" sortKey="joined" sort={sort} onSort={toggleSort} className={COL.joined} />
          </div>

          {grouped ? (
            <div>
              {groups.map(({ key, items }) => (
                <ListGroup
                  key={key}
                  icon={<StatusIcon state={STATUS_META[key].state} tone={STATUS_META[key].tone} />}
                  title={STATUS_META[key].label}
                  count={items.length}
                >
                  <List>
                    {items.map(({ row, status }) => (
                      <ProviderListRow key={row.id} row={row} status={status} showStatus={false} />
                    ))}
                  </List>
                </ListGroup>
              ))}
            </div>
          ) : (
            <List>
              {filtered.map(({ row, status }) => (
                <ProviderListRow key={row.id} row={row} status={status} showStatus />
              ))}
            </List>
          )}
        </>
      )}
    </div>
  );
}
