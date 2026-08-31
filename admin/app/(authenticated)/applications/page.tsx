import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ApplicationActions } from './ApplicationActions';

// Active statuses shown in the main queue; recently resolved shown below.
const QUEUE_STATUSES = ['submitted', 'under_review', 'needs_info'];
const RECENT_STATUSES = ['approved', 'rejected'];

interface ApplicationRow {
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

function age(dob: string | null | undefined): string {
  if (!dob) return '—';
  return String(
    Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)),
  );
}

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

export default async function ApplicationsPage() {
  const svc = createServiceClient();

  const { data: queue, error: queueError } = await svc
    .from('provider_applications')
    .select('*')
    .in('status', QUEUE_STATUSES)
    .order('submitted_at', { ascending: true });

  const { data: recent } = await svc
    .from('provider_applications')
    .select('*')
    .in('status', RECENT_STATUSES)
    .order('reviewed_at', { ascending: false })
    .limit(20);

  const rows = (queue ?? []) as ApplicationRow[];
  const recentRows = (recent ?? []) as ApplicationRow[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Provider applications"
        subtitle="submitted → claim → admit | need info | decline"
      />

      {queueError != null && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3 text-sm">
          <span className="text-red-600 mt-0.5">✕</span>
          <span className="text-red-800">Could not load applications: {queueError.message}</span>
        </div>
      )}

      {rows.length === 0 && queueError == null ? (
        <EmptyState
          cause="cold-start"
          icon="👤"
          title="Queue is empty"
          body="No applications in submitted, under_review, or needs_info."
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="py-0 gap-0 hidden sm:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Languages</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.user_id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.user_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>{row.display_name ?? '—'}</TableCell>
                      <TableCell>{age(row.date_of_birth)}</TableCell>
                      <TableCell className="text-sm">
                        {(row.languages ?? []).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {fmt(row.submitted_at)}
                      </TableCell>
                      <TableCell>
                        <ApplicationActions userId={row.user_id} status={row.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map(row => (
              <Card key={row.user_id} className="py-0 gap-0">
                <CardContent className="px-4 py-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.user_id.slice(0, 8)}…
                    </span>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-sm font-medium">{row.display_name ?? '—'}</p>
                  <p className="text-xs text-muted-foreground">
                    {age(row.date_of_birth)} · {(row.languages ?? []).join(', ') || '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.headline ?? ''}</p>
                  <p className="text-xs text-muted-foreground">submitted {fmt(row.submitted_at)}</p>
                  <ApplicationActions userId={row.user_id} status={row.status} />
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {recentRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recently resolved
          </p>
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Reviewed</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRows.map(row => (
                    <TableRow key={row.user_id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.user_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell>{row.display_name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {fmt(row.reviewed_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                        {row.reviewer_note ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
