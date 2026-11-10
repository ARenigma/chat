'use client';

import * as React from 'react';
import { Funnel, Plus, Star } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { HeaderActions } from '@/components/layout/shell-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar } from '@/components/ui/property';
import { Kbd } from '@/components/ui/kbd';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/EmptyState';
import { PROVIDERS } from '../../fixtures';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Dense table + toolbar + filters, the pattern for Providers / Applications / Payouts. */
export function ProvidersListDemo() {
  const [tab, setTab] = React.useState('all');
  const [q, setQ] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set(['PRV-1040']));

  const rows = PROVIDERS.filter(
    (p) =>
      (tab === 'all' || (tab === 'review' ? p.status === 'under_review' || p.status === 'needs_info' : p.status === 'active')) &&
      p.name.toLowerCase().includes(q.toLowerCase())
  );
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="-mx-(--page-pad) -my-5 md:-my-6">
      <HeaderActions>
        <Button size="sm" variant="ghost">
          <Funnel /> <span className="hidden sm:inline">Filter</span>
        </Button>
        <Button size="sm">
          <Plus /> <span className="hidden sm:inline">Invite provider</span>
        </Button>
      </HeaderActions>

      <div className="px-(--page-pad) pt-5 md:pt-6">
        <PageHeader
          className="mb-4"
          title="Providers"
          description="Everyone who can take sessions: astrologers, listeners and counsellors."
        />
        <Tabs value={tab} onValueChange={setTab} className="gap-0">
          <TabsList className="border-b-0">
            <TabsTrigger value="all">All <span className="text-tertiary">{PROVIDERS.length}</span></TabsTrigger>
            <TabsTrigger value="review">In review <span className="text-tertiary">4</span></TabsTrigger>
            <TabsTrigger value="active">Active <span className="text-tertiary">5</span></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Toolbar */}
      <div className="flex h-11 items-center gap-2 border-y border-hairline px-(--page-pad)">
        <Input
          aria-label="Search providers"
          placeholder="Filter by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-7 max-w-56"
        />
        <Badge dot="info">Language: Hindi</Badge>
        <Badge dot="neutral">Kind: Any</Badge>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-tertiary">
          {selected.size > 0 ? `${selected.size} selected` : `${rows.length} providers`}
          <Kbd>X</Kbd>
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState cause="no-results" inline className="py-20" />
      ) : (
        <Table containerClassName="max-h-[640px] overflow-y-auto">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all"
                  checked={allChecked}
                  onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead className="text-right">Rating</TableHead>
              <TableHead className="text-right">Sessions</TableHead>
              <TableHead className="text-right">Earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} data-state={selected.has(p.id) ? 'selected' : undefined}>
                <TableCell className="w-10">
                  <Checkbox aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={p.name} />
                    <span className="font-medium text-primary">{p.name}</span>
                    <span className="font-mono text-xs text-tertiary">{p.id}</span>
                  </div>
                </TableCell>
                <TableCell><StatusBadge status={p.status} /></TableCell>
                <TableCell className="text-secondary">{p.kind}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {p.languages.map((l) => (
                      <Badge key={l} className="h-[18px] px-1.5 text-2xs">{l}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.rating > 0 ? (
                    <span className="inline-flex items-center gap-1"><Star size={12} weight="fill" className="text-warning-dot" />{p.rating.toFixed(1)}</span>
                  ) : (
                    <span className="text-tertiary">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.sessions.toLocaleString('en-IN')}</TableCell>
                <TableCell className="text-right tabular-nums">{inr.format(p.earnings)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
