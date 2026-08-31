/**
 * create-order — create a pending Cashfree recharge order.
 *
 * Caller: authenticated user (Supabase JWT required).
 *
 * Flow:
 *   1. Verify JWT → get user_id from session.
 *   2. Look up productId in RECHARGE_PACKS.
 *   3. Fetch phone_e164 from profiles; strip leading '+' for Cashfree customer_phone
 *      (Cashfree requires a 10-digit phone without country code).
 *   4. Create a Cashfree order (server-side; secrets never leave this function).
 *   5. Insert a pending token_transactions row (kind='recharge', status='created').
 *   6. Return { orderId, paymentSessionId, amount, currency } to the client.
 *
 * Tokens are never credited here. Credit happens after cashfree-webhook or
 * verify-order confirms payment server-side.
 *
 * doc: https://www.cashfree.com/docs/payments/online/mobile/android
 * ADR-0022: India User Choice Billing
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// Pack config — aligned to src/lib/rates.ts RECHARGE_PACKS: 1 token = ₹1.
// Product IDs follow the pappal_pack_<amountInr> convention.
// ---------------------------------------------------------------------------
const RECHARGE_PACKS: Record<string, { tokens: number; amountInr: number }> = {
  pappal_pack_100:  { tokens: 100,  amountInr: 100  },
  pappal_pack_300:  { tokens: 300,  amountInr: 300  },
  pappal_pack_500:  { tokens: 500,  amountInr: 500  },
  pappal_pack_1000: { tokens: 1000, amountInr: 1000 },
  pappal_pack_2500: { tokens: 2500, amountInr: 2500 },
  pappal_pack_5000: { tokens: 5000, amountInr: 5000 },
};

// ---------------------------------------------------------------------------
// Cashfree helpers — secrets only via Deno.env; never returned to client.
// ---------------------------------------------------------------------------
function cashfreeBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

interface CashfreeOrderResponse {
  order_id: string;
  payment_session_id: string;
  order_amount: number;
  order_currency: string;
}

async function createCashfreeOrder(opts: {
  orderId: string;
  amountInr: number;
  userId: string;
  phone: string;
}): Promise<CashfreeOrderResponse> {
  const res = await fetch(`${cashfreeBaseUrl()}/orders`, {
    method: 'POST',
    headers: {
      'x-api-version': '2023-08-01',
      'x-client-id': Deno.env.get('CASHFREE_CLIENT_ID') ?? '',
      'x-client-secret': Deno.env.get('CASHFREE_CLIENT_SECRET') ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      order_id: opts.orderId,
      order_amount: opts.amountInr,
      order_currency: 'INR',
      customer_details: {
        customer_id: opts.userId,
        customer_phone: opts.phone,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cashfree order creation failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<CashfreeOrderResponse>;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
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

  // Verify the caller's JWT using the user-scoped client.
  const authHeader = request.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const userId = userData.user.id;

  try {
    const body = (await request.json()) as { productId?: string };
    const { productId } = body;

    if (!productId) {
      return Response.json({ error: 'productId is required' }, { status: 400 });
    }

    const pack = RECHARGE_PACKS[productId];
    if (!pack) {
      return Response.json({ error: `unknown productId: ${productId}` }, { status: 400 });
    }

    // Fetch phone_e164 from profile for Cashfree customer_details.
    // Cashfree requires a 10-digit phone number without country code or '+'.
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profileRow } = await admin
      .from('profiles')
      .select('phone_e164')
      .eq('id', userId)
      .single();

    const rawPhone = (profileRow as { phone_e164?: string } | null)?.phone_e164 ?? '';
    // Strip leading '+91' or '+' — Cashfree expects 10-digit number only.
    // If missing, use a sandbox-safe test number; a real number is required
    // for production, but this never reaches production (ADR-0022).
    const phone = rawPhone.replace(/^\+/, '').replace(/^91/, '').slice(-10) || '9999999999';

    // Generate a stable order id for this attempt. Using crypto.randomUUID()
    // means each call to create-order creates a new Cashfree order — intentional.
    // The idempotency guard lives in credit_purchased_recharge, not here.
    const orderId = crypto.randomUUID();

    // Create Cashfree order first; don't insert the transaction row until
    // we have a valid paymentSessionId.
    const cashfreeOrder = await createCashfreeOrder({
      orderId,
      amountInr: pack.amountInr,
      userId,
      phone,
    });

    // Insert pending transaction row. status='created'; credit happens via webhook
    // or verify-order after server-side payment confirmation.
    const { error: insertErr } = await admin
      .from('token_transactions')
      .insert({
        id: orderId,
        user_id: userId,
        kind: 'recharge',
        status: 'created',
        tokens_delta: pack.tokens,
        amount_paise: pack.amountInr * 100,
      });

    if (insertErr) {
      console.error('token_transactions insert failed:', insertErr.message);
      return Response.json({ error: 'could not create transaction record' }, { status: 500 });
    }

    return Response.json({
      orderId: cashfreeOrder.order_id,
      paymentSessionId: cashfreeOrder.payment_session_id,
      amount: cashfreeOrder.order_amount,
      currency: cashfreeOrder.order_currency,
    });
  } catch (err) {
    console.error('create-order error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
});
