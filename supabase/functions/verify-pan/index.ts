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
import { cashfreeSignature } from '../_shared/cashfreeSignature.ts';

function verificationBaseUrl(): string {
  const env = Deno.env.get('CASHFREE_ENV') ?? 'sandbox';
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

async function verificationHeaders(): Promise<HeadersInit> {
  const clientId =
    Deno.env.get('CASHFREE_VERIFICATION_CLIENT_ID') ??
    Deno.env.get('CASHFREE_PAYOUT_CLIENT_ID') ??
    Deno.env.get('CASHFREE_CLIENT_ID') ??
    '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-version': Deno.env.get('CASHFREE_VERIFICATION_API_VERSION') ?? '2024-12-01',
    'x-client-id': clientId,
    'x-client-secret':
      Deno.env.get('CASHFREE_VERIFICATION_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_PAYOUT_CLIENT_SECRET') ??
      Deno.env.get('CASHFREE_CLIENT_SECRET') ??
      '',
  };
  /*
   * Secure ID demands 2FA on sandbox AND production. Edge Functions have no
   * static egress IP, so the allow-list method cannot work here — the signature
   * is the supported route. Omitted when no key is set, so an account still on
   * the allow-list keeps working unchanged.
   */
  const signature = await cashfreeSignature(
    clientId,
    Deno.env.get('CASHFREE_VERIFICATION_PUBLIC_KEY'),
  );
  if (signature !== null) {
    headers['x-cf-signature'] = signature;
  }
  return headers;
}

/**
 * Cashfree returns `DD-MM-YYYY`; Postgres `date` wants `YYYY-MM-DD`.
 *
 * Parsed strictly rather than handed to `new Date()`, which reads `03-04-2001`
 * as March 4th in some runtimes and April 3rd in others — a silent one-month
 * error in the input to an age gate.
 */
function toIsoDate(ddmmyyyy: string | undefined): string | null {
  if (typeof ddmmyyyy !== 'string') {
    return null;
  }
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddmmyyyy.trim());
  if (m === null) {
    return null;
  }
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}`;
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

    /*
     * PAN 360 Advanced, not the plain `/verification/pan`.
     *
     * Same request shape plus a `verification_id`, but the response carries
     * `date_of_birth` from the Income Tax Department's own records — which is the
     * whole reason for the change. The 18+ gate needs an authoritative birth
     * date, and this is the only server-to-server way we have to get one.
     * https://www.cashfree.com/docs/api-reference/vrs/v2/pan/pan-360
     *
     * WHY THIS AND NOT 1-CLICK. 1-Click returns the same data behind an OTP
     * consent sheet, and that sheet is broken in Cashfree's sandbox: their own
     * consent page sends `x-session-id` to their own API, which does not list it
     * in `Access-Control-Allow-Headers` (reproduced with curl, 2026-09-04). It is
     * a browser CORS fault inside a WebView. THIS call is a plain server-side
     * fetch with no browser anywhere, so that class of failure cannot reach it.
     *
     * WHY NOT MOBILE 360. It is also server-to-server and would work, but it
     * answers "who is this phone number" with credit score, relatives, employment
     * history, ration card and bank details. We need a PAN, a name and an age.
     * Pulling the rest to establish those is disproportionate under the DPDP
     * Act's data-minimisation principle, and it is more PII to secure, declare
     * and be breached. `verification_id` is alphanumeric-only (a hyphenated UUID
     * is rejected), the same constraint the 1-Click flow hit.
     */
    const verificationId = `pan${crypto.randomUUID().replace(/-/g, '')}`;
    const res = await fetch(`${verificationBaseUrl()}/verification/pan/advance`, {
      method: 'POST',
      headers: await verificationHeaders(),
      body: JSON.stringify({ pan, name, verification_id: verificationId }),
    });
    const cf = (await res.json()) as {
      valid?: boolean;
      status?: string;
      registered_name?: string;
      name_pan_card?: string;
      date_of_birth?: string;
      name_match_score?: number;
      message?: string;
    };
    // PAN 360 reports `status: 'VALID'`; the older endpoint used `valid: true`.
    // Both are accepted so a rollback to the plain endpoint still works.
    const verified = res.ok && (cf.valid === true || cf.status === 'VALID');

    /*
     * Our problem, or theirs?
     *
     * Mirroring the same guard in verify-payout-account: when Cashfree refuses
     * to talk to US — bad credentials, 2FA not satisfied, IP not allow-listed —
     * writing 'failed' to the DB tells the provider their PAN is wrong. That is
     * a false accusation. 'pending' is honest: the details are saved, we simply
     * could not verify them right now.
     *
     * https://www.cashfree.com/docs/api-reference/vrs/v2/authentication
     */
    const reason = cf.message ?? 'PAN not verified';
    const ourFault =
      !verified &&
      (res.status === 401 ||
        res.status === 403 ||
        /ip not whitelisted|signature|two.?factor|2fa|unauthoriz|authentication|invalid client/i.test(reason));
    const taxStatus = verified ? 'verified' : ourFault ? 'pending' : 'failed';

    await admin
      .from('provider_tax_profile')
      .update({
        status: taxStatus,
        pan_name: cf.registered_name ?? null,
        failure_reason: verified ? null : reason,
        verified_at: verified ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_id', providerId);

    /*
     * The identity triple, written atomically — the same contract
     * `cashfree-onboarding-complete` honours, so the two roads to
     * `identity_state = 'verified'` are indistinguishable downstream and
     * migration 054's CHECK holds either way.
     *
     * This is what re-opens provider onboarding. `complete_provider_onboarding`
     * gates on `identity_state`, and until now only the (broken) 1-Click path
     * could set it — so wiring the gate had closed the only door.
     */
    let identity: 'verified' | 'no-dob' | 'write-failed' | null = null;
    if (verified) {
      const iso = toIsoDate(cf.date_of_birth);
      if (iso === null) {
        // Verified PAN but no usable DOB: the age gate cannot be satisfied, so
        // the state stays where it was rather than claiming an identity we
        // cannot age-check. The constraint would reject the write anyway.
        console.error('pan/advance returned no usable date_of_birth for', providerId);
        identity = 'no-dob';
      } else {
        /*
         * The DOB goes on the TAX PROFILE, not on `profiles`.
         *
         * `member_is_pseudonymous` (migration 011) makes a member row carrying a
         * birth date unrepresentable — deliberately, members are pseudonymous.
         * Writing it here failed with `23514` and, because this function
         * reported any write failure as "no DOB", looked like Cashfree had
         * returned nothing. It had returned `02-10-1996` all along.
         *
         * `complete_provider_onboarding` copies it onto the profile in the same
         * UPDATE that sets `role = 'provider'` (migration 056), which is the
         * pattern 011 prescribes.
         */
        const { error: dobErr } = await admin
          .from('provider_tax_profile')
          .update({ verified_dob: iso })
          .eq('provider_id', providerId);
        const { error: idErr } = await admin
          .from('profiles')
          .update({
            identity_verified_at: new Date().toISOString(),
            identity_state: 'verified',
          })
          .eq('id', providerId);
        if (dobErr || idErr) {
          // Reported apart from the no-DOB case: they need different fixes, and
          // conflating them cost an hour of looking in the wrong place.
          console.error('identity write failed:', (dobErr ?? idErr)?.message);
          identity = 'write-failed';
        } else {
          identity = 'verified';
        }
      }
    }

    return Response.json({
      // Use taxStatus so the client knows whether the non-verified state is
      // 'failed' (provider's fault) or 'pending' (our fault — ourFault path).
      status: verified ? 'verified' : taxStatus,
      name: verified ? cf.registered_name ?? cf.name_pan_card : undefined,
      identity,
      error: verified
        ? identity === 'no-dob'
          ? 'Your PAN is valid but we could not read a date of birth from it.'
          : identity === 'write-failed'
          ? 'Your PAN is valid but we could not save the result. Please try again.'
          : undefined
        : ourFault
        ? "We couldn't reach the verification service. Try again in a few minutes."
        : reason,
    });
  } catch (err) {
    console.error('verify-pan failed:', (err as Error).message);
    // An internal exception is our fault: write 'pending', not 'failed'.
    // 'failed' accuses the provider's PAN number; 'pending' says we could not
    // check it — which is exactly what happened.
    await admin
      .from('provider_tax_profile')
      .update({ status: 'pending', failure_reason: 'internal error' })
      .eq('provider_id', providerId);
    return Response.json({ status: 'pending', error: "We couldn't reach the verification service. Try again in a few minutes." }, { status: 500 });
  }
});
