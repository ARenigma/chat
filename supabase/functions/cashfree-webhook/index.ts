/**
 * cashfree-webhook — Cashfree PG payment events + Payouts transfer events.
 *
 * CRITICAL: The raw body MUST be read as text before JSON.parse.
 * Signature = HMAC-SHA256(timestamp + rawBody). Parsing JSON first corrupts
 * whitespace/key ordering and breaks the signature check.
 *
 * Payments (ADR-0022):
 *   PAYMENT_SUCCESS_WEBHOOK → credit_purchased_recharge (idempotent)
 *   PAYMENT_FAILED_* → mark token_transactions failed
 *
 * Payouts V2 (docs.cashfree.com/.../payouts/v2/webhooks/webhooks-v2):
 *   TRANSFER_ACKNOWLEDGED (SUCCESS+COMPLETED) → settle ok
 *   TRANSFER_FAILED / REVERSED / REJECTED → settle fail (revert earnings)
 *   TRANSFER_SUCCESS (SENT_TO_BENEFICIARY) → leave processing (not terminal)
 *
 * transfer_id is our provider_payout_batches.id (set on Standard Transfer V2).
 *
 * Signature secrets tried in order: payout client secret, webhook secret,
 * PG client secret — Cashfree Payouts signs with the oldest active client secret.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

async function verifySignature(opts: {
  timestamp: string;
  rawBody: string;
  receivedSig: string;
  secret: string;
}): Promise<boolean> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(opts.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(opts.timestamp + opts.rawBody),
  );
  const computedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return computedSig === opts.receivedSig;
}

async function verifyAgainstSecrets(
  timestamp: string,
  rawBody: string,
  receivedSig: string,
  secrets: string[],
): Promise<boolean> {
  for (const secret of secrets) {
    if (!secret) continue;
    if (await verifySignature({ timestamp, rawBody, receivedSig, secret })) {
      return true;
    }
  }
  return false;
}

const TRANSFER_OK = new Set(['TRANSFER_ACKNOWLEDGED']);
const TRANSFER_FAIL = new Set([
  'TRANSFER_FAILED',
  'TRANSFER_REVERSED',
  'TRANSFER_REJECTED',
]);

Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('not configured', { status: 500 });
  }
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get('x-webhook-timestamp') ?? '';
  const receivedSig = request.headers.get('x-webhook-signature') ?? '';

  // Cashfree "Test & Add Webhook" sends a LOW_BALANCE_ALERT reachability probe
  // and may omit HMAC headers. Docs require HTTP 200 or the URL is rejected.
  // Never mutate money state without a verified signature.
  if (!timestamp || !receivedSig) {
    console.warn('cashfree-webhook: missing signature headers; ack without processing');
    return new Response('ok', { status: 200 });
  }

  const secrets = [
    Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ?? '',
    Deno.env.get('CASHFREE_WEBHOOK_SECRET') ?? '',
    Deno.env.get('CASHFREE_CLIENT_SECRET') ?? '',
  ];
  if (!(await verifyAgainstSecrets(timestamp, rawBody, receivedSig, secrets))) {
    // Probe signed with an unexpected secret must still return 200 so
    // registration succeeds; real TRANSFER_*/PAYMENT_* stay unprocessed.
    try {
      const probe = JSON.parse(rawBody) as { type?: string };
      if (probe.type === 'LOW_BALANCE_ALERT') {
        console.warn('cashfree-webhook: LOW_BALANCE_ALERT signature mismatch; ack');
        return new Response('ok', { status: 200 });
      }
    } catch {
      /* fall through */
    }
    return new Response('Unauthorized', { status: 401 });
  }

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
  const data = (payload.data ?? {}) as Record<string, unknown>;

  // --- Payouts transfer events (no order_id) ---------------------------------
  if (eventType && (TRANSFER_OK.has(eventType) || TRANSFER_FAIL.has(eventType))) {
    const transferId = data.transfer_id as string | undefined;
    const cfTransferId =
      (data.cf_transfer_id as string | undefined) ??
      (data.cf_transferId as string | undefined) ??
      null;
    if (!transferId) {
      console.warn('cashfree-webhook: transfer event missing transfer_id');
      return new Response('ok', { status: 200 });
    }

    // Docs: terminal success is SUCCESS + COMPLETED (TRANSFER_ACKNOWLEDGED).
    // TRANSFER_SUCCESS with SENT_TO_BENEFICIARY is intermediate — ignore.
    if (eventType === 'TRANSFER_SUCCESS') {
      return new Response('ok', { status: 200 });
    }

    const { error } = await admin.rpc('settle_provider_payout_batch', {
      p_batch_id: transferId,
      p_cashfree_id: cfTransferId,
      p_ok: TRANSFER_OK.has(eventType),
    });
    if (error) {
      console.error(`cashfree-webhook: settle ${eventType}:`, error.message);
    }
    return new Response('ok', { status: 200 });
  }

  // LOW_BALANCE_ALERT is Cashfree's "Test & Add Webhook" probe — always 200.
  if (
    eventType === 'LOW_BALANCE_ALERT' ||
    eventType === 'CREDIT_CONFIRMATION' ||
    eventType === 'BENEFICIARY_INCIDENT' ||
    eventType === 'BULK_TRANSFER_REJECTED'
  ) {
    return new Response('ok', { status: 200 });
  }

  // --- Payments PG events ---------------------------------------------------
  const order = data.order as Record<string, unknown> | undefined;
  const orderId = order?.order_id as string | undefined;
  if (!orderId) {
    console.warn('cashfree-webhook: no order_id in payload', eventType);
    return new Response('ok', { status: 200 });
  }

  if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') {
    const { data: txRow, error: txErr } = await admin
      .from('token_transactions')
      .select('id, user_id, tokens_delta, amount_paise, status')
      .eq('id', orderId)
      .single();

    if (txErr || !txRow) {
      console.error(`cashfree-webhook: transaction ${orderId} not found:`, txErr?.message);
      return new Response('ok', { status: 200 });
    }

    const tx = txRow as {
      id: string;
      user_id: string;
      tokens_delta: number;
      amount_paise: number;
      status: string;
    };

    // Defense in depth (2026-09-10 audit): the credit comes from OUR stored
    // tokens_delta, never the payload, so the webhook cannot inflate it. But
    // confirm the amount the webhook reports matches the amount we recorded when
    // we created the order before crediting at all — a mismatch means the order
    // is not the one we think it is, and we must not credit it. Cashfree reports
    // order_amount in rupees; our amount_paise is paise.
    const reportedRupees =
      typeof order?.order_amount === 'number'
        ? order.order_amount
        : Number(order?.order_amount);
    const reportedPaise = Math.round(reportedRupees * 100);
    if (!Number.isFinite(reportedPaise) || reportedPaise !== tx.amount_paise) {
      console.error(
        `cashfree-webhook: order ${orderId} amount mismatch — reported ${reportedPaise}p vs recorded ${tx.amount_paise}p; not crediting`,
      );
      return new Response('ok', { status: 200 });
    }

    const { error: creditErr } = await admin.rpc('credit_purchased_recharge', {
      p_user_id: tx.user_id,
      p_amount: tx.tokens_delta,
      p_transaction_id: tx.id,
    });
    if (creditErr) {
      console.error('cashfree-webhook: credit_purchased_recharge failed:', creditErr.message);
    }
  } else if (
    eventType === 'PAYMENT_FAILED_WEBHOOK' ||
    eventType === 'PAYMENT_USER_DROPPED_WEBHOOK'
  ) {
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
