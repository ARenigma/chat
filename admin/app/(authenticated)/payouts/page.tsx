import { createServiceClient } from '@/lib/supabase/service';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PayoutActions } from './PayoutActions';

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

export default async function PayoutsPage() {
  const svc = createServiceClient();
  const { data, error } = await svc
    .schema('admin')
    .from('payable_providers')
    .select('*')
    .order('claimable_tokens', { ascending: false });

  const rows = (data ?? []) as PayableRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payouts"
        subtitle="Providers with a claimable balance. Payouts are triggered manually."
      />

      {error ? (
        <Card>
          <CardContent className="p-4 text-sm text-destructive">{error.message}</CardContent>
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
    </div>
  );
}
