import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { founderAllowlistRow } from '@/lib/auth/founder';

// Manual provider payouts (no cron). GET lists the payable queue; POST disburses
// one provider's cleared balance via the cashfree-payout Edge function. Both are
// founder-only (admin.founder_allowlist), matching /api/applications.
//
// This is the route that reaches real money (via cashfree-payout), so
// requireFounder uses founderAllowlistRow — a verified Google identity, not
// just an email match. See admin/lib/auth/founder.ts.
async function requireFounder(): Promise<{ email: string } | NextResponse> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const allowed = await founderAllowlistRow(user);
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { email: allowed.email };
}

// GET /api/payouts — the payable queue.
export async function GET() {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) {
    return gate;
  }
  const svc = createServiceClient();
  const { data, error } = await svc
    .schema('admin')
    .from('payable_providers')
    .select('*')
    .order('claimable_tokens', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ providers: data ?? [] });
}

// POST /api/payouts — disburse one provider. Body: { providerId, ignoreMinimum? }
export async function POST(request: NextRequest) {
  const gate = await requireFounder();
  if (gate instanceof NextResponse) {
    return gate;
  }

  let body: { providerId?: string; ignoreMinimum?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.providerId) {
    return NextResponse.json({ error: 'providerId is required' }, { status: 400 });
  }

  const actor = (gate as { email: string }).email;

  // Invoke the Edge function with the founder's session so it re-checks the
  // allowlist and holds the Cashfree secrets + the money-critical SQL.
  const supabase = await createSessionClient();
  const { data, error } = await supabase.functions.invoke('cashfree-payout', {
    body: {
      providerId: body.providerId,
      ignoreMinimum: body.ignoreMinimum ?? false,
    },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  // 191: record who started the payout on the batch the function created, and
  // write an audit row. The batch function itself is left as it is: the
  // payout function depends on its arguments and its result shape.
  // The money has already moved, so a failed record cannot undo the payout.
  // It is reported back instead, so the operator knows to record it by hand.
  const svc = createServiceClient();
  const recordErrors: string[] = [];
  const batchId = (data as { batchId?: string } | null)?.batchId;
  if (batchId) {
    const stamp = await svc
      .from('provider_payout_batches')
      .update({ initiated_by: actor })
      .eq('id', batchId);
    if (stamp.error) recordErrors.push(`initiated_by: ${stamp.error.message}`);
  }
  const audit = await svc.schema('admin').from('audit_log').insert({
    action: 'payout_initiated',
    target_id: body.providerId,
    target_type: 'payout',
    actor,
    reason: 'manual payout from admin console',
    metadata: { ignoreMinimum: body.ignoreMinimum ?? false, response: data },
  });
  if (audit.error) recordErrors.push(`audit_log: ${audit.error.message}`);

  if (recordErrors.length > 0) {
    console.error('payout recorded incompletely', { batchId, recordErrors });
    return NextResponse.json({
      ...(data as object),
      recordError: `Payout sent, but not fully recorded (${recordErrors.join('; ')})`,
    });
  }
  return NextResponse.json(data);
}
