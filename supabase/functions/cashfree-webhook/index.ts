/**
 * cashfree-webhook — receive and verify Cashfree payment events.
 *
 * CRITICAL: The raw body MUST be read as text before JSON.parse.
 * Signature = HMAC-SHA256(timestamp + rawBody). Parsing JSON first corrupts
 * whitespace/key ordering and breaks the signature check.
 *
 * On PAYMENT_SUCCESS_WEBHOOK:
 *   1. Verify HMAC-SHA256 signature.
 *   2. Call credit_purchased_recharge RPC (migration 033), which:
 *      - Marks the token_transactions row status='succeeded' (idempotent).
 *      - Credits profiles.purchased_balance (sync trigger updates token_balance).
 *   3. Return 200.
 *
 * On PAYMENT_FAILED_WEBHOOK or any non-success type:
 *   - Mark the transaction row status='failed'.
 *   - Return 200. (Webhooks must always return 200 after signature verification.)
 *
 * A replayed webhook is safe: credit_purchased_recharge's status='created'
 * guard means tokens are credited at most once per order.
 *
 * doc: developer.cashfree.com/docs/webhooks
 * ADR-0022
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// ---------------------------------------------------------------------------
async function verifySignature(opts: {
  timestamp: string;
  rawBody: string;
  receivedSig: string;
  secret: string;
}): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(opts.secret);
  const messageData = encoder.encode(opts.timestamp + opts.rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const computedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  return computedSig === opts.receivedSig;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('CASHFREE_WEBHOOK_SECRET') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response('not configured', { status: 500 });
  }

  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // Raw body MUST be read before JSON.parse. HMAC-SHA256(timestamp + rawBody).
  // Parsing JSON first corrupts whitespace/ordering and breaks the signature.
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';
  const receivedSig = request.headers.get('x-webhook-signature') ?? '';

  if (!timestamp || !receivedSig) {
    return new Response('missing signature headers', { status: 400 });
  }

  const valid = await verifySignature({ timestamp, rawBody, receivedSig, secret: webhookSecret });
  if (!valid) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Signature verified — parse and handle. Must return 200 from here on.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.error('cashfree-webhook: invalid JSON body');
    return new Response('ok', { status: 200 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const eventType = payload.type as string | undefined;
  const data = payload.data as Record<string, unknown> | undefined;
  const order = data?.order as Record<string, unknown> | undefined;
  const orderId = order?.order_id as string | undefined;

  if (!orderId) {
    console.warn('cashfree-webhook: no order_id in payload');
    return new Response('ok', { status: 200 });
  }

  if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') {
    // Look up the pending transaction to get user_id and tokens.
    const { data: txRow, error: txErr } = await admin
      .from('token_transactions')
      .select('id, user_id, tokens_delta, status')
      .eq('id', orderId)
      .single();

    if (txErr || !txRow) {
      // Order not found — may have been created by a different system, or
      // the orderId doesn't match. Log and return 200 (no retry needed).
      console.error(`cashfree-webhook: transaction ${orderId} not found:`, txErr?.message);
      return new Response('ok', { status: 200 });
    }

    const tx = txRow as { id: string; user_id: string; tokens_delta: number; status: string };

    // credit_purchased_recharge (migration 033) is idempotent: the status='created'
    // guard means a replayed webhook will find status='succeeded' and return
    // without crediting again.
    const { error: creditErr } = await admin.rpc('credit_purchased_recharge', {
      p_user_id: tx.user_id,
      p_amount: tx.tokens_delta,
      p_transaction_id: tx.id,
    });

    if (creditErr) {
      console.error('cashfree-webhook: credit_purchased_recharge failed:', creditErr.message);
      // Do not return 4xx — Cashfree will retry, and the RPC is idempotent.
      // Log and return 200 to prevent exponential retry backoff on our end.
    }
  } else if (
    eventType === 'PAYMENT_FAILED_WEBHOOK' ||
    eventType === 'PAYMENT_USER_DROPPED_WEBHOOK'
  ) {
    // Mark failed; do not credit. Idempotent: update is a no-op if already failed.
    const { error: failErr } = await admin
      .from('token_transactions')
      .update({ status: 'failed' })
      .eq('id', orderId)
      .eq('status', 'created');

    if (failErr) {
      console.error('cashfree-webhook: status update to failed:', failErr.message);
    }
  }

  return new Response('ok', { status: 200 });
});
