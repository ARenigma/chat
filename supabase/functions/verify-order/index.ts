/**
 * verify-order — client-initiated server-side payment verification.
 *
 * Caller: authenticated user (Supabase JWT required).
 * Body:   { orderId: string }
 *
 * The Cashfree client SDK calls onVerify(orderID) on apparent success, but the
 * client cannot be trusted to confirm payment — a tampered client could call
 * this with any orderId. This function re-queries Cashfree server-to-server
 * before crediting tokens.
 *
 * doc: https://www.cashfree.com/docs/payments/online/mobile/android
 * "Never trust the client callback alone. Always verify order status server-side."
 *
 * Flow:
 *   1. Verify JWT — only the order's owner may verify it.
 *   2. Fetch order status from Cashfree S2S (GET /orders/{orderId}).
 *   3. Look up the pending token_transactions row; confirm user_id matches.
 *   4. If order status is PAID: call credit_purchased_recharge (idempotent).
 *   5. If it is terminal and NOT paid: mark the row 'failed', which also hands
 *      back any first-recharge discount claim it was holding (migration 102).
 *   6. Return { status, credited, balance? }.
 *
 * Idempotent: credit_purchased_recharge's status='created' guard means a
 * duplicate verify-order call (network retry, etc.) will not double-credit.
 *
 * ADR-0022: India User Choice Billing
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { withSentry } from '../_shared/sentry.ts';

function cashfreeBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

/** S2S GET /orders/{orderId} — returns order_status and payment details. */
async function fetchCashfreeOrder(orderId: string): Promise<{ order_status: string }> {
  const res = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: {
      'x-api-version': '2023-08-01',
      'x-client-id': Deno.env.get('CASHFREE_CLIENT_ID') ?? '',
      'x-client-secret': Deno.env.get('CASHFREE_CLIENT_SECRET') ?? '',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cashfree order fetch failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ order_status: string }>;
}

Deno.serve(withSentry('verify-order', async (request: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const callerId = userData.user.id;

  let body: { orderId?: string };
  try {
    body = (await request.json()) as { orderId?: string };
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { orderId } = body;
  if (!orderId) {
    return Response.json({ error: 'orderId is required' }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // Step 1: verify the transaction belongs to the calling user.
    const { data: txRow, error: txErr } = await admin
      .from('token_transactions')
      .select('id, user_id, tokens_delta, status')
      .eq('id', orderId)
      .single();

    if (txErr || !txRow) {
      return Response.json({ error: 'order not found' }, { status: 404 });
    }

    const tx = txRow as { id: string; user_id: string; tokens_delta: number; status: string };

    if (tx.user_id !== callerId) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    // Already credited — idempotent early return.
    if (tx.status === 'succeeded') {
      const { data: profile } = await admin
        .from('profiles')
        .select('token_balance')
        .eq('id', callerId)
        .single();
      const balance = (profile as { token_balance?: number } | null)?.token_balance ?? undefined;
      return Response.json({ status: 'PAID', credited: true, balance });
    }

    // Step 2: server-to-server query to Cashfree — never trust the client alone.
    const cashfreeOrder = await fetchCashfreeOrder(orderId);
    const cfStatus = cashfreeOrder.order_status;

    if (cfStatus !== 'PAID') {
      // Record a terminal non-payment as a terminal non-payment.
      //
      // Cashfree's order_status enum (api-reference/payments/latest/orders/get)
      // has exactly one non-terminal value: ACTIVE, "Order does not have a
      // successful transaction yet". EXPIRED, TERMINATED and
      // TERMINATION_REQUESTED are terminal — "No transaction can be initiated
      // for an EXPIRED order" — so the row can never become succeeded and
      // leaving it at 'created' is simply wrong.
      //
      // It also matters to pricing: an order marked 'failed' releases the
      // member's first-recharge claim immediately (migration 102), so a
      // member whose first attempt died does not have to wait out the
      // 20-minute backstop before the offer is available again. ACTIVE is
      // deliberately left alone — that order is still payable, and marking it
      // failed would hand out a second discounted session against a live one.
      if (cfStatus === 'EXPIRED' || cfStatus === 'TERMINATED' || cfStatus === 'TERMINATION_REQUESTED') {
        const { error: failErr } = await admin
          .from('token_transactions')
          .update({ status: 'failed' })
          .eq('id', orderId)
          .eq('status', 'created');
        if (failErr) {
          // Non-fatal: the member's answer is the same either way, and the
          // 20-minute backstop still frees the claim.
          console.error('verify-order: could not mark order failed:', failErr.message);
        }
      }
      return Response.json({ status: cfStatus, credited: false });
    }

    // Step 3: credit tokens. credit_purchased_recharge is idempotent via
    // status='created' guard (migration 033).
    const { error: creditErr } = await admin.rpc('credit_purchased_recharge', {
      p_user_id: tx.user_id,
      p_amount: tx.tokens_delta,
      p_transaction_id: tx.id,
    });

    if (creditErr) {
      console.error('verify-order: credit_purchased_recharge failed:', creditErr.message);
      return Response.json({ error: 'credit failed' }, { status: 500 });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('token_balance')
      .eq('id', callerId)
      .single();
    const balance = (profile as { token_balance?: number } | null)?.token_balance ?? undefined;

    return Response.json({ status: 'PAID', credited: true, balance });
  } catch (err) {
    console.error('verify-order error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}));
