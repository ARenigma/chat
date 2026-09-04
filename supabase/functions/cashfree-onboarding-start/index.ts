/**
 * cashfree-onboarding-start — mint a Cashfree 1-Click Onboarding session for the
 * provider, so the native SDK sheet can open.
 *
 * This is the FIRST half of the 1-Click flow (the client then opens the native
 * sheet with the returned session_id and gets an auth_code, which
 * `cashfree-onboarding-complete` exchanges for the verified PAN + identity).
 *
 * Caller: the authenticated provider (Supabase JWT).
 *
 * Flow (both steps documented; a valid session needs a 1-Click app + template
 * created in the Cashfree Secure ID dashboard — see docs/provider-payouts.md):
 *   1. Verify JWT → provider id; read their phone from the profile.
 *   2. Data Availability (mandatory) — POST /verification/user/data-availability
 *      https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/data-availability
 *   3. Initiate OAuth — POST /verification/oauth2/session → session_id (1h TTL)
 *      https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/initiate-oauth
 *
 * NOTE (scope): 1-Click / Mobile 360 returns PAN + identity, NOT a bank account.
 * The bank/UPI destination and its Payouts beneficiary stay on `verify-payout-
 * account`; this flow only replaces manual PAN entry + `verify-pan`.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

function verificationBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

function clientEnvironment(): 'sandbox' | 'production' {
  return (Deno.env.get('CASHFREE_ENV') ?? 'sandbox') === 'production' ? 'production' : 'sandbox';
}

/**
 * The 1-Click APIs REQUIRE x-api-version (YYYY-MM-DD); Verify PAN Sync did not,
 * which is why `verify-pan` omits it. The 1-Click app's client id/secret may be
 * distinct from the general Verification creds (Cashfree issues them per app in
 * the dashboard's 1-Click section), so these read a dedicated pair first.
 */
function verificationHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-api-version': Deno.env.get('CASHFREE_VERIFICATION_API_VERSION') ?? '2024-12-01',
    'x-client-id':
      Deno.env.get('CASHFREE_ONECLICK_CLIENT_ID') ??
      Deno.env.get('CASHFREE_VERIFICATION_CLIENT_ID') ??
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_ID') ??
      Deno.env.get('CASHFREE_CLIENT_ID') ??
      '',
    'x-client-secret':
      Deno.env.get('CASHFREE_ONECLICK_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_VERIFICATION_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_CLIENT_SECRET') ??
      '',
  };
}

/** +91XXXXXXXXXX (or any E.164) → the bare 10-digit number Cashfree expects. */
function toTenDigits(phoneE164: string): string | null {
  const digits = phoneE164.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^\d{10}$/.test(local) ? local : null;
}

/**
 * Cashfree's published 1-Click sandbox number, and the ONLY one it answers.
 *
 * "Validations using any data other than what is listed in this topic will
 * fail" — https://www.cashfree.com/docs/api-reference/vrs/data-to-test-integration
 * The 1-Click row is mobile 9999991234 with OTP 1234. Sandbox does not verify
 * real numbers at all: it is a simulator, not a soft-launch environment.
 *
 * This was the reason the sandbox flow could never complete. The session was
 * being minted for whatever real number the account had, which sandbox has no
 * data for, so the consent sheet had nothing to consent to. Found 2026-09-04
 * after re-reading the test-data page.
 */
const SANDBOX_MOBILE = '9999991234';

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

  const authHeader = request.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const providerId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: profileRow } = await admin
      .from('profiles')
      .select('phone_e164')
      .eq('id', providerId)
      .single();
    // Prefer the profile's phone, but fall back to the AUTH user's phone: a
    // phone-signup sets auth.users.phone even when the profile mirror
    // (phone_e164) has not been backfilled, and 1-Click needs a number.
    const phone =
      (profileRow as { phone_e164?: string } | null)?.phone_e164 ||
      userData.user.phone ||
      '';
    const realMobile = toTenDigits(phone);
    /*
     * In sandbox the user's own number is deliberately NOT used — see
     * SANDBOX_MOBILE. The real number is still REQUIRED first, so the sandbox
     * path exercises the same preconditions as production and a missing phone
     * still fails here rather than passing in test and failing on launch day.
     *
     * Guarded on the environment, so production can never send the test number:
     * `clientEnvironment()` is the same value handed to the SDK, so the two
     * cannot disagree about which world this session belongs to.
     */
    const sandbox = clientEnvironment() !== 'production';

    /*
     * PRODUCTION requires a real number; sandbox does not.
     *
     * The first version of this required one in both, on the argument that
     * sandbox should exercise production's preconditions. That was wrong in a
     * way that only showed up on device: sandbox never uses the real number
     * anyway (see SANDBOX_MOBILE), so the check could not protect anything
     * there — it could only make the flow untestable with the email fixtures
     * every test account uses. Which is exactly what it did: `no verified phone
     * on file`, on a path where the number is discarded two lines later.
     *
     * Production keeps the check, because there the number IS the input and a
     * missing one means Cashfree has nothing to look up.
     */
    if (!sandbox && !realMobile) {
      return Response.json({ error: 'no verified phone on file' }, { status: 400 });
    }
    const mobile = sandbox ? SANDBOX_MOBILE : (realMobile as string);
    if (sandbox) {
      console.warn(
        'sandbox: using the Cashfree test mobile',
        realMobile ? '(account has a real number, ignored here)' : '(account has no number)',
      );
    }

    // A merchant-generated id that ties this attempt together across the two
    // calls (echoed back in the token exchange). Cashfree requires it to be
    // ALPHANUMERIC (a hyphenated UUID is rejected: "verification_id should be
    // alphanumeric"), so the UUID's dashes are stripped — 32 hex chars, ≤ 50.
    const verificationId = `oc${crypto.randomUUID().replace(/-/g, '')}`;

    // Step 2 — Data Availability. BEST-EFFORT, never blocking. Empirically this
    // endpoint 401s with the 1-Click app credentials that DO create a session
    // (verified against sandbox 2026-09-03) — it wants the account-level
    // Verification Suite keys, a separate pair. It is only a pre-check that the
    // mobile has data, and the SDK needs only the session_id, so a failure here
    // must not stop the sheet from opening. If a dedicated key is later set as
    // CASHFREE_DATAAVAIL_* this becomes a live gate; for now it is advisory.
    try {
      const availRes = await fetch(
        `${verificationBaseUrl()}/verification/user/data-availability`,
        {
          method: 'POST',
          headers: verificationHeaders(),
          body: JSON.stringify({
            verification_id: verificationId,
            user: [{ identifier_type: 'MOBILE', identifier_value: mobile }],
          }),
        },
      );
      if (!availRes.ok) {
        const body = (await availRes.json().catch(() => ({}))) as { message?: string };
        console.warn('data-availability (advisory) not ok:', availRes.status, body.message);
      }
    } catch (availErr) {
      console.warn('data-availability (advisory) errored:', (availErr as Error).message);
    }

    // Step 3 — Initiate OAuth → session_id. This is the call that matters: the
    // native SDK opens on this session_id. Note `user` is an OBJECT here, unlike
    // data-availability where it is an array (per the Cashfree API reference).
    const sessionRes = await fetch(`${verificationBaseUrl()}/verification/oauth2/session`, {
      method: 'POST',
      headers: verificationHeaders(),
      body: JSON.stringify({
        verification_id: verificationId,
        user: { identifier_type: 'MOBILE', identifier_value: mobile },
      }),
    });
    const session = (await sessionRes.json().catch(() => ({}))) as {
      session_id?: string;
      message?: string;
    };
    if (!sessionRes.ok || !session.session_id) {
      console.error('initiate-oauth failed:', sessionRes.status, session.message);
      return Response.json(
        { error: session.message ?? 'could not start verification' },
        { status: 400 },
      );
    }

    /*
     * A session exists and the sheet is about to open, so the identity step is
     * in flight. `pending` is what lets the app tell "never started" from
     * "started and not finished" — the difference between offering the step and
     * offering to resume it. It is deliberately NOT a claim that anything was
     * verified; only `cashfree-onboarding-complete` may write 'verified', and
     * migration 054's CHECK stops it doing so without a DOB.
     *
     * Best-effort: a failure here must not stop the sheet opening, because the
     * user can still complete the flow and the completion write is what matters.
     */
    const { error: pendingErr } = await admin
      .from('profiles')
      .update({ identity_state: 'pending' })
      .eq('id', providerId)
      .neq('identity_state', 'verified');
    if (pendingErr) {
      console.warn('could not mark identity pending:', pendingErr.message);
    }

    return Response.json({
      sessionId: session.session_id,
      verificationId,
      environment: clientEnvironment(),
    });
  } catch (err) {
    console.error('cashfree-onboarding-start failed:', (err as Error).message);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
