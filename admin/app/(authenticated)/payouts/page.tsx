import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PayoutActions } from './PayoutActions';

export const dynamic = 'force-dynamic';

// The manual payout queue: providers with cleared, past-hold, unpaid earnings.
// Disbursement is triggered by hand (no cron) via the Pay action, which calls the
// cashfree-payout Edge function. A provider is only `payable` once both their
// payout account AND PAN are verified. See docs/provider-payouts.md.

interface PayableRow {
  provider_id: string;
  display_name: string | null;
  claimable_tokens: number;
  account_status: string | null;
  pan_status: string | null;
  payable: boolean;
}

interface HistoryRow {
  id: string;
  provider_id: string;
  provider_name: string | null;
  status: string;
  total_tokens: number;
  total_paise: number;
  initiated_by: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function fmt(ts: string | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export default async function PayoutsPage() {
  const svc = createServiceClient();
  const [queue, history] = await Promise.all([
    svc.schema('admin').from('payable_providers').select('*').order('claimable_tokens', { ascending: false }),
    svc.schema('admin').from('payout_history').select('*').order('created_at', { ascending: false }).limit(50),
  ]);

  const rows = (queue.data ?? []) as PayableRow[];
  const historyRows = (history.data ?? []) as HistoryRow[];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payouts"
        subtitle="Providers with a claimable balance. Payouts are triggered manually."
      />

      {queue.error ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{queue.error.message}</CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing to pay" body="No provider has a cleared, past-hold balance yet." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Claimable</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.provider_id}>
                    <TableCell className="font-medium">
                      {r.display_name ?? r.provider_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>₹{r.claimable_tokens.toLocaleString('en-IN')}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.account_status ?? 'none'} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.pan_status ?? 'not_provided'} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PayoutActions
                        providerId={r.provider_id}
                        payable={r.payable}
                        amount={r.claimable_tokens}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 191: Payout history */}
      {historyRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            History (last 50)
          </p>
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Initiated by</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="text-sm">
                        {b.provider_name ?? b.provider_id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{b.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{b.total_tokens.toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-sm">₹{(b.total_paise / 100).toLocaleString('en-IN')}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{b.initiated_by ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{fmt(b.created_at)}</TableCell>
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
