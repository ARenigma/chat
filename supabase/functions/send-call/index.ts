/**
 * The incoming-call sender — the third notification type's server side.
 *
 * Fired in real time by the `call_push_on_insert` trigger (migration 017) the
 * moment a ringing call row is created, because a call cannot wait for a cron.
 * Sends a data-only `kind: 'call'` push; the client builds a CallStyle
 * notification with a full-screen intent so the phone actually rings, even
 * backgrounded or locked.
 *
 * Reuses send-push's service-account OAuth and the same service_role-only guard.
 * Reads `pending_call_pushes` rather than the posted `call_id` so it naturally
 * covers every device the callee has and is safe to retry.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface Pending {
  call_id: string;
  conversation_id: string;
  peer_id: string;
  medium: string;
  caller_display_name: string | null;
  caller_avatar_url: string | null;
  token: string;
  platform: string;
}

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
};

const utf8url = (text: string): string => base64url(new TextEncoder().encode(text));

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    der[i] = raw.charCodeAt(i);
  }
  return der;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
  }
  const header = utf8url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = utf8url(
    JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud: OAUTH_URL, iat: now, exp: now + 3600 }),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const assertion = `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`token exchange ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

/**
 * Ring one device. `android.priority: high` + a data-only payload so the app wakes
 * and builds the CallStyle notification; a ttl of 45s so a call push that arrives
 * after the ring is over is dropped by FCM rather than shown late.
 */
async function send(bearer: string, projectId: string, row: Pending): Promise<boolean> {
  const who = row.caller_display_name ?? 'Someone';
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          android: { priority: 'high', ttl: '45s' },
          data: {
            kind: 'call',
            callId: row.call_id,
            conversationId: row.conversation_id,
            // The caller, validated with isUuid on the client before routing.
            peerId: row.peer_id,
            senderName: who,
            medium: row.medium,
            ...(row.caller_avatar_url ? { senderAvatar: row.caller_avatar_url } : {}),
          },
        },
      }),
    },
  );
  if (!response.ok) {
    console.error(`call fcm ${response.status} for call ${row.call_id}`);
  }
  return response.ok;
}

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rawSa = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!url || !serviceKey || !rawSa) {
    return new Response('not configured', { status: 500 });
  }

  const auth = request.headers.get('Authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  let role = '';
  try {
    role = JSON.parse(atob(jwt.split('.')[1] ?? '')).role ?? '';
  } catch {
    role = '';
  }
  if (role !== 'service_role') {
    return new Response('forbidden', { status: 403 });
  }

  let parsed: unknown = JSON.parse(rawSa);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }
  const sa = parsed as ServiceAccount;
  if (!sa?.private_key || !sa.client_email || !sa.project_id) {
    return new Response('bad service account', { status: 500 });
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.from('pending_call_pushes').select('*').limit(100);
  if (error) {
    console.error('pending_call_pushes', error.message);
    return new Response(error.message, { status: 500 });
  }
  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) {
    return Response.json({ pending: 0, sent: 0 });
  }

  const bearer = await accessToken(sa);
  const notified = new Set<string>();
  let sent = 0;
  for (const row of pending) {
    const ok = await send(bearer, sa.project_id, row);
    if (ok) {
      sent += 1;
      notified.add(row.call_id);
    }
  }

  if (notified.size > 0) {
    const { error: markError } = await db.rpc('mark_calls_notified', {
      p_call_ids: [...notified],
    });
    if (markError) {
      console.error('mark_calls_notified', markError.message);
    }
  }

  return Response.json({ pending: pending.length, sent, notified: notified.size });
});
