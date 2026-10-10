'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { rupeesFromTokens } from '@/lib/money';
import type { ProviderRow } from './page';

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

function statusLabel(row: ProviderRow): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (row.suspended_until && new Date(row.suspended_until) > new Date()) {
    return { label: row.suspended_until.startsWith('2999') ? 'Banned' : 'Suspended', variant: 'destructive' };
  }
  if (row.delisted_at) return { label: 'Delisted', variant: 'secondary' };
  if (!row.identity_verified) return { label: 'Unverified', variant: 'outline' };
  if (row.presence_online) return { label: 'Online', variant: 'default' };
  if (row.is_available) return { label: 'Available', variant: 'secondary' };
  return { label: 'Offline', variant: 'outline' };
}

interface Props { rows: ProviderRow[] }

export function ProvidersTable({ rows }: Props) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        r.display_name?.toLowerCase().includes(q) ||
        r.provider_category?.toLowerCase().includes(q) ||
        r.id.startsWith(q)
      )
    : rows;

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search by name, category or ID…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />
      {filtered.length === 0 ? (
        <EmptyState cause="no-results" title="No providers match" body="Try a different search." />
      ) : (
        <Card className="py-0 gap-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Photos</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Pending ₹</TableHead>
                  <TableHead>Strikes</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(row => {
                  const { label, variant } = statusLabel(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/providers/${row.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {row.display_name ?? '—'}
                        </Link>
                        <span className="block text-xs text-muted-foreground font-mono">
                          {row.id.slice(0, 8)}…
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{row.provider_category ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={variant}>{label}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{row.photo_count}</TableCell>
                      <TableCell className="text-sm">
                        {row.rating_avg != null
                          ? `${Number(row.rating_avg).toFixed(1)} (${row.rating_count})`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {rupeesFromTokens(row.pending_tokens)}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.active_strikes > 0 ? (
                          <Badge variant="destructive">{row.active_strikes}</Badge>
                        ) : '0'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmt(row.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
