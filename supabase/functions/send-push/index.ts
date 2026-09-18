/**
 * The push sender.
 *
 * ADR-0005 left this open between Cloud Run (needs an open billing account) and
 * a four-hop federation chain. Neither was chosen: the org policy that forbade
 * service-account keys was relaxed for long enough to mint one key, then
 * re-enforced, and the key lives in this function's secrets. One hop, no VM, no
 * billing account. See ADR-0007 for what that costs and how to rotate it.
 *
 * What this function is careful about:
 *
 *   - It never sends a message body. `pending_pushes` does not expose one, and
 *     that is the point: a lock screen is read by whoever is holding the phone.
 *   - It drains ONE queue with two sources (migration 105): an undelivered
 *     message, and a provider-initiated chat request. The second is here rather
 *     than in a sender of its own because a provider reaching a member is a 1:1
 *     message event, and the only notification this app builds that Android
 *     treats as a conversation is the one a `pending_pushes` row produces.
 *   - It marks a message notified on success *and* on permanent failure, but not
 *     on a transient one, so a 503 from FCM retries next minute and a dead token
 *     does not retry forever.
 *   - It only accepts a service_role caller. `verify_jwt` alone would let any
 *     signed-in user trigger it.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/**
 * What the two branches of `pending_pushes` mean (migration 105).
 *
 *   'message'  someone sent a message and the recipient has not been told.
 *   'contact'  a PROVIDER started a chat with a member — a pending chat request
 *              the provider raised, carrying no message of its own. Before 105
 *              provider-initiated contact reached the member only when it
 *              happened to ride along with a message, so a provider who started
 *              a thread through `create_session_request` rather than
 *              `send_message` reached them nowhere at all.
 *
 * Both are 1:1 message events and both get the same payload, which is what lets
 * the app build one conversation notification for either. See the data map in
 * `send` for why that shape is the shape.
 */
type PushKind = 'message' | 'contact';

interface Pending {
  // A message id, or a session_request id on a 'contact' row. The view keeps the
  // old column name because ids from the two tables cannot collide and renaming
  // it would break nothing and fix nothing.
  message_id: string;
  conversation_id: string;
  peer_id: string;
  token: string;
  platform: string;
  sender_display_name: string | null;
  // The sender's public provider photo, when the sender is a provider; null for a
  // member sender. Rendered as the notification's BigPicture (the SP-photo hero).
  sender_avatar_url: string | null;
  created_at: string;
  // Absent when this function runs against a database from before 105.
  kind?: PushKind;
}

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  // `[=]` rather than a bare `=`: a regex literal opening with `=` reads as `/=`
  // to a scanner, which is what no-div-regex objects to.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/[=]+$/, '');
};

const utf8url = (text: string): string =>
  base64url(new TextEncoder().encode(text));

/** PEM (PKCS#8) to the DER bytes Web Crypto wants. */
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

/**
 * Mint a Google access token from the service account, cached in module scope.
 *
 * Warm invocations reuse it, which matters at a one-minute tick: without the
 * cache every run would do an extra RSA signature and a round trip to Google
 * before it could send anything. Sixty seconds of slack on the expiry so a token
 * cannot be handed out and then expire in flight.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) {
    return cached.token;
  }

  const header = utf8url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = utf8url(
    JSON.stringify({
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: OAUTH_URL,
      iat: now,
      exp: now + 3600,
    }),
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
    // The body of a token error names the cause (clock skew, revoked key,
    // wrong audience) and contains no secret, so it is worth surfacing.
    throw new Error(`token exchange ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expiresAt: now + body.expires_in };
  return body.access_token;
}

/** FCM error codes that mean "this token will never work again". */
const DEAD_TOKEN = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

async function send(
  bearer: string,
  projectId: string,
  row: Pending,
): Promise<'sent' | 'dead' | 'retry'> {
  const who = row.sender_display_name ?? 'Someone';
  // The hero photo (#6): the sender's public provider photo, ridden in the data
  // map as `senderAvatar` and rendered by the app as the Person icon. Present
  // only for a provider sender; a public-bucket URL the app downloads itself, so
  // FCM's ~1MB notification-image cap does not apply here (that cap only bit the
  // old `notification.image` path). Undefined drops the key rather than sending
  // null, which FCM rejects. Migration 015 records the lock-screen disclosure.
  const image = row.sender_avatar_url ?? undefined;
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: row.token,
          /*
           * STAGE 2: DATA-ONLY. Read this before touching it.
           *
           * There is deliberately no `notification` block. A conversation
           * notification — `MessagingStyle`, a `Person` with the sender's photo,
           * and a long-lived shortcut — can only be assembled by the APP, and the
           * app only gets the payload if the system does not render it first. So
           * the whole payload is data: `index.js`'s `setBackgroundMessageHandler`
           * wakes (that is what `priority: high` buys against Doze), reads this
           * map, and builds the notification in `Conversations.kt`.
           *
           * The cost, accepted with the stage-2 flip (Amit, 2026-08-27): a
           * data-only message is invisible to any client WITHOUT that handler, so
           * a tester on an older build stops getting notifications until they
           * update. That is the rollout caveat this stage always carried.
           *
           * Still no message text: the view this is generated from carries none,
           * and given who these conversations are with, content on a lock screen
           * is a disclosure this product cannot make. `senderAvatar` is the one
           * new fact — the sender's own public photo, which the app renders as the
           * Person icon, not the message.
           */
          android: {
            // priority high so a data-only message wakes the app out of Doze; no
            // channel_id, because the app owns `conversations` and names it itself.
            priority: 'high',
          },
          /*
           * FCM's data map is Map<String, String>, so everything is stringified
           * here and parsed in `src/lib/conversations.ts`. `sentAt` is epoch
           * milliseconds because `MessagingStyle.addMessage` takes a timestamp
           * and orders the transcript by it. `senderAvatar` is omitted (not sent
           * as null, which FCM rejects) when the sender has no public photo.
           *
           * EVERY FIELD HERE IS LOAD-BEARING FOR THE CONVERSATION REQUIREMENT.
           * https://developer.android.com/develop/ui/views/notifications/conversations
           *   "A notification is considered as a conversation notification if
           *   the following are true: The notification uses MessagingStyle. […]
           *   (Only if the app targets Android 11 or higher) The notification is
           *   associated with a valid long-lived dynamic or cached sharing
           *   shortcut."
           * and the shortcut must "have Person data attached for one or more
           * persons, identifying the other participants in the conversation."
           *
           * `Conversations.kt:146-231` assembles all of it, and it can only do
           * so from these four facts:
           *   conversationId → the shortcut id, and the notification id, so a
           *                    second push extends one transcript instead of
           *                    replacing it (setShortcutId + pushDynamicShortcut
           *                    with setLongLived(true)).
           *   peerId         → Person.setKey. Without it Android matches Persons
           *                    by NAME, and display names here are user-chosen
           *                    and not unique, so two providers who picked the
           *                    same name would merge into one conversation.
           *   senderName     → Person.setName, and the shortcut's labels.
           *   sentAt         → MessagingStyle.addMessage's timestamp, which is
           *                    what orders the transcript.
           *
           * `kind` is new with migration 105 and is deliberately a value neither
           * of the other two readers claims: `readCallPush` returns null unless
           * kind === 'call' and `readEngagementPush` unless kind === 'engagement'
           * (src/lib/conversations.ts), while `readConversationPush` ignores kind
           * entirely. So both values fall through to the conversation branch on
           * every client already shipped, and a later release can tell a first
           * contact from a reply without a second payload shape. It carries no
           * new information about the conversation — it names which of the two
           * queue branches this row came from.
           */
          data: {
            // The client validates this with isUuid before routing on it.
            peerId: row.peer_id,
            conversationId: row.conversation_id,
            senderName: who,
            sentAt: String(Date.parse(row.created_at)),
            kind: row.kind ?? 'message',
            ...(image ? { senderAvatar: image } : {}),
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
    // Logged like the transient case: a dead token means this device is never
    // notified again, and the only trace was a `dead` count nobody reads.
    console.error(
      `push-failure send-push dead ${response.status} ${status} for message ${row.message_id}`,
    );
    return 'dead';
  }
  // 429 and 5xx are the transient ones. Leaving notified_at null is what makes
  // the next tick retry, so this branch must not mark anything.
  console.error(
    `push-failure send-push fcm ${response.status} ${status} for message ${row.message_id}`,
  );
  return 'retry';
}

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const rawSa = Deno.env.get('FCM_SERVICE_ACCOUNT');

  if (!url || !serviceKey || !rawSa) {
    return new Response('not configured', { status: 500 });
  }

  // verify_jwt gets us "a valid token"; this gets us "the right one". Without
  // it any signed-in member could spin the sender.
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

  // Parsed defensively because the secret is set from a shell, and the natural
  // way to get a multi-line JSON file onto one env line is JSON.stringify,
  // which double-encodes it. That produces a *string* here rather than an
  // object, and the failure surfaces four calls later inside pemToDer as an
  // opaque 500. Unwrap one layer if we were handed one.
  let parsed: unknown = JSON.parse(rawSa);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }
  const sa = parsed as ServiceAccount;
  if (!sa?.private_key || !sa.client_email || !sa.project_id) {
    console.error('push-failure send-push FCM_SERVICE_ACCOUNT is missing private_key/client_email/project_id');
    return new Response('bad service account', { status: 500 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await db
    .from('pending_pushes')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    console.error(`push-failure send-push pending_pushes ${error.message}`);
    return new Response(error.message, { status: 500 });
  }
  const pending = (data ?? []) as Pending[];
  if (pending.length === 0) {
    return Response.json({ pending: 0, sent: 0, contacts: 0, dead: 0, retry: 0 });
  }

  const bearer = await accessToken(sa);

  // A message can have several rows, one per device the recipient has
  // registered. It counts as notified if any device took it, and as dead only
  // if every device rejected it.
  const outcomes = new Map<string, Set<string>>();
  const deadTokens = new Set<string>();
  let sent = 0;
  // Counted separately so the logs answer "did the provider-initiated path
  // actually fire?" without a query. It is the one branch with no second
  // symptom — a message that fails to notify still shows up in the thread, a
  // provider's outreach that fails to notify is invisible to everyone.
  let contacts = 0;

  for (const row of pending) {
    const result = await send(bearer, sa.project_id, row);
    if (result === 'sent') {
      sent += 1;
      if (row.kind === 'contact') {
        contacts += 1;
      }
    }
    if (result === 'dead') {
      deadTokens.add(row.token);
    }
    const set = outcomes.get(row.message_id) ?? new Set<string>();
    set.add(result);
    outcomes.set(row.message_id, set);
  }

  // Rows existed and not one of them landed. The function still returns 200, so
  // without this line a wholly broken tick is indistinguishable from a quiet one.
  if (sent === 0) {
    console.error(
      `push-failure send-push delivered nothing for ${pending.length} pending row(s)`,
    );
  }

  // Retry wins: if any device for this message deserves another attempt, the
  // message stays unnotified so the next tick picks it up again.
  const settled = [...outcomes.entries()]
    .filter(([, results]) => !results.has('retry'))
    .map(([messageId]) => messageId);

  if (settled.length > 0) {
    const { error: markError } = await db.rpc('mark_notified', {
      p_message_ids: settled,
    });
    if (markError) {
      console.error(`push-failure send-push mark_notified ${markError.message}`);
    }
  }
  if (deadTokens.size > 0) {
    const { error: forgetError } = await db.rpc('forget_push_tokens', {
      p_tokens: [...deadTokens],
    });
    if (forgetError) {
      console.error(`push-failure send-push forget_push_tokens ${forgetError.message}`);
    }
  }

  return Response.json({
    pending: pending.length,
    sent,
    contacts,
    dead: deadTokens.size,
    settled: settled.length,
  });
});
