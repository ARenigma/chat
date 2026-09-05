/**
 * cashfree-payout — disburse a provider's cleared earnings via Cashfree Payouts.
 *
 * MANUAL, admin-triggered (no cron, by request). Called from the admin console
 * with a founder's session; this function re-checks the founder allowlist before
 * moving any money.
 *
 * Flow (money-critical steps are atomic in SQL — migration 050):
 *   1. Verify JWT → founder allowlist.
 *   2. create_provider_payout_batch(provider_id) locks the eligible earnings,
 *      creates a 'processing' batch, and stamps the rows 'paid' — so a second
 *      trigger cannot double-pay.
 *   3. Cashfree Standard Transfer V2 to the provider's beneficiary.
 *   4. settle_provider_payout_batch records the terminal state (or reverts the
 *      earnings on failure).
 *
 * Terminal confirmation of an accepted (RECEIVED/PENDING) transfer comes from
 * the TRANSFER_* webhook on cashfree-webhook (migration 060). Sync path only
 * stamps cf_transfer_id and leaves the batch processing — Cashfree docs say
 * success requires status=SUCCESS and status_code=COMPLETED
 * (TRANSFER_ACKNOWLEDGED). Hard sync rejects still revert immediately.
 *
 * Standard Transfer V2:
 *   https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/standard-transfer-v2
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { cashfreeSignature } from '../_shared/cashfreeSignature.ts';

function payoutBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.cashfree.com/payout'
    : 'https://sandbox.cashfree.com/payout';
}

async function payoutHeaders(): Promise<HeadersInit> {
  const clientId =
    Deno.env.get('CASHFREE_PAYOUT_CLIENT_ID') ?? Deno.env.get('CASHFREE_CLIENT_ID') ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-version': Deno.env.get('CASHFREE_PAYOUT_API_VERSION') ?? '2024-01-01',
    'x-client-id': clientId,
    'x-client-secret':
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_CLIENT_SECRET') ??
      '',
  };
  /*
   * Payouts 2FA, and without it NO TRANSFER EVER SUCCEEDS.
   *
   * Cashfree requires either an IP allow-list or an `x-cf-signature` on every
   * Payouts call. Edge Functions have no static egress IP — proved on
   * 2026-09-05, when two consecutive calls left from 13.232.152.52 and then
   * 13.204.71.66 — so the allow-list cannot work and the signature is the only
   * route. `verify-payout-account` returned `IP not whitelisted` on every
   * attempt until this was added, and it is the same account and the same
   * product, so this function would have done the same on the first real
   * transfer. It is only unproven here because no transfer has run yet.
   * https://www.cashfree.com/docs/payouts/payouts/integrations/payouts-2fa
   *
   * Null when no public key is configured, so an account that IS on an
   * allow-list keeps working unchanged.
   */
  const signature = await cashfreeSignature(
    clientId,
    Deno.env.get('CASHFREE_PAYOUT_PUBLIC_KEY') ??
      Deno.env.get('CASHFREE_VERIFICATION_PUBLIC_KEY'),
  );
  if (signature !== null) {
    headers['x-cf-signature'] = signature;
  }
  return headers;
}

/**
 * Whether a rejection is Cashfree refusing to talk to US rather than refusing
 * this transfer.
 *
 * The batch is still settled failed either way, and that is deliberate: the
 * settle releases the claimed earnings back to `cleared` (migration 060), so a
 * provider's money returns and a retry can pick it up. Leaving the batch
 * `processing` instead would strand the earnings as claimed with nothing moving,
 * which is worse.
 *
 * What changes is what we SAY. "transfer rejected" against a provider's batch
 * when the truth is our own 2FA is the same misattribution `verify-payout-account`
 * was making, and it is what sent a day into Cashfree's sandbox instead of into
 * our own headers.
 */
function isOurAuthFailure(status: number, reason: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    /ip not whitelisted|signature|two.?factor|2fa|unauthoriz|authentication|invalid client/i.test(
      reason,
    )
  );
}

interface BatchRow {
  batch_id: string;
  total_tokens: number;
  total_paise: number;
  method: 'upi' | 'bank';
  beneficiary_id: string;
}

Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  // 1. Founder-only.
  const authHeader = request.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: founder } = await admin
    .schema('admin')
    .from('founder_allowlist')
    .select('email')
    .eq('email', userData.user.email)
    .maybeSingle();
  if (!founder) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    providerId?: string;
    ignoreMinimum?: boolean;
  };
  if (!body.providerId) {
    return Response.json({ error: 'providerId is required' }, { status: 400 });
  }

  // 2. Atomically claim the eligible earnings into a batch.
  const { data: batchData, error: batchErr } = await admin.rpc('create_provider_payout_batch', {
    p_provider_id: body.providerId,
    p_ignore_minimum: body.ignoreMinimum ?? false,
  });
  if (batchErr) {
    // A raise() from the SQL surfaces here as a readable reason for the admin.
    return Response.json({ error: batchErr.message }, { status: 400 });
  }
  const batch = (Array.isArray(batchData) ? batchData[0] : batchData) as BatchRow | undefined;
  if (!batch) {
    return Response.json({ error: 'nothing to pay' }, { status: 400 });
  }

  // 3. Cashfree Standard Transfer V2 (amount in rupees).
  try {
    const res = await fetch(`${payoutBaseUrl()}/transfers`, {
      method: 'POST',
      headers: await payoutHeaders(),
      body: JSON.stringify({
        transfer_id: batch.batch_id,
        transfer_amount: batch.total_paise / 100,
        transfer_mode: batch.method === 'upi' ? 'upi' : 'banktransfer',
        beneficiary_details: { beneficiary_id: batch.beneficiary_id },
      }),
    });
    const cf = (await res.json()) as { cf_transfer_id?: string; status?: string; message?: string };
    // RECEIVED/PENDING mean Cashfree accepted the request — not bank credit.
    // Leave the batch processing; TRANSFER_ACKNOWLEDGED webhook settles it.
    const accepted =
      res.ok && ['RECEIVED', 'PENDING', 'APPROVED', 'SUCCESS', 'COMPLETED'].includes(cf.status ?? '');

    if (accepted) {
      await admin.rpc('mark_provider_payout_submitted', {
        p_batch_id: batch.batch_id,
        p_cashfree_id: cf.cf_transfer_id ?? null,
      });
      // Only COMPLETED/SUCCESS on the sync response is treated as terminal
      // (rare for Standard Transfer V2 — usually RECEIVED then webhook).
      if (cf.status === 'COMPLETED' || cf.status === 'SUCCESS') {
        await admin.rpc('settle_provider_payout_batch', {
          p_batch_id: batch.batch_id,
          p_cashfree_id: cf.cf_transfer_id ?? null,
          p_ok: true,
        });
      }
      return Response.json({
        status: cf.status === 'COMPLETED' || cf.status === 'SUCCESS' ? 'paid' : 'processing',
        batchId: batch.batch_id,
        amountPaise: batch.total_paise,
        cashfreeStatus: cf.status,
      });
    }

    await admin.rpc('settle_provider_payout_batch', {
      p_batch_id: batch.batch_id,
      p_cashfree_id: cf.cf_transfer_id ?? null,
      p_ok: false,
    });

    const reason = cf.message ?? cf.status ?? 'transfer rejected';
    const ourFault = isOurAuthFailure(res.status, reason);
    if (ourFault) {
      // Loud, because it is a configuration fault that fails EVERY payout and
      // is invisible from the provider's side.
      console.error(`cashfree-payout: Cashfree refused our credentials: ${reason}`);
    }
    return Response.json({
      status: 'failed',
      batchId: batch.batch_id,
      amountPaise: batch.total_paise,
      error: reason,
      // So the admin console and the logs do not read this as the provider's
      // account being bad when it is our 2FA.
      fault: ourFault ? 'ours' : 'cashfree',
    });
  } catch (err) {
    console.error('cashfree-payout failed:', (err as Error).message);
    await admin.rpc('settle_provider_payout_batch', {
      p_batch_id: batch.batch_id,
      p_cashfree_id: null,
      p_ok: false,
    });
    return Response.json({ error: 'transfer error' }, { status: 500 });
  }
});
