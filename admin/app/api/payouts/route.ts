import { type NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

// Manual provider payouts (no cron). GET lists the payable queue; POST disburses
// one provider's cleared balance via the cashfree-payout Edge function. Both are
// founder-only (admin.founder_allowlist), matching /api/applications.

async function requireFounder(): Promise<{ email: string } | NextResponse> {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const svc = createServiceClient();
  const { data: allowed } = await svc
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', user.email)
    .maybeSingle();
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { email: user.email };
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

  // Invoke the Edge function with the founder's session so it re-checks the
  // allowlist and holds the Cashfree secrets + the money-critical SQL.
  const supabase = await createSessionClient();
  const { data, error } = await supabase.functions.invoke('cashfree-payout', {
    body: { providerId: body.providerId, ignoreMinimum: body.ignoreMinimum ?? false },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
  return NextResponse.json(data);
}
