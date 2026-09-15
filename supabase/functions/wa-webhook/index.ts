/**
 * WhatsApp Cloud API webhook — delivery status and the setup handshake.
 *
 * The OTP SEND path (send-sms) never touches this: sending is a synchronous POST
 * to the Cloud API. This endpoint only RECEIVES — the message status callbacks
 * (sent / delivered / read / FAILED) and, if ever subscribed, inbound messages.
 * Meta also requires a verified webhook before the app can use the API in
 * production, so this exists as much for setup as for runtime.
 *
 * Why it matters: a WhatsApp OTP to a number with no WhatsApp is ACCEPTED by the
 * send call (200 + WAMID) and only fails here, seconds later, as a `failed`
 * status. Recording that is what lets the product know WhatsApp is not a viable
 * channel for a given number and lean on the SMS fallback (Firebase).
 *
 * Deploy WITHOUT jwt verification — Meta calls it with no Supabase JWT:
 *   supabase functions deploy wa-webhook --no-verify-jwt
 * (or `[functions.wa-webhook] verify_jwt = false` in config.toml).
 *
 * Secrets:
 *   WA_VERIFY_TOKEN  any string; must match the "Verify token" set in the Meta
 *                    App dashboard webhook config. Used only for the GET handshake.
 *   META_APP_SECRET  the Meta App secret, to validate X-Hub-Signature-256 on POSTs
 *                    so only Meta can post here.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/
 */

const SIGNATURE_HEADER = 'x-hub-signature-256';

const hexFromBytes = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

/** Constant-time hex compare, so a wrong signature leaks no timing information. */
function sameHex(a: string, b: string): boolean {
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
 * Verify the payload came from Meta: HMAC-SHA256 of the RAW body keyed with the
 * app secret, compared against the `sha256=` value in X-Hub-Signature-256.
 */
async function verifyMeta(
  raw: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header?.startsWith('sha256=')) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(raw),
  );
  return sameHex(
    header.slice('sha256='.length),
    hexFromBytes(new Uint8Array(mac)),
  );
}

interface StatusEntry {
  id?: string;
  status?: string;
  errors?: Array<{ code?: number; title?: string }>;
}

Deno.serve(async request => {
  const verifyToken = Deno.env.get('WA_VERIFY_TOKEN');
  const appSecret = Deno.env.get('META_APP_SECRET');

  // --- Setup handshake: Meta GETs with hub.* params; echo the challenge. ---
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && verifyToken && token === verifyToken) {
      // Plain-text body, exactly the challenge value.
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // --- Status/inbound events. Validate it is really Meta before trusting it. ---
  const raw = await request.text();
  if (
    !appSecret ||
    !(await verifyMeta(raw, request.headers.get(SIGNATURE_HEADER), appSecret))
  ) {
    return new Response('bad signature', { status: 401 });
  }

  try {
    const body = JSON.parse(raw) as {
      entry?: Array<{
        changes?: Array<{ value?: { statuses?: StatusEntry[] } }>;
      }>;
    };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const status of change.value?.statuses ?? []) {
          if (status.status === 'failed') {
            // A delivery failure — the recipient likely has no WhatsApp. Named
            // by WAMID + error code, never the number or the code. This is the
            // signal the SMS fallback (Firebase) exists for; recording it in a
            // table would let the client auto-offer SMS. Logged for now.
            const err = status.errors?.[0];
            console.error(
              `wa delivery failed wamid=${status.id ?? '?'} code=${
                err?.code ?? '?'
              } ${err?.title ?? ''}`,
            );
          }
        }
      }
    }
  } catch {
    // A malformed body is still acknowledged: Meta retries on a non-200 and a
    // parse error is not something a retry fixes.
    console.error('wa-webhook could not parse a payload');
  }

  // Must respond 200 within a few seconds or Meta retries and eventually
  // disables the subscription.
  return new Response('OK', { status: 200 });
});
