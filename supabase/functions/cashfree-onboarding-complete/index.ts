/**
 * cashfree-onboarding-complete — exchange the 1-Click auth_code for the verified
 * identity + bank and persist it. The second half of the 1-Click flow (the client
 * gets the auth_code from the native sheet after `cashfree-onboarding-start`).
 *
 * Caller: the authenticated provider (Supabase JWT). Service-role writer of the
 * verified columns — the client never sees the KYC data, only the outcome.
 *
 * Flow:
 *   1. JWT → provider id.
 *   2. POST /verification/oauth2/generate-token { auth_code } → access_token.
 *      https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/oauth-access-token-generation
 *   3. GET /verification/oauth2/user-details (Bearer access_token) → scopes[].
 *      https://www.cashfree.com/docs/api-reference/vrs/v2/1-click-onboarding/fetch-user-details-from-access-token
 *      Verified values live at scopes[].records[].metadata.{name,dob,pan,
 *      registered_name,bank_account,name_at_bank,micr}.
 *   4. Persist (service role):
 *      - PAN  → provider_tax_profile (verified) so TDS-194O is 0.1% not 5%.
 *      - DOB  → profiles.date_of_birth (drives the card age; the 012 PII guard
 *               only blocks 'authenticated'/'anon', so a service-role write is the
 *               sanctioned path, same as approve_provider_application).
 *      - Bank → provider_payout_accounts (verified) + a Cashfree Payouts
 *               beneficiary. IFSC is NOT in the documented 1-Click schema (only
 *               MICR), and the bank rail requires IFSC (migration 048), so a
 *               missing IFSC leaves the bank to the manual form rather than
 *               failing the whole flow — `needsBank` says so.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

function base(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

/** 1-Click app creds (same chain as cashfree-onboarding-start). */
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

/** Payouts is a separate product (own base + creds) — for the beneficiary create. */
function payoutBase(): string {
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

interface UserDetails {
  scopes?: { records?: { metadata?: Record<string, unknown> }[] }[];
}

/** Merge every record's metadata into one flat bag (records are single-valued). */
function flattenScopes(details: UserDetails): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const scope of details.scopes ?? []) {
    for (const record of scope.records ?? []) {
      Object.assign(flat, record.metadata ?? {});
    }
  }
  return flat;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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

  const body = (await request.json().catch(() => ({}))) as { authCode?: string };
  if (!body.authCode) {
    return Response.json({ error: 'authCode is required' }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 2. auth_code → access_token.
    const tokenRes = await fetch(`${base()}/verification/oauth2/generate-token`, {
      method: 'POST',
      headers: verificationHeaders(),
      body: JSON.stringify({ auth_code: body.authCode }),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string;
      message?: string;
    };
    if (!tokenRes.ok || !token.access_token) {
      console.error('generate-token failed:', tokenRes.status, token.message);
      return Response.json({ error: token.message ?? 'could not exchange code' }, { status: 400 });
    }

    // 3. Fetch the verified details with the access token.
    const detailsRes = await fetch(`${base()}/verification/oauth2/user-details`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'x-api-version': Deno.env.get('CASHFREE_VERIFICATION_API_VERSION') ?? '2024-12-01',
      },
    });
    const details = (await detailsRes.json().catch(() => ({}))) as UserDetails & { message?: string };
    if (!detailsRes.ok) {
      console.error('user-details failed:', detailsRes.status, details.message);
      return Response.json({ error: details.message ?? 'could not fetch details' }, { status: 400 });
    }

    const flat = flattenScopes(details);
    const dob = str(flat.dob);
    const pan = str(flat.pan);
    const panName = str(flat.registered_name) ?? str(flat.name_pan_card) ?? str(flat.name);
    const bankAccount = str(flat.bank_account);
    const ifsc = str(flat.ifsc); // Often absent (schema returns MICR, not IFSC).
    const nameAtBank = str(flat.name_at_bank) ?? str(flat.name);
    const now = new Date().toISOString();

    // 4a. DOB → the card age (service role bypasses the 012 PII guard).
    if (dob) {
      await admin.from('profiles').update({ date_of_birth: dob }).eq('id', providerId);
    }

    // 4b. PAN → verified tax profile (provider_id is the PK, so upsert is clean).
    let panVerified = false;
    if (pan) {
      const { error } = await admin.from('provider_tax_profile').upsert(
        {
          provider_id: providerId,
          pan,
          pan_name: panName,
          status: 'verified',
          verified_at: now,
          updated_at: now,
        },
        { onConflict: 'provider_id' },
      );
      panVerified = !error;
    }

    // 4c. Bank → verified account + Cashfree Payouts beneficiary. Only when the
    // account AND an IFSC are present, because the bank rail requires IFSC.
    let bankVerified = false;
    const needsBank = bankAccount != null && ifsc == null; // account came back, IFSC didn't.
    if (bankAccount && ifsc) {
      // The partial unique index (one default per provider) makes a blind upsert
      // fragile, so read-then-write the default row.
      const { data: existing } = await admin
        .from('provider_payout_accounts')
        .select('id')
        .eq('provider_id', providerId)
        .eq('is_default', true)
        .maybeSingle();

      const accountId = (existing as { id?: string } | null)?.id;
      const beneficiaryId = 'pp' + (accountId ?? crypto.randomUUID()).replace(/-/g, '');

      const row = {
        provider_id: providerId,
        method: 'bank' as const,
        account_number: bankAccount,
        ifsc,
        account_holder_name: nameAtBank,
        name_at_bank: nameAtBank,
        is_default: true,
        verification_status: 'pending' as const,
        updated_at: now,
      };
      const savedId = accountId
        ? ((await admin.from('provider_payout_accounts').update(row).eq('id', accountId), accountId))
        : ((
            await admin
              .from('provider_payout_accounts')
              .insert(row)
              .select('id')
              .single()
          ).data as { id: string } | null)?.id;

      // Beneficiary (Payouts product): validates the account and returns VERIFIED.
      const { data: profileRow } = await admin
        .from('profiles')
        .select('display_name, phone_e164')
        .eq('id', providerId)
        .single();
      const profile = profileRow as { display_name?: string; phone_e164?: string } | null;
      // Fall back to the auth user's phone (see cashfree-onboarding-start).
      const phone = (profile?.phone_e164 || userData.user.phone || '')
        .replace(/\D/g, '')
        .slice(-10);

      const cfRes = await fetch(`${payoutBase()}/beneficiary`, {
        method: 'POST',
        headers: payoutHeaders(),
        body: JSON.stringify({
          beneficiary_id: beneficiaryId,
          beneficiary_name: nameAtBank ?? profile?.display_name ?? 'Provider',
          beneficiary_instrument_details: { bank_account_number: bankAccount, bank_ifsc: ifsc },
          beneficiary_contact_details: {
            beneficiary_email: email,
            beneficiary_phone: phone,
            beneficiary_country_code: '+91',
          },
        }),
      });
      const cf = (await cfRes.json().catch(() => ({}))) as {
        beneficiary_status?: string;
        message?: string;
      };
      bankVerified = cfRes.ok && cf.beneficiary_status === 'VERIFIED';

      if (savedId) {
        await admin
          .from('provider_payout_accounts')
          .update({
            verification_status: bankVerified ? 'verified' : 'failed',
            cashfree_beneficiary_id: bankVerified ? beneficiaryId : null,
            verification_ref: beneficiaryId,
            verification_error: bankVerified ? null : cf.message ?? 'verification failed',
            verified_at: bankVerified ? now : null,
            updated_at: now,
          })
          .eq('id', savedId);
      }
    }

    return Response.json({
      status: 'verified',
      pan: panVerified,
      dob: dob != null,
      bank: bankVerified,
      needsBank, // account returned but no IFSC → collect IFSC in the manual form.
    });
  } catch (err) {
    console.error('cashfree-onboarding-complete failed:', (err as Error).message);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
