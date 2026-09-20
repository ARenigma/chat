/**
 * Truecaller OAuth authorization-code exchange → a real Supabase session.
 *
 * The client (Truecaller SDK) returns an authorization code + PKCE verifier
 * after the user consents. This function:
 *
 *   1. Validates the request (method, payload size, required fields).
 *   2. Exchanges the authorization code at Truecaller's token endpoint using
 *      PKCE — the code verifier proves the request came from the device that
 *      generated the challenge. The Truecaller client secret never transits
 *      the device.
 *   3. Fetches the user profile from Truecaller's userinfo endpoint. Requires
 *      `phone_number_verified === true`; rejected otherwise.
 *   4. Resolves identity atomically:
 *      a. Existing external identity (same sub) → returns that user's session.
 *      b. Existing phone owner (Firebase/Google+phone) → links the Truecaller
 *         sub and returns that user's session.
 *      c. No owner → issues an opaque pending challenge and returns
 *         `{ status: 'no_owner', challenge }`. The client shows the member
 *         "New here?" / "Already use Google?" and calls:
 *           - confirm-new-user  (POST with challenge) to create the account, or
 *           - link-truecaller   (POST with challenge + Supabase bearer) to bind.
 *   5. For matched users: mints a genuine GoTrue session via generateLink →
 *      verifyOtp so autoRefreshToken works natively.
 *
 * Security invariants:
 *   - PKCE is mandatory; missing/empty verifier is a hard rejection.
 *   - Truecaller client secret stays on the server.
 *   - Verified phone is never returned to the client.
 *   - Logs never contain authorization codes, verifiers, tokens, or phone numbers.
 *   - Requests are bounded to 4 KB.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  E164,
  ensureEmail,
  findUserIdByPhone,
  mintSession,
} from '../_shared/sessionBridge.ts';

const TRUECALLER_TOKEN_URL = 'https://oauth-account-noneu.truecaller.com/v1/token';
const TRUECALLER_USERINFO_URL = 'https://oauth-account-noneu.truecaller.com/v1/userinfo';

/** Normalize a phone number to E.164 (+countryDigits). */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const candidate = raw.trim().startsWith('+') ? `+${digits}` : `+${digits}`;
  return E164.test(candidate) ? candidate : null;
}

Deno.serve(async request => {
  // POST only — reject GET/HEAD/OPTIONS to limit attack surface.
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');
  const clientId    = Deno.env.get('TRUECALLER_CLIENT_ID');

  if (!supabaseUrl || !serviceKey || !anonKey || !clientId) {
    // Configuration error: do not reveal which field is missing.
    console.error('exchange-truecaller-code: missing environment configuration');
    return Response.json({ error: 'server configuration error' }, { status: 500 });
  }

  // Bound request body to prevent resource exhaustion.
  let body: { authorizationCode?: unknown; codeVerifier?: unknown } = {};
  try {
    const raw = await request.text();
    if (raw.length > 4096) {
      return Response.json({ error: 'payload too large' }, { status: 413 });
    }
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }

  const authorizationCode = typeof body.authorizationCode === 'string' ? body.authorizationCode : '';
  const codeVerifier      = typeof body.codeVerifier      === 'string' ? body.codeVerifier      : '';

  if (!authorizationCode || !codeVerifier) {
    return Response.json({ error: 'authorizationCode and codeVerifier are required' }, { status: 400 });
  }
  // Sanity-bound lengths before network calls.
  if (authorizationCode.length > 2048 || codeVerifier.length > 256) {
    return Response.json({ error: 'payload fields too long' }, { status: 400 });
  }

  // -------------------------------------------------------------------
  // 1. Exchange authorization code for access token at Truecaller.
  // -------------------------------------------------------------------
  // The code verifier is sent directly to Truecaller; we never store it.
  // https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/integrating-with-your-backend/fetching-user-token
  let truecallerAccessToken: string;
  try {
    const tokenParams = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     clientId,
      code:          authorizationCode,
      code_verifier: codeVerifier,
    });
    const tokenRes = await fetch(TRUECALLER_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    tokenParams.toString(),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) {
      // Log only the status; never echo the code or verifier.
      console.error(`truecaller token exchange failed: HTTP ${tokenRes.status}`);
      const status = tokenRes.status === 403 ? 401 : 502;
      return Response.json({ error: 'could not exchange authorization code' }, { status });
    }
    const tokenBody = (await tokenRes.json()) as { access_token?: unknown };
    if (typeof tokenBody.access_token !== 'string' || !tokenBody.access_token) {
      console.error('truecaller token exchange: no access_token in response');
      return Response.json({ error: 'could not exchange authorization code' }, { status: 502 });
    }
    truecallerAccessToken = tokenBody.access_token;
  } catch (err) {
    console.error(`truecaller token exchange error: ${String(err)}`);
    return Response.json({ error: 'could not reach Truecaller' }, { status: 502 });
  }

  // -------------------------------------------------------------------
  // 2. Fetch the verified user profile.
  // -------------------------------------------------------------------
  // https://docs.truecaller.com/truecaller-sdk/android/latest-oauth-sdk-3.3.0/integration-steps/integrating-with-your-backend/fetching-user-profile
  let sub: string;
  let phone: string;
  try {
    const infoRes = await fetch(TRUECALLER_USERINFO_URL, {
      headers: { Authorization: `Bearer ${truecallerAccessToken}` },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) {
      console.error(`truecaller userinfo failed: HTTP ${infoRes.status}`);
      return Response.json({ error: 'could not fetch user profile' }, { status: 502 });
    }
    const info = (await infoRes.json()) as {
      sub?: unknown;
      phone_number?: unknown;
      phone_number_verified?: unknown;
    };
    if (typeof info.sub !== 'string' || !info.sub) {
      console.error('truecaller userinfo: missing sub');
      return Response.json({ error: 'incomplete profile from Truecaller' }, { status: 502 });
    }
    if (info.phone_number_verified !== true) {
      console.error('truecaller userinfo: phone_number_verified is not true');
      return Response.json({ error: 'phone number not verified by Truecaller' }, { status: 422 });
    }
    const rawPhone = typeof info.phone_number === 'string' ? info.phone_number : '';
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      console.error('truecaller userinfo: phone_number is not valid E.164');
      return Response.json({ error: 'invalid phone number from Truecaller' }, { status: 422 });
    }
    sub   = info.sub;
    phone = normalized;
  } catch (err) {
    console.error(`truecaller userinfo error: ${String(err)}`);
    return Response.json({ error: 'could not reach Truecaller' }, { status: 502 });
  }

  // -------------------------------------------------------------------
  // 3. Resolve or create the Supabase identity.
  // -------------------------------------------------------------------
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // a. Check whether this Truecaller subject is already mapped.
    const { data: existingBySubject } = await admin
      .from('external_identities')
      .select('user_id')
      .eq('provider', 'truecaller')
      .eq('subject', sub)
      .maybeSingle()
      .schema('private');

    if (existingBySubject?.user_id) {
      // Returning Truecaller user — upsert to pick up any phone change, then mint.
      await admin.rpc('upsert_external_identity', {
        p_provider: 'truecaller',
        p_subject: sub,
        p_phone: phone,
        p_user_id: existingBySubject.user_id,
      });
      const email = await ensureEmail(admin, existingBySubject.user_id);
      const session = await mintSession(admin, anon, email);
      return Response.json(session, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // b. Check whether any auth path already owns this phone.
    const existingUserId = await findUserIdByPhone(admin, phone);

    if (existingUserId) {
      // First Truecaller sign-in for an existing phone-owner: link and mint.
      await admin.rpc('upsert_external_identity', {
        p_provider: 'truecaller',
        p_subject: sub,
        p_phone: phone,
        p_user_id: existingUserId,
      });
      const email = await ensureEmail(admin, existingUserId);
      const session = await mintSession(admin, anon, email);
      return Response.json(session, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // c. No owner: issue a pending challenge.
    // The client must ask the member "New here?" or "Already use Google?" before
    // an account is created, to protect existing Google-only users.
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const challengeToken = Array.from(randomBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(challengeToken),
    );
    const challengeHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    await admin.rpc('create_pending_challenge', {
      p_provider:       'truecaller',
      p_subject:        sub,
      p_phone:          phone,
      p_challenge_hash: challengeHash,
    });

    return Response.json(
      { status: 'no_owner', challenge: challengeToken },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error(`identity resolution failed: ${String(err)}`);
    return Response.json({ error: 'could not resolve user' }, { status: 500 });
  }
});
