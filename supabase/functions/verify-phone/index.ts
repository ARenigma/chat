/**
 * Records a phone verification, on the strength of MSG91's word rather than the
 * client's.
 *
 * The flow (ADR-0009, revised):
 *   1. The user is already signed in with Google — Supabase Auth issued the
 *      session, and this function does not create one.
 *   2. The MSG91 widget in the app sends and verifies a code, and hands the
 *      client a JWT access token.
 *   3. The client posts that token here, with its Supabase session.
 *   4. We ask MSG91 what identifier that token belongs to, and stamp *that*
 *      number onto the caller's profile.
 *
 * Step 4 is the whole security argument. The client sends only the token; it
 * never sends the phone number. If it did, a user could verify a number they
 * control and submit somebody else's, and the uniqueness index in migration 010
 * would then let them squat on a number they have never held. MSG91's response is
 * the only source of the identifier.
 *
 * Secrets:
 *   MSG91_AUTHKEY  server-side key. NOT the widget's client token — that one
 *                  ships in the APK and can be extracted; this one cannot leave
 *                  the function.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VERIFY_URL = 'https://api.msg91.com/api/v5/widget/verifyAccessToken';

/** E.164 with the plus. Must agree with the check in migration 010. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/**
 * MSG91 returns the identifier it verified. The field name varies by contact
 * point and across their docs, so several are accepted — but only one is ever
 * used, and it must survive the E.164 check below.
 */
function extractPhone(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const body = payload as Record<string, unknown>;
  const candidates = [
    body.identifier,
    body.mobile,
    (body.data as Record<string, unknown> | undefined)?.identifier,
    (body.data as Record<string, unknown> | undefined)?.mobile,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      continue;
    }
    const digits = candidate.replace(/[^\d]/g, '');
    const e164 = `+${digits}`;
    if (E164.test(e164)) {
      return e164;
    }
  }
  return null;
}

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authkey = Deno.env.get('MSG91_AUTHKEY');

  if (!url || !serviceKey || !anonKey || !authkey) {
    console.error('verify-phone is not configured');
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer === '') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Resolve the caller from their own token rather than trusting any id in the
  // body. `getUser` validates the signature against the project's keys, so a
  // forged or expired session cannot get past this line.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false },
  });
  const { data: caller, error: callerError } = await asCaller.auth.getUser();
  if (callerError != null || caller?.user == null) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let accessToken = '';
  try {
    const body = (await request.json()) as { accessToken?: unknown };
    accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
  } catch {
    accessToken = '';
  }
  if (accessToken === '' || accessToken.length > 4096) {
    return Response.json({ error: 'bad payload' }, { status: 400 });
  }

  const response = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { authkey, 'content-type': 'application/json' },
    body: JSON.stringify({ 'access-token': accessToken }),
  });
  const raw = await response.text();

  if (!response.ok) {
    console.error(`msg91 verifyAccessToken ${response.status}: ${raw.slice(0, 200)}`);
    return Response.json({ error: 'verification failed' }, { status: 400 });
  }

  // Same lesson as send-sms: MSG91 puts failures inside a 200, so success has to
  // be proven. Here the proof is stronger than a status field — there must be a
  // usable E.164 identifier in the response, and if there is not, this is a
  // failure regardless of what the body claims.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`msg91 returned an unparseable body: ${raw.slice(0, 200)}`);
    return Response.json({ error: 'verification failed' }, { status: 400 });
  }
  if ((parsed as { type?: string }).type === 'error') {
    console.error(
      `msg91 rejected the token: ${String((parsed as { message?: string }).message)}`,
    );
    return Response.json({ error: 'verification failed' }, { status: 400 });
  }

  const phone = extractPhone(parsed);
  if (phone === null) {
    // Logged without the body, which carries the number.
    console.error('msg91 confirmed a token but returned no usable identifier');
    return Response.json({ error: 'verification failed' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: writeError } = await admin.rpc('verify_phone', {
    p_user_id: caller.user.id,
    p_phone_e164: phone,
  });

  if (writeError != null) {
    // 23505 is the unique-index collision: this number already belongs to
    // another account. Surfaced distinctly because it is the one failure with a
    // real user-facing meaning, and it is also the ban-evasion signal.
    if (writeError.code === '23505' || /PHONE_ALREADY_VERIFIED/.test(writeError.message)) {
      return Response.json({ error: 'phone_already_verified' }, { status: 409 });
    }
    console.error(`verify_phone failed: ${writeError.message}`);
    return Response.json({ error: 'could not record verification' }, { status: 500 });
  }

  // The number is deliberately not echoed back. The client just verified it and
  // knows it; returning it would put it in one more place for no purpose.
  return Response.json({ verified: true });
});
