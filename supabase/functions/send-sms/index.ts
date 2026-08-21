/**
 * Supabase's Send SMS auth hook, delivering through Fast2SMS.
 *
 * ADR-0009 §2: Supabase Auth owns the login and the SMS vendor is only the
 * carrier. The client calls `signInWithOtp({ phone })`, Supabase generates and
 * stores the
 * code and hands it to this function, we put it on the network, and the client
 * calls `verifyOtp`. Nothing about identity, RLS, refresh tokens or account
 * deletion changes — which is the whole reason this is a hook rather than the
 * MSG91 widget.
 *
 * The carrier is Fast2SMS rather than MSG91, and the reason is narrow: MSG91's
 * Flow API needs a DLT template we would have to register ourselves, which is
 * one to three weeks. Fast2SMS's `otp` route injects our code into *their*
 * pre-approved template, so there is nothing to register. MSG91 remains the
 * better destination once a template is approved — branded sender and the SMS
 * autofill hash — and that is a config change here, not a rewrite: set
 * FAST2SMS_ROUTE=dlt with a sender id and template, or swap the vendor call.
 *
 * This function never generates or validates a code. It cannot: it has no
 * storage and no idea what the user typed. That is a feature — the only thing it
 * can get wrong is delivery.
 *
 * Secrets it needs (`supabase secrets set --env-file ...`, never as arguments):
 *   SEND_SMS_HOOK_SECRET  the `v1,whsec_...` value Supabase shows for the hook
 *   FAST2SMS_API_KEY      Fast2SMS panel -> API key
 *   FAST2SMS_ROUTE        'otp' (their template, no DLT) or 'dlt' (ours)
 *   FAST2SMS_SENDER_ID    dlt route only: the approved header
 *   FAST2SMS_MESSAGE_ID   dlt route only: the approved template id
 */

/** Standard Webhooks: `v1,<base64 hmac>`, possibly several space-separated. */
const SIGNATURE_HEADER = 'webhook-signature';
const ID_HEADER = 'webhook-id';
const TIMESTAMP_HEADER = 'webhook-timestamp';

/** Reject anything older than this, so a captured request cannot be replayed. */
const TOLERANCE_SECONDS = 300;

interface HookPayload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

/** Constant-time compare, so a wrong signature leaks no timing information. */
function sameBytes(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    // eslint-disable-next-line no-bitwise
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the hook signature.
 *
 * Without this the endpoint is an open SMS relay: anyone who learns the URL
 * could post a phone number and a string and make us pay to deliver it. That is
 * not a theoretical concern for a function whose whole job is spending money per
 * request.
 */
async function verifySignature(
  raw: string,
  headers: Headers,
  secret: string,
): Promise<boolean> {
  const id = headers.get(ID_HEADER);
  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (!id || !timestamp || !signature) {
    return false;
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    return false;
  }

  // The secret arrives prefixed; the HMAC key is the base64 after `whsec_`.
  const material = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase64(material),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${raw}`),
  );
  const expected = encodeBase64(new Uint8Array(mac));

  // The header may carry several versioned signatures during a secret rotation.
  return signature
    .split(' ')
    .map(part => part.trim())
    .filter(part => part.startsWith('v1,'))
    .some(part => sameBytes(part.slice(3), expected));
}

/**
 * Fast2SMS wants a bare ten-digit Indian number — no country code, no plus.
 *
 * That is a real constraint and not a formatting detail: this route reaches
 * Indian numbers only. The sign-in screen deliberately leaves the country code
 * editable, so a user on a foreign number can get this far, and they must be
 * told that rather than watch an SMS never arrive. Returning null here produces
 * a failure Supabase surfaces, instead of a silent success.
 */
function indianTenDigits(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 10) {
    return /^[6-9]/.test(digits) ? digits : null;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2);
    return /^[6-9]/.test(local) ? local : null;
  }
  // Anything else is a number this route cannot deliver to.
  return null;
}

Deno.serve(async request => {
  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  const apiKey = Deno.env.get('FAST2SMS_API_KEY');
  const route = Deno.env.get('FAST2SMS_ROUTE') ?? 'otp';

  if (!secret || !apiKey) {
    console.error('send-sms is not configured');
    return new Response(JSON.stringify({ error: 'not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Read the body as text first: the signature covers the exact bytes, so
  // parsing and re-serialising would change what we verify.
  const raw = await request.text();
  if (!(await verifySignature(raw, request.headers, secret))) {
    return new Response(JSON.stringify({ error: 'bad signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'bad payload' }), { status: 400 });
  }

  const phone = payload.user?.phone ?? '';
  const otp = payload.sms?.otp ?? '';
  const mobiles = indianTenDigits(phone);

  if (!mobiles || !/^\d{4,8}$/.test(otp)) {
    // Deliberately not logging either value: a phone number is personal data and
    // the code is a live credential for the next two minutes.
    console.error('send-sms rejected a payload with an unusable phone or code');
    return new Response(JSON.stringify({ error: 'bad payload' }), { status: 400 });
  }

  /**
   * Fast2SMS, form-encoded, with the route chosen by configuration.
   *
   *   otp  their pre-approved template ("Your OTP: <code>"), nothing to register,
   *        generic sender. This is what ships first.
   *   dlt  our own approved template and sender id. Cheaper per message and it
   *        can carry the SMS-autofill hash, which the otp route cannot.
   *
   * Both take a bare ten-digit number and our own code, so switching is
   * configuration rather than a rewrite.
   */
  const form = new URLSearchParams(
    route === 'dlt'
      ? {
          route: 'dlt',
          sender_id: Deno.env.get('FAST2SMS_SENDER_ID') ?? '',
          message: Deno.env.get('FAST2SMS_MESSAGE_ID') ?? '',
          variables_values: otp,
          numbers: mobiles,
          flash: '0',
        }
      : {
          route: 'otp',
          variables_values: otp,
          numbers: mobiles,
          flash: '0',
        },
  );

  const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  const body = await response.text();

  /**
   * Prove success; never infer it.
   *
   * This is the same lesson MSG91 taught, and Fast2SMS behaves the same way: a
   * rejected request comes back as HTTP 200 with `{"return":false, ...}`. The
   * first version of the MSG91 code treated an unparseable body as success,
   * which would have reported a code as sent while the user waited for an SMS
   * that never left. So the only accepted outcome is an explicit `return: true`
   * — an error, a missing field, or bytes that will not parse all count as a
   * failed send.
   *
   * Fast2SMS's own account gates surface here as ordinary failures, which is
   * exactly right: as of writing this account returns "complete website
   * verification" on the otp route and "you need to complete one transaction of
   * 100 INR or more" on any route. Those are not code bugs and they must not look
   * like successes.
   */
  const failure = ((): string | null => {
    if (!response.ok) {
      return `http ${response.status}: ${body.slice(0, 200)}`;
    }
    let parsed: { return?: boolean; message?: unknown; status_code?: number };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return `unparseable response: ${body.slice(0, 200)}`;
    }
    if (parsed.return === true) {
      return null;
    }
    const detail = Array.isArray(parsed.message)
      ? parsed.message.join('; ')
      : String(parsed.message ?? 'no message');
    return `status_code ${String(parsed.status_code)}: ${detail}`;
  })();

  if (failure !== null) {
    // Safe to log: Fast2SMS's diagnostics name the cause — unverified account,
    // insufficient balance, bad route — and carry neither the number nor the
    // code.
    console.error(`fast2sms did not confirm the send: ${failure}`);
    return new Response(
      JSON.stringify({
        error: { http_code: 500, message: 'Could not send the code. Please try again.' },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // An empty 200 is what the hook contract wants for success.
  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
