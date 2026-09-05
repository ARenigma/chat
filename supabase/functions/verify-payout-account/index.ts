/**
 * verify-payout-account — turn a provider's saved bank/UPI destination into a
 * verified Cashfree Payouts beneficiary.
 *
 * Caller: the authenticated provider (Supabase JWT).
 *
 * Flow:
 *   1. Verify JWT → provider id.
 *   2. Read the provider's default payout account (saved unverified by the
 *      `upsert_my_payout_account` RPC) + their name/email/phone from the profile.
 *   3. Create a Cashfree Payouts V2 beneficiary — Cashfree validates the account
 *      and returns `beneficiary_status` (VERIFIED means payable).
 *   4. Write the beneficiary id + verification result back with the service-role
 *      client (the client can never write these columns; see migration 048).
 *
 * Cashfree Payouts is a DIFFERENT product from the PG (collection) API the
 * recharge functions use, so it has its own base URL (/payout) and may have its
 * own client id/secret — we read the payout-specific env with a fallback to the
 * PG creds.
 *
 * Create Beneficiary V2:
 *   https://www.cashfree.com/docs/api-reference/payouts/v2/beneficiary-v2/create-beneficiary-v2
 * No KYC here (product decision 2026-09-03): name/phone/email + bank is the only PII.
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
   * Payouts has its own 2FA, on the same terms as Secure ID: an IP allow-list
   * OR an `x-cf-signature`. Edge Functions have no static egress IP — proved on
   * 2026-09-05, when two consecutive calls left from 13.232.152.52 and then
   * 13.204.71.66 — so the allow-list cannot work here and the signature is the
   * only route. This is the same helper `verify-pan` uses; that call failed with
   * "IP not whitelisted" until it was added, and this one would have failed the
   * same way the moment payouts were switched on.
   * https://www.cashfree.com/docs/payouts/developers/authentication
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

interface PayoutAccountRow {
  id: string;
  method: 'upi' | 'bank';
  upi_vpa: string | null;
  account_number: string | null;
  ifsc: string | null;
  account_holder_name: string | null;
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
  const email = userData.user.email ?? '';

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1. The account to verify (default, not already verified).
    const { data: acct } = await admin
      .from('provider_payout_accounts')
      .select('id, method, upi_vpa, account_number, ifsc, account_holder_name')
      .eq('provider_id', providerId)
      .eq('is_default', true)
      .maybeSingle();

    const account = acct as PayoutAccountRow | null;
    if (!account) {
      return Response.json({ error: 'no payout account to verify' }, { status: 400 });
    }

    // 2. Beneficiary name/phone from the profile (no separate KYC).
    const { data: profileRow } = await admin
      .from('profiles')
      .select('display_name, phone_e164')
      .eq('id', providerId)
      .single();
    const profile = profileRow as { display_name?: string; phone_e164?: string } | null;
    const beneficiaryName = account.account_holder_name || profile?.display_name || 'Provider';
    const phone = (profile?.phone_e164 ?? '').replace(/^\+/, '').replace(/^91/, '').slice(-10);

    // Beneficiary id: Cashfree requires it unique + alphanumeric; derive from the
    // account row id (a fresh row, hence a fresh beneficiary, on every re-link).
    const beneficiaryId = 'pp' + account.id.replace(/-/g, '');

    // Mark pending before the network call so a retry is idempotent-ish.
    await admin
      .from('provider_payout_accounts')
      .update({ verification_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', account.id);

    // 3. Create the Cashfree beneficiary.
    const cfBody = {
      beneficiary_id: beneficiaryId,
      beneficiary_name: beneficiaryName,
      beneficiary_instrument_details:
        account.method === 'upi'
          ? { vpa: account.upi_vpa }
          : { bank_account_number: account.account_number, bank_ifsc: account.ifsc },
      beneficiary_contact_details: {
        beneficiary_email: email,
        beneficiary_phone: phone,
        beneficiary_country_code: '+91',
      },
    };

    const res = await fetch(`${payoutBaseUrl()}/beneficiary`, {
      method: 'POST',
      headers: await payoutHeaders(),
      body: JSON.stringify(cfBody),
    });
    const cf = (await res.json()) as {
      beneficiary_status?: string;
      beneficiary_name?: string;
      message?: string;
      type?: string;
    };

    const verified = res.ok && cf.beneficiary_status === 'VERIFIED';
    const reason = cf.message ?? cf.type ?? 'verification failed';

    /*
     * Our problem, or theirs?
     *
     * `failed` accuses the PROVIDER: the app tells them their UPI ID is wrong
     * and to check it. That must only be said when Cashfree actually looked at
     * the account and refused it. When Cashfree refuses to talk to US — 2FA not
     * satisfied, credentials wrong, IP not allow-listed — the provider's details
     * are very probably fine and we simply could not ask.
     *
     * Observed on 2026-09-05: every attempt came back `IP not whitelisted`
     * (Cashfree's generic 2FA rejection) and the app told a provider with a
     * perfectly good UPI ID to go and check it. That is the same shape of lie as
     * `verify-pan` reporting our own CHECK-constraint failure as a missing DOB,
     * which cost a day of looking at Cashfree instead of at our own schema.
     *
     * `pending` is the honest state and already means the right thing here: the
     * details ARE saved, they are simply unconfirmed, and ADR-0022's listing gate
     * (`payout_readiness.can_go_live`) is what keeps an unconfirmed account from
     * earning. The reason is still recorded either way, so this is not a
     * swallowed error — it is an error attributed to the right party.
     *
     * https://www.cashfree.com/docs/payouts/payouts/integrations/payouts-2fa
     */
    const ourFault =
      !verified &&
      (res.status === 401 ||
        res.status === 403 ||
        /ip not whitelisted|signature|two.?factor|2fa|unauthoriz|authentication|invalid client/i.test(
          reason,
        ));
    const status = verified ? 'verified' : ourFault ? 'pending' : 'failed';

    // 4. Persist the result (service role — the only writer of these columns).
    await admin
      .from('provider_payout_accounts')
      .update({
        verification_status: status,
        cashfree_beneficiary_id: verified ? beneficiaryId : null,
        name_at_bank: cf.beneficiary_name ?? beneficiaryName,
        verification_ref: beneficiaryId,
        verification_error: verified ? null : reason,
        verified_at: verified ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return Response.json({
      status,
      error: verified ? undefined : reason,
    });
  } catch (err) {
    console.error('verify-payout-account failed:', (err as Error).message);
    await admin
      .from('provider_payout_accounts')
      .update({ verification_status: 'pending', verification_error: 'internal error' })
      .eq('provider_id', providerId)
      .eq('is_default', true);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
