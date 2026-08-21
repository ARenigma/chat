/**
 * Supabase's Send SMS auth hook, delivering through MSG91.
 *
 * ADR-0009 §2: Supabase Auth owns the login and MSG91 is only the carrier. The
 * client calls `signInWithOtp({ phone })`, Supabase generates and stores the
 * code and hands it to this function, we put it on the network, and the client
 * calls `verifyOtp`. Nothing about identity, RLS, refresh tokens or account
 * deletion changes — which is the whole reason this is a hook rather than the
 * MSG91 widget.
 *
 * This function never generates or validates a code. It cannot: it has no
 * storage and no idea what the user typed. That is a feature — the only thing it
 * can get wrong is delivery.
 *
 * Secrets it needs (`supabase secrets set --env-file ...`, never as arguments):
 *   SEND_SMS_HOOK_SECRET  the `v1,whsec_...` value Supabase shows for the hook
 *   MSG91_AUTHKEY         MSG91 panel -> Authkey
 *   MSG91_TEMPLATE_ID     the DLT-approved template, with the code as ##var1##
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

/** E.164 without the plus, which is what MSG91 wants. */
function msg91Number(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  // 10 digits is a bare Indian number; assume +91 rather than failing, because
  // Supabase stores what the client sent and the client defaults to +91.
  const normalised = digits.length === 10 ? `91${digits}` : digits;
  return normalised.length >= 11 && normalised.length <= 15 ? normalised : null;
}

Deno.serve(async request => {
  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  const authkey = Deno.env.get('MSG91_AUTHKEY');
  const templateId = Deno.env.get('MSG91_TEMPLATE_ID');

  if (!secret || !authkey || !templateId) {
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
  const mobiles = msg91Number(phone);

  if (!mobiles || !/^\d{4,8}$/.test(otp)) {
    // Deliberately not logging either value: a phone number is personal data and
    // the code is a live credential for the next fifteen minutes.
    console.error('send-sms rejected a payload with an unusable phone or code');
    return new Response(JSON.stringify({ error: 'bad payload' }), { status: 400 });
  }

  const response = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: {
      authkey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      template_id: templateId,
      short_url: '0',
      // Makes MSG91 answer with the submission result rather than queueing
      // silently, so a rejected template surfaces here instead of as a user
      // who never receives a code.
      realTimeResponse: '1',
      recipients: [{ mobiles, var1: otp }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    // MSG91's error bodies name the cause — unapproved template, DLT mismatch,
    // insufficient balance — and contain neither the code nor the number.
    console.error(`msg91 ${response.status}: ${body}`);
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: 'Could not send the code. Please try again.',
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * MSG91 signals failure inside a 200, so success has to be proven rather than
   * assumed. A rejected authkey returns, verbatim:
   *
   *   HTTP/2 200
   *   {"message":"Invalid authkey or Token","type":"error"}
   *
   * The first version of this checked `type === 'error'` and treated an
   * unparseable body as success — which meant that if MSG91 ever answered with
   * HTML (a Cloudflare challenge, a maintenance page), the hook reported the code
   * as sent and the user sat waiting for an SMS that was never dispatched. In a
   * function whose only job is delivery, "I could not tell" must mean failure.
   *
   * So this requires an explicit `type: "success"` and treats everything else —
   * an error type, a missing type, unparseable bytes — as a failed send.
   */
  const failure = ((): string | null => {
    let parsed: { type?: string; message?: string };
    try {
      parsed = JSON.parse(body) as { type?: string; message?: string };
    } catch {
      return `unparseable response: ${body.slice(0, 200)}`;
    }
    if (parsed.type === 'success') {
      return null;
    }
    return parsed.message ?? `unexpected response type: ${String(parsed.type)}`;
  })();

  if (failure !== null) {
    // Safe to log: MSG91's diagnostics name the cause — invalid authkey,
    // unapproved template, DLT mismatch, no balance — and carry neither the
    // phone number nor the code.
    console.error(`msg91 did not confirm the send: ${failure}`);
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
