/**
 * "Someone opened your chat" — one push, to one person, right now.
 *
 * Goal items 3 and 4 (2026-09-06). Called by `announce_chat_open` (migration
 * 068) over pg_net, exactly the way `dispatch_call_push` calls send-call: the
 * RPC has already decided WHETHER to send — the member holds a minute, the peer
 * is away, no session is live, the cooldown has passed — so this function only
 * resolves who to say it about and hands it to FCM.
 *
 * It sends `kind: 'engagement'`, not a new kind, and that is deliberate: the
 * client already reads that kind (`readEngagementPush`) and the native side
 * already builds a BigPicture notification for it, so this needed no app
 * release and no native work. The copy differs because the copy is in the
 * payload.
 *
 * Names follow the same privacy rule as every other push here: a provider is
 * named by their stage name, a member never is — `member_handle` gives the
 * pseudonymous handle the rest of the app shows.
 */
interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
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

interface Target {
  token: string;
  platform: string;
}

/** Data-only, so the app builds the notification. */
async function send(
  bearer: string,
  projectId: string,
  token: string,
  opener: string,
  openerAvatar: string | null,
  openerId: string,
): Promise<boolean> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          android: { priority: 'high' },
          data: {
            kind: 'engagement',
            // The client validates peerId with isUuid before routing on it.
            peerId: openerId,
            senderName: opener,
            // States the fact and nothing more. No "waiting", which would be a
            // claim about how long; no count, which would be a claim about
            // demand. Someone opened the thread — that is all that happened.
            title: `Hey, ${opener ?? 'Someone'} is here`,
            body: `${opener} just opened your chat`,
            ...(openerAvatar ? { senderAvatar: openerAvatar } : {}),
          },
        },
      }),
    },
  );
  if (!response.ok) {
    console.error(`open-alert fcm ${response.status} for peer push`);
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

  // Service-role only: this can push to anyone, exactly like send-push.
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

  const body = (await request.json().catch(() => null)) as
    | { peer_id?: string; opener_id?: string }
    | null;
  const peerId = body?.peer_id;
  const openerId = body?.opener_id;
  if (!peerId || !openerId) {
    return new Response('peer_id and opener_id are required', { status: 400 });
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

  // The opener's public name. A provider has a stage name in the directory; a
  // member has none by design, so they stay the pseudonymous handle.
  const { data: directory } = await db
    .from('provider_directory')
    .select('display_name, avatar_url')
    .eq('id', openerId)
    .maybeSingle();
  let opener = directory?.display_name ?? null;
  if (opener === null) {
    const { data: handle } = await db.rpc('member_handle', { p_id: openerId });
    opener = (handle as string | null) ?? 'Someone';
  }

  const { data: tokens, error } = await db
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', peerId);
  if (error) {
    console.error('push_tokens', error.message);
    return new Response(error.message, { status: 500 });
  }
  const targets = (tokens ?? []) as Target[];
  if (targets.length === 0) {
    return Response.json({ sent: 0, reason: 'no_device' });
  }

  const bearer = await accessToken(sa);
  let sent = 0;
  for (const t of targets) {
    if (await send(bearer, sa.project_id, t.token, opener, directory?.avatar_url ?? null, openerId)) {
      sent += 1;
    }
  }
  return Response.json({ sent, targets: targets.length });
});
