import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  action: string;
  domain: string | null;
  actor: string;
  reason: string;
  confirmation: string | null;
  created_at: string;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? '1', 10));
  const offset = (pageNum - 1) * PAGE_SIZE;

  const svc = createServiceClient();
  const { data, count, error } = await svc
    .schema('admin')
    .from('config_audit')
    .select('id, action, domain, actor, reason, confirmation, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const rows = (data ?? []) as AuditRow[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        subtitle={`Immutable record of all config changes. ${total.toLocaleString()} entries.`}
      />

      {error != null && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 text-sm">
          <span className="text-red-600 mt-0.5">✕</span>
          <span className="text-red-800">Could not load audit log: {error.message}</span>
        </div>
      )}

      {rows.length === 0 && error == null ? (
        <EmptyState
          cause="cold-start"
          icon="📋"
          title="No audit entries yet"
          body="Every config change is recorded here permanently once you publish a version."
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="py-0 gap-0 hidden sm:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead className="whitespace-nowrap">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell><StatusBadge status={row.action} /></TableCell>
                      <TableCell className="text-muted-foreground text-sm">{row.domain ?? '—'}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{row.reason || '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">
                        {row.actor}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString('en-IN', {
                          day: 'numeric', month: 'short', year: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map((row) => (
              <Card key={row.id} className="py-0 gap-0">
                <CardContent className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={row.action} />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {row.domain && <p className="text-xs font-medium">{row.domain}</p>}
                  {row.reason && <p className="text-sm text-muted-foreground">{row.reason}</p>}
                  <p className="font-mono text-xs text-muted-foreground truncate">{row.actor}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4">
          {pageNum > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/audit?page=${pageNum - 1}`}>← Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">Page {pageNum} of {totalPages}</span>
          {pageNum < totalPages ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/audit?page=${pageNum + 1}`}>Next →</Link>
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
