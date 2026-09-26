/**
 * The engagement-nudge sender — the second notification type's server side.
 *
 * Where send-push reacts to a real message, this proactively nudges INACTIVE
 * members with a random online provider's photo (a BigPicture, built client-side
 * from `kind: 'engagement'`). Rules live in `engagement_candidates` (migration
 * 016): inactive members, a random `here` provider with a photo, one per member
 * per day. This function just delivers what that view selects and stamps the
 * members nudged so the daily cap holds.
 *
 * It reuses send-push's OAuth: a service-account JWT minted to a Google access
 * token, cached in module scope. Same service_role-only guard, because it can
 * push to any member.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { providerFirstName } from '../_shared/names.ts';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface Candidate {
  member_id: string;
  token: string;
  platform: string;
  provider_id: string;
  provider_display_name: string | null;
  provider_avatar_url: string | null;
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

/** Send one engagement nudge. Data-only, so the app builds the BigPicture. */
async function send(bearer: string, projectId: string, row: Candidate): Promise<boolean> {
  // Always a provider (the nudge is about one): first name only (_shared/names.ts).
  const who = providerFirstName(row.provider_display_name) ?? 'Someone';
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          android: { priority: 'high' },
          data: {
            kind: 'engagement',
            // The client validates peerId with isUuid before routing on it.
            peerId: row.provider_id,
            senderName: who,
            // Warm and soft, not salesy: someone is around, no urgency, no claim
            // of a "status" the product does not have.
            title: 'Someone’s around to talk',
            body: `${who} is here right now`,
            ...(row.provider_avatar_url ? { senderAvatar: row.provider_avatar_url } : {}),
            // Whose nudge this is (send-push's reason, migration 143): the
            // device shows a push only to the account signed in on it.
            recipientId: row.member_id,
          },
        },
      }),
    },
  );
  if (!response.ok) {
    console.error(`engagement fcm ${response.status} for member ${row.member_id}`);
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

  // Service-role only: this can push to any member, exactly like send-push.
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
  const { data, error } = await db
    .from('engagement_candidates')
    .select('*')
    .limit(500);
  if (error) {
    console.error('engagement_candidates', error.message);
    return new Response(error.message, { status: 500 });
  }
  const candidates = (data ?? []) as Candidate[];
  if (candidates.length === 0) {
    return Response.json({ candidates: 0, sent: 0 });
  }

  const bearer = await accessToken(sa);
  // A member counts as nudged if any of their devices took the push, so the daily
  // cap is stamped once per member rather than per device.
  const nudged = new Set<string>();
  let sent = 0;
  for (const row of candidates) {
    const ok = await send(bearer, sa.project_id, row);
    if (ok) {
      sent += 1;
      nudged.add(row.member_id);
    }
  }

  if (nudged.size > 0) {
    const { error: markError } = await db.rpc('mark_engagement_nudged', {
      p_member_ids: [...nudged],
    });
    if (markError) {
      console.error('mark_engagement_nudged', markError.message);
    }
  }

  return Response.json({ candidates: candidates.length, sent, nudged: nudged.size });
});
