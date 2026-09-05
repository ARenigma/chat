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

function payoutBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.cashfree.com/payout'
    : 'https://sandbox.cashfree.com/payout';
}

function payoutHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-api-version': Deno.env.get('CASHFREE_PAYOUT_API_VERSION') ?? '2024-01-01',
    'x-client-id':
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_ID') ?? Deno.env.get('CASHFREE_CLIENT_ID') ?? '',
    'x-client-secret':
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_CLIENT_SECRET') ??
      '',
  };
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
      headers: payoutHeaders(),
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

    return Response.json({
      status: 'failed',
      batchId: batch.batch_id,
      amountPaise: batch.total_paise,
      error: cf.message ?? cf.status ?? 'transfer rejected',
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
