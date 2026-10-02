/**
 * The incoming-call sender — the third notification type's server side.
 *
 * Fired in real time by the `call_push_on_insert` trigger (migration 017) the
 * moment a ringing call row is created, because a call cannot wait for a cron.
 * Sends a data-only `kind: 'call'` push; the client builds a heads-up
 * CallStyle notification (no full-screen intent) so the phone rings even
 * when backgrounded or locked.
 *
 * Reuses send-push's service-account OAuth and the same service_role-only guard.
 * Reads `pending_call_pushes` rather than the posted `call_id` so it naturally
 * covers every device the callee has and is safe to retry.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { pushName } from '../_shared/names.ts';
import { reportEdgeFailure, withSentry } from '../_shared/sentry.ts';

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
  media_backend: 'current' | 'livekit' | 'agora';
  media_experiment_id: string | null;
  // The callee's account (migration 143); absent against an older database.
  recipient_id?: string;
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

/** FCM error codes that mean "this token will never work again" — mirrors send-push. */
const DEAD_TOKEN = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

/**
 * Ring one device. `android.priority: high` + a data-only payload so the app wakes
 * and builds the CallStyle notification; a ttl of 30s so a call push that arrives
 * after the ring is over is dropped by FCM rather than shown late.
 *
 * Returns 'dead' for a token FCM will never accept again, so the caller can prune
 * it — the same cleanup send-push does. Without this, a provider who reinstalled
 * accumulates stale tokens (seen live: 3 providers holding 16 tokens) and every
 * call fans out onto tokens that can never ring.
 */
async function send(
  bearer: string,
  projectId: string,
  row: Pending,
  callerIsProvider: boolean,
): Promise<'sent' | 'dead' | 'retry'> {
  const who = pushName(row.caller_display_name, callerIsProvider) ?? 'Someone';
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          // 30s ring timeout — matches meter_active_calls and platform.test.ts (android-audit.md)
          // TODO: align SQL ringing expiry in meter_active_calls to 30s in migration 028+
          android: { priority: 'high', ttl: '30s' },
          data: {
            kind: 'call',
            callId: row.call_id,
            conversationId: row.conversation_id,
            // The caller, validated with isUuid on the client before routing.
            peerId: row.peer_id,
            senderName: who,
            medium: row.medium,
            mediaBackend: row.media_backend,
            ...(row.media_experiment_id
              ? { mediaExperimentId: row.media_experiment_id }
              : {}),
            ...(row.caller_avatar_url ? { senderAvatar: row.caller_avatar_url } : {}),
            // Whose ring this is (143), for send-push's reason: the device
            // rings only for the account signed in on it. Spread like the
            // other optional fields: FCM data values must be strings, and a
            // null would refuse the whole call push.
            ...(row.recipient_id ? { recipientId: row.recipient_id } : {}),
          },
        },
      }),
    },
  );

  if (response.ok) {
    return 'sent';
  }

  const text = await response.text();
  let status = '';
  try {
    status = (JSON.parse(text)?.error?.status ?? '') as string;
  } catch {
    status = '';
  }
  if (DEAD_TOKEN.has(status) || response.status === 404) {
    // Logged like the transient case: a dead token is a device that will never
    // ring again, and until now the only trace was a `dead` count nobody reads.
    console.error(
      `push-failure send-call dead ${response.status} ${status} for call ${row.call_id}`,
    );
    return 'dead';
  }
  console.error(
    `push-failure send-call fcm ${response.status} ${status} for call ${row.call_id}`,
  );
  return 'retry';
}

Deno.serve(withSentry('send-call', async request => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rawSa = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!url || !serviceKey || !rawSa) {
    console.error('push-failure send-call missing SUPABASE_URL/SERVICE_ROLE_KEY/FCM_SERVICE_ACCOUNT');
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
    console.error('push-failure send-call FCM_SERVICE_ACCOUNT is missing private_key/client_email/project_id');
    return new Response('bad service account', { status: 500 });
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await db.from('pending_call_pushes').select('*').limit(100);
  if (error) {
    console.error(`push-failure send-call pending_call_pushes ${error.message}`);
    return new Response(error.message, { status: 500 });
  }
  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) {
    return Response.json({ pending: 0, sent: 0 });
  }


  /*
   * Which callers are providers, so their ring carries the first name only
   * (_shared/names.ts). From `profiles.role`, not the directory: a provider the
   * directory hides is still a provider. A failed lookup FAILS CLOSED: every
   * sender is named by first name, so a DB hiccup can never put a provider's
   * full name on a lock screen. A member's two-word handle then shows its
   * first word only, which reveals nothing more than the handle does.
   */
  const peerIds = [...new Set(pending.map(r => r.peer_id))];
  const { data: roles, error: roleError } = await db
    .from('profiles')
    .select('id')
    .in('id', peerIds)
    .eq('role', 'provider');
  if (roleError) {
    console.error(`push-failure send-call provider roles ${roleError.message}`);
  }
  const providers = new Set(((roles ?? []) as { id: string }[]).map(r => r.id));
  const isProvider = (id: string): boolean => roleError !== null || providers.has(id);

  const bearer = await accessToken(sa);
  const notified = new Set<string>();
  const deadTokens = new Set<string>();
  let sent = 0;
  for (const row of pending) {
    const result = await send(bearer, sa.project_id, row, isProvider(row.peer_id));
    if (result === 'sent') {
      sent += 1;
      notified.add(row.call_id);
    } else if (result === 'dead') {
      deadTokens.add(row.token);
    }
  }

  // The silent failure this function had no trace of: rows existed, every one
  // of them failed, and the caller still got a 200. The phone never rang.
  if (sent === 0) {
    console.error(
      `push-failure send-call rang no device for ${pending.length} pending row(s)`,
    );
    // The "the phone never rang" case, which had no trace beyond the log line.
    await reportEdgeFailure('send-call', 'rang no device', { pending: pending.length });
  }

  if (notified.size > 0) {
    const { error: markError } = await db.rpc('mark_calls_notified', {
      p_call_ids: [...notified],
    });
    if (markError) {
      console.error(`push-failure send-call mark_calls_notified ${markError.message}`);
    }
  }

  // Prune tokens FCM rejected as permanently dead, exactly as send-push does, so
  // a reinstalled provider's stale tokens do not pile up and get rung forever.
  if (deadTokens.size > 0) {
    const { error: forgetError } = await db.rpc('forget_push_tokens', {
      p_tokens: [...deadTokens],
    });
    if (forgetError) {
      console.error(`push-failure send-call forget_push_tokens ${forgetError.message}`);
    }
  }

  return Response.json({
    pending: pending.length,
    sent,
    notified: notified.size,
    dead: deadTokens.size,
  });
}));
