import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ContactGuardActions } from './ContactGuardActions';
import { RefundActions } from './RefundActions';

export const dynamic = 'force-dynamic';

interface ContactGuardRow {
  user_id: string;
  role: string | null;
  display_name: string | null;
  review_state: string | null;
  review_requested_at: string | null;
  active_strikes: number;
  paused_until: string | null;
  directory_hidden_until: string | null;
  suspended_until: string | null;
  last_event_at: string | null;
  categories: string[] | null;
}

interface RefundRow {
  id: string;
  user_id: string;
  purchased_tokens: number;
  amount_paise: number;
  status: string;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default async function QueuesPage() {
  const svc = createServiceClient();

  const [cgResult, refundResult] = await Promise.all([
    svc.from('contact_guard_review_queue').select('*').order('review_requested_at', { ascending: true }),
    svc.from('refund_reviews').select('*').order('created_at', { ascending: true }),
  ]);

  const cgRows = (cgResult.data ?? []) as ContactGuardRow[];
  const refundRows = (refundResult.data ?? []) as RefundRow[];
  const pendingRefunds = refundRows.filter(r => r.status === 'pending');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Queues"
        subtitle="Contact-guard reviews and refund reviews"
      />

      {/* Contact-guard review queue */}
      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contact-guard review ({cgRows.length})
        </p>
        {cgResult.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {cgResult.error.message}
          </div>
        )}
        {cgRows.length === 0 && !cgResult.error ? (
          <EmptyState cause="cold-start" icon="✓" title="Queue is empty" body="No contact-guard reviews pending." />
        ) : (
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Strikes</TableHead>
                    <TableHead>Categories</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cgRows.map(row => (
                    <TableRow key={row.user_id}>
                      <TableCell>
                        <span className="font-medium text-sm">{row.display_name ?? '—'}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {row.user_id.slice(0, 8)}…
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.review_state === 'human_review' ? 'destructive' : 'secondary'}>
                          {row.review_state ?? '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">{row.active_strikes}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                        {(row.categories ?? []).join(', ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmt(row.review_requested_at)}
                      </TableCell>
                      <TableCell>
                        <ContactGuardActions userId={row.user_id} reviewState={row.review_state ?? ''} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Refund review queue */}
      <section className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Refund reviews — pending ({pendingRefunds.length} of {refundRows.length} total)
        </p>
        {refundResult.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {refundResult.error.message}
          </div>
        )}
        {refundRows.length === 0 && !refundResult.error ? (
          <EmptyState cause="cold-start" icon="✓" title="No refund reviews" body="No account-closure refund cases have been queued." />
        ) : (
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Resolved by</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {refundRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.user_id.slice(0, 8)}…
                      </TableCell>
                      <TableCell className="text-sm">{row.purchased_tokens.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-sm">₹{(row.amount_paise / 100).toLocaleString('en-IN')}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'pending' ? 'outline' : row.status === 'approved' ? 'default' : 'secondary'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmt(row.created_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.resolved_by ?? '—'}</TableCell>
                      <TableCell>
                        {row.status === 'pending' && <RefundActions reviewId={row.id} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
