/**
 * Supabase's Send SMS auth hook, delivering the login OTP over WhatsApp.
 *
 * ADR-0009 §2: Supabase Auth owns the login and the messaging vendor is only the
 * carrier. The client calls `signInWithOtp({ phone })`, Supabase generates and
 * stores the code and hands it to this function, we put it on the network, and
 * the client calls `verifyOtp`. Nothing about identity, RLS, refresh tokens or
 * account deletion changes — which is the whole reason this is a hook.
 *
 * The carrier is the Meta WhatsApp Cloud API (2026-09-14, replacing Fast2SMS).
 * WhatsApp does not let us author OTP copy: the code rides an approved template
 * in the AUTHENTICATION category ("{{1}} is your verification code") with a
 * copy-code button, and we pass the code as the `{{1}}` parameter. Meta generates
 * nothing — the sender owns the code, which is exactly the hook's contract.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages/
 *
 * This function never generates or validates a code. It cannot: it has no storage
 * and no idea what the user typed. Its only job — and the only thing it can get
 * wrong — is delivery. A WhatsApp delivery FAILURE (the recipient has no
 * WhatsApp) is not visible on this synchronous call; Meta returns 200 as soon as
 * it accepts the message, and the failure arrives later on the webhook
 * (`wa-webhook`). The client offers "Get SMS instead" (Firebase) as the fallback.
 *
 * Secrets it needs (`supabase secrets set --env-file ...`, never as arguments):
 *   SEND_SMS_HOOK_SECRET      the `v1,whsec_...` value Supabase shows for the hook
 *   WHATSAPP_TOKEN            System User permanent token (whatsapp_business_messaging)
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id, from WhatsApp > API Setup
 *   WHATSAPP_TEMPLATE_NAME    the approved AUTHENTICATION template's name
 *   WHATSAPP_LANG             the template's language code, e.g. 'en' (default 'en')
 */

/** Standard Webhooks: `v1,<base64 hmac>`, possibly several space-separated. */
const SIGNATURE_HEADER = 'webhook-signature';
const ID_HEADER = 'webhook-id';
const TIMESTAMP_HEADER = 'webhook-timestamp';

/** Reject anything older than this, so a captured request cannot be replayed. */
const TOLERANCE_SECONDS = 300;

/** Meta Graph API version pinned so an unannounced default bump cannot move us. */
const GRAPH_VERSION = 'v21.0';

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
 * Without this the endpoint is an open OTP relay: anyone who learns the URL could
 * post a phone number and a string and make us pay to deliver it. That is not a
 * theoretical concern for a function whose whole job is spending money per
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
 * WhatsApp's `to` field wants E.164 without the `+` — for India, `91` + ten
 * digits. This route reaches Indian numbers only (the app's market); the sign-in
 * screen leaves the country code editable, so a foreign number can get this far
 * and must be told rather than watch a message never arrive. Returning null
 * produces a failure Supabase surfaces, instead of a silent success.
 */
function indianWhatsAppNumber(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 10) {
    return /^[6-9]/.test(digits) ? `91${digits}` : null;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2);
    return /^[6-9]/.test(local) ? `91${local}` : null;
  }
  // Anything else is a number this route cannot deliver to.
  return null;
}

Deno.serve(async request => {
  const secret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const templateName = Deno.env.get('WHATSAPP_TEMPLATE_NAME');
  const lang = Deno.env.get('WHATSAPP_LANG') ?? 'en';

  if (!secret || !token || !phoneNumberId || !templateName) {
    console.error(
      'send-sms is not configured (missing hook secret or WhatsApp creds)',
    );
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
    return new Response(JSON.stringify({ error: 'bad payload' }), {
      status: 400,
    });
  }

  const phone = payload.user?.phone ?? '';
  const otp = payload.sms?.otp ?? '';
  const to = indianWhatsAppNumber(phone);

  if (!to || !/^\d{4,8}$/.test(otp)) {
    // Deliberately not logging either value: a phone number is personal data and
    // the code is a live credential for the next two minutes.
    console.error('send-sms rejected a payload with an unusable phone or code');
    return new Response(JSON.stringify({ error: 'bad payload' }), {
      status: 400,
    });
  }

  /**
   * The WhatsApp Cloud API template send.
   *
   * The `body` component fills `{{1}}` with the code; the `button` component
   * (sub_type 'url', index 0) passes the same code so WhatsApp populates the
   * copy-code button's payload. Both are required for an AUTHENTICATION template
   * with an OTP button. E.164 without `+`.
   * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages/
   */
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: lang },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: otp }] },
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: otp }],
            },
          ],
        },
      }),
    },
  );

  const body = await response.text();

  /**
   * Prove acceptance; never infer it.
   *
   * The lesson Fast2SMS and MSG91 both taught: a rejected request can still be an
   * HTTP 200 with an error body. The Cloud API returns `{ messages: [{ id }] }`
   * only when it has ACCEPTED the message for delivery, and an `{ error: {...} }`
   * object otherwise. So the only accepted outcome is a real `messages[0].id`
   * (the WAMID) — an error, a missing field, or bytes that will not parse all
   * count as a failed send.
   *
   * NOTE this proves ACCEPTANCE, not DELIVERY. A recipient with no WhatsApp is
   * accepted here (200 + WAMID) and fails asynchronously on the `wa-webhook`
   * status callback; the client's "Get SMS instead" is the recovery for that.
   */
  const failure = ((): string | null => {
    if (!response.ok) {
      return `http ${response.status}: ${body.slice(0, 200)}`;
    }
    let parsed: {
      messages?: Array<{ id?: string }>;
      error?: { message?: string };
    };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return `unparseable response: ${body.slice(0, 200)}`;
    }
    if (parsed.messages?.[0]?.id) {
      return null;
    }
    return `no WAMID: ${parsed.error?.message ?? body.slice(0, 200)}`;
  })();

  if (failure !== null) {
    // Safe to log: the Cloud API's diagnostics name the cause (bad template,
    // unregistered number, token scope) and carry neither the number nor the
    // code.
    console.error(`whatsapp did not accept the send: ${failure}`);
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

  // An empty 200 is what the hook contract wants for success.
  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
