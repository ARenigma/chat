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
// GST — mirrors gstOnTop in src/lib/rates.ts (ADR-0029: exclusive model).
// The live rate is read from admin economics config at request time (see the
// call site below); 1800 bps (18%) is only the fallback when that config has
// no published version.
// ---------------------------------------------------------------------------
const DEFAULT_GST_RATE_BPS = 1800;

function packTotalPaise(baseInr: number, rateBps: number = DEFAULT_GST_RATE_BPS): number {
  const basePaise = Math.round(baseInr * 100);
  if (rateBps <= 0 || basePaise <= 0) return basePaise;
  const gstPaise = Math.round((basePaise * rateBps) / 10000);
  return basePaise + gstPaise;
}

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
    const body = (await request.json()) as { productId?: string; appVersionCode?: number };
    const { productId } = body;

    if (!productId) {
      return Response.json({ error: 'productId is required' }, { status: 400 });
    }

    // GST version guard (2026-09-10). This function bills base + GST — a ₹300
    // pack charges ₹354 (packTotalPaise). A client that predates the
    // GST-inclusive recharge UI shows the bare base and would surprise the buyer
    // with a higher charge at the gateway. Those builds do not send
    // appVersionCode, so a missing or below-floor version is refused with 426
    // "please update" BEFORE any Cashfree order exists — an old client can never
    // be charged the surprise amount, it is told to update. The floor is the
    // versionCode of the first build that displays the GST-inclusive total,
    // overridable via the CREATE_ORDER_MIN_VERSION secret for later bumps.
    const minGstClient = parseInt(Deno.env.get('CREATE_ORDER_MIN_VERSION') ?? '10117', 10);
    // Fail CLOSED on a misconfigured floor. parseInt of a non-numeric env value
    // is NaN, and `x < NaN` is false for EVERY x — which would silently pass
    // every old client through to the base+GST charge, defeating the whole guard.
    // A bad floor must refuse the order, not disable the protection.
    if (!Number.isFinite(minGstClient) || minGstClient <= 0) {
      return Response.json(
        { error: 'server misconfiguration', message: 'Recharge is temporarily unavailable.' },
        { status: 500 },
      );
    }
    const appVersionCode =
      typeof body.appVersionCode === 'number' ? body.appVersionCode : 0;
    if (appVersionCode < minGstClient) {
      return Response.json(
        {
          error: 'upgrade_required',
          message: 'Please update Pappal to the latest version to add tokens.',
          minVersionCode: minGstClient,
        },
        { status: 426 },
      );
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
    //
    // Exclusive GST: member pays base + tax, receives base tokens (ADR-0029).
    // The rate is read LIVE from admin economics config — the same source the
    // client (useEconomicsConfig) and generate-invoice already read — so an
    // operator changing economics.gst_rate_bps flows through to the amount
    // actually charged, instead of this function alone staying pinned at 18%
    // and charging a total that no longer matches the price on screen. A failed
    // config read falls back to the GST_RATE_BPS env var, then 1800 bps, so it
    // can never turn into a failed order. (2026-09-09 audit)
    const gstRateBpsFallback = parseInt(
      Deno.env.get('GST_RATE_BPS') ?? String(DEFAULT_GST_RATE_BPS),
      10,
    );
    const { data: economics } = await admin.rpc('get_active_config', {
      p_domain: 'economics',
    });
    const configuredRate = (economics as { gst_rate_bps?: number } | null)?.gst_rate_bps;
    const gstRateBps =
      typeof configuredRate === 'number' && Number.isInteger(configuredRate) && configuredRate >= 0
        ? configuredRate
        : gstRateBpsFallback;
    const totalPaise = packTotalPaise(pack.amountInr, gstRateBps);

    const cashfreeOrder = await createCashfreeOrder({
      orderId,
      amountInr: totalPaise / 100,
      userId,
      phone,
    });

    // Insert pending transaction row. status='created'; credit happens via webhook
    // or verify-order after server-side payment confirmation.
    // amount_paise is the TOTAL charged (base + GST) — generate-invoice
    // backs the tax out of this figure using the inclusive formula.
    const { error: insertErr } = await admin
      .from('token_transactions')
      .insert({
        id: orderId,
        user_id: userId,
        kind: 'recharge',
        status: 'created',
        tokens_delta: pack.tokens,
        amount_paise: totalPaise,
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
