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
      headers: payoutHeaders(),
      body: JSON.stringify(cfBody),
    });
    const cf = (await res.json()) as {
      beneficiary_status?: string;
      beneficiary_name?: string;
      message?: string;
      type?: string;
    };

    const verified = res.ok && cf.beneficiary_status === 'VERIFIED';

    // 4. Persist the result (service role — the only writer of these columns).
    await admin
      .from('provider_payout_accounts')
      .update({
        verification_status: verified ? 'verified' : 'failed',
        cashfree_beneficiary_id: verified ? beneficiaryId : null,
        name_at_bank: cf.beneficiary_name ?? beneficiaryName,
        verification_ref: beneficiaryId,
        verification_error: verified ? null : cf.message ?? cf.type ?? 'verification failed',
        verified_at: verified ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return Response.json({
      status: verified ? 'verified' : 'failed',
      error: verified ? undefined : cf.message ?? cf.type ?? 'verification failed',
    });
  } catch (err) {
    console.error('verify-payout-account failed:', (err as Error).message);
    await admin
      .from('provider_payout_accounts')
      .update({ verification_status: 'failed', verification_error: 'internal error' })
      .eq('provider_id', providerId)
      .eq('is_default', true);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
