/**
 * verify-pan — validate a provider's PAN via Cashfree's Verification Suite.
 *
 * NOT KYC (product decision 2026-09-03): no Aadhaar, no liveness. Just the PAN
 * number, checked for existence + registered name, so TDS-194O withholding is
 * 0.1% instead of 5%. A provider can still be paid without a PAN (at 5%), so this
 * is never a listing gate.
 *
 * Caller: the authenticated provider (Supabase JWT).
 *
 * Flow:
 *   1. Verify JWT → provider id.
 *   2. Read the provider's pending PAN (saved by the `set_my_pan` RPC) + their
 *      name from the profile.
 *   3. Cashfree Verify PAN Sync — returns `valid`, `registered_name`,
 *      `name_match_score`.
 *   4. Write the result back with the service-role client (the only writer).
 *
 * Verify PAN Sync:
 *   https://www.cashfree.com/docs/api-reference/vrs/v2/pan/verify-pan-sync
 * Verification Suite is a separate Cashfree product; env reads the verification
 * creds with a fallback to the payout / PG creds.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

function verificationBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

function verificationHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-client-id':
      Deno.env.get('CASHFREE_VERIFICATION_CLIENT_ID') ??
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_ID') ??
      Deno.env.get('CASHFREE_CLIENT_ID') ??
      '',
    'x-client-secret':
      Deno.env.get('CASHFREE_VERIFICATION_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_CLIENT_SECRET') ??
      '',
  };
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

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: taxRow } = await admin
      .from('provider_tax_profile')
      .select('pan')
      .eq('provider_id', providerId)
      .maybeSingle();
    const pan = (taxRow as { pan?: string } | null)?.pan;
    if (!pan) {
      return Response.json({ error: 'no PAN to verify' }, { status: 400 });
    }

    const { data: profileRow } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', providerId)
      .single();
    const name = (profileRow as { display_name?: string } | null)?.display_name ?? '';

    const res = await fetch(`${verificationBaseUrl()}/verification/pan`, {
      method: 'POST',
      headers: verificationHeaders(),
      body: JSON.stringify({ pan, name }),
    });
    const cf = (await res.json()) as {
      valid?: boolean;
      registered_name?: string;
      name_match_score?: number;
      message?: string;
    };
    const verified = res.ok && cf.valid === true;

    await admin
      .from('provider_tax_profile')
      .update({
        status: verified ? 'verified' : 'failed',
        pan_name: cf.registered_name ?? null,
        failure_reason: verified ? null : cf.message ?? 'PAN not verified',
        verified_at: verified ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_id', providerId);

    return Response.json({
      status: verified ? 'verified' : 'failed',
      name: verified ? cf.registered_name : undefined,
      error: verified ? undefined : cf.message ?? 'PAN not verified',
    });
  } catch (err) {
    console.error('verify-pan failed:', (err as Error).message);
    await admin
      .from('provider_tax_profile')
      .update({ status: 'failed', failure_reason: 'internal error' })
      .eq('provider_id', providerId);
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
});
