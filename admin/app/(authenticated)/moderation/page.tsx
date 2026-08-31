import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface ModerationRow {
  id: string;
  reported_user_id?: string;
  reporter_id?: string;
  reason?: string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export default async function ModerationPage() {
  const svc = createServiceClient();
  const { data: queue, error } = await svc
    .from('moderation_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (queue ?? []) as ModerationRow[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Moderation queue" subtitle="Pending reports awaiting review." />

      <div className="rounded-lg border bg-blue-50 border-blue-200 px-4 py-3 flex items-start gap-3 text-sm">
        <span className="text-blue-600 mt-0.5">ℹ</span>
        <span className="text-blue-800">
          This queue is read-only. Enforcement actions (approve, dismiss, ban) require a
          separate policy workflow and will be added in the next release.
        </span>
      </div>

      {error != null && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 text-sm">
          <span className="text-red-600 mt-0.5">✕</span>
          <span className="text-red-800">Could not load moderation queue: {error.message}</span>
        </div>
      )}

      {rows.length === 0 && error == null ? (
        <EmptyState cause="cold-start" icon="✓" title="Queue is empty" body="No pending reports at the moment. All clear." />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="py-0 gap-0 hidden sm:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report ID</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={String(row.id ?? i)}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {String(row.id ?? '—').slice(0, 8)}…
                      </TableCell>
                      <TableCell>{String(row.reason ?? row['report_reason'] ?? '—')}</TableCell>
                      <TableCell>
                        <StatusBadge status={String(row.status ?? 'unknown')} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {row.created_at != null
                          ? new Date(String(row.created_at)).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short', year: '2-digit',
                            })
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map((row, i) => (
              <Card key={String(row.id ?? i)} className="py-0 gap-0">
                <CardContent className="px-4 py-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(row.id ?? '—').slice(0, 8)}…
                    </span>
                    <StatusBadge status={String(row.status ?? 'unknown')} />
                  </div>
                  <p className="text-sm">{String(row.reason ?? row['report_reason'] ?? '—')}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.created_at != null
                      ? new Date(String(row.created_at)).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', year: '2-digit',
                        })
                      : '—'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
