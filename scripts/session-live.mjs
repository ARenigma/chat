#!/usr/bin/env node
/**
 * Drive a paid-session start/end cycle against the LIVE Supabase project with
 * two JWTs (member + provider) — the equivalent of two phones without needing
 * them. Proves the RPCs the app actually calls:
 *
 *   open_conversation → send_message (member) → pending request
 *   → send_message (provider) → paid_session active
 *   → end_session → get_active_session null
 *
 * Uses the same admin generate_link + verify path as scripts/dev-session.mjs.
 *
 *   node scripts/session-live.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEMBER_EMAIL = process.env.MEMBER_EMAIL ?? 'ada.member@chatapp.test';
const PROVIDER_EMAIL =
  process.env.PROVIDER_EMAIL ?? 'ada.provider@chatapp.test';

function fromEnvFile(key) {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find(l => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

function fail(msg) {
  console.error(`session-live FAILED: ${msg}`);
  process.exit(1);
}

function ok(label) {
  console.log(`  ok  ${label}`);
}

const URL_BASE = process.env.SUPABASE_URL ?? fromEnvFile('SUPABASE_URL');
const ANON = process.env.SUPABASE_ANON_KEY ?? fromEnvFile('SUPABASE_ANON_KEY');
if (!URL_BASE || !ANON) {
  fail('SUPABASE_URL and SUPABASE_ANON_KEY required');
}

const ref = new URL(URL_BASE).hostname.split('.')[0];

function serviceRoleKey() {
  const raw = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', ref],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const key = JSON.parse(raw).keys.find(k => k.id === 'service_role')?.api_key;
  if (typeof key !== 'string') {
    fail('could not read service_role key — is the Supabase CLI logged in?');
  }
  return key;
}

const SERVICE = serviceRoleKey();

async function ensureUser(email) {
  const link = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  let body = await link.json();
  if (!link.ok || typeof body.hashed_token !== 'string') {
    const created = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!created.ok) {
      const detail = await created.json();
      fail(`create ${email}: ${created.status} ${detail.msg ?? ''}`);
    }
    const retry = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    body = await retry.json();
    if (!retry.ok || typeof body.hashed_token !== 'string') {
      fail(`generate_link still failed for ${email}`);
    }
  }
  const verify = await fetch(`${URL_BASE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: body.hashed_token }),
  });
  const session = await verify.json();
  if (!verify.ok || typeof session.access_token !== 'string') {
    fail(`verify ${email}: ${verify.status}`);
  }
  return {
    accessToken: session.access_token,
    userId: session.user.id,
  };
}

async function rpc(accessToken, fn, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    fail(
      `${fn} → ${res.status}: ${
        typeof data === 'object' ? JSON.stringify(data) : data
      }`,
    );
  }
  return data;
}

async function adminSqlish(path, init) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    fail(`admin ${path} → ${res.status}: ${body}`);
  }
}

console.log('session-live: minting member + provider JWTs…');
const member = await ensureUser(MEMBER_EMAIL);
const provider = await ensureUser(PROVIDER_EMAIL);
ok(`member ${MEMBER_EMAIL} (${member.userId})`);
ok(`provider ${PROVIDER_EMAIL} (${provider.userId})`);

// Ensure the provider side is actually a provider with a listing, and the
// member has enough purchased balance for a session to start.
await adminSqlish(`/rest/v1/profiles?id=eq.${provider.userId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    role: 'provider',
    display_name: 'Ada',
    is_available: true,
    identity_verified_at: new Date().toISOString(),
    date_of_birth: '1998-01-01',
  }),
});
await adminSqlish(`/rest/v1/profiles?id=eq.${member.userId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    display_name: 'Ada Member',
    purchased_balance: 500,
  }),
});
ok('seeded roles + balance');

// Accept current policies for both (migration 027 gate).
for (const who of [member, provider]) {
  const pendingPolicies = await rpc(
    who.accessToken,
    'pending_policy_acceptances',
  );
  if (Array.isArray(pendingPolicies)) {
    for (const row of pendingPolicies) {
      if (row.version_id) {
        await rpc(who.accessToken, 'accept_policy', {
          p_version_id: row.version_id,
          p_device_info: 'session-live',
        });
      }
    }
  }
}
ok('policies accepted (or already clear)');

const conversationId = await rpc(member.accessToken, 'open_conversation', {
  p_provider_id: provider.userId,
});
if (typeof conversationId !== 'string') {
  fail(`open_conversation returned ${JSON.stringify(conversationId)}`);
}
ok(`conversation ${conversationId}`);

const sendResult = await rpc(member.accessToken, 'send_message', {
  p_conversation_id: conversationId,
  p_body: `session-live ping ${Date.now()}`,
});
if (sendResult?.error) {
  fail(`member send_message error: ${sendResult.error}`);
}
ok('member text sent');

const pending = await rpc(member.accessToken, 'get_pending_session_request', {
  p_conversation_id: conversationId,
});
if (!pending || pending.channel !== 'chat') {
  fail(`expected pending chat request, got ${JSON.stringify(pending)}`);
}
ok(`pending request ${pending.id ?? '(ok)'}`);

const reply = await rpc(provider.accessToken, 'send_message', {
  p_conversation_id: conversationId,
  p_body: `session-live reply ${Date.now()}`,
});
if (reply?.error) {
  fail(`provider send_message error: ${reply.error}`);
}
ok('provider reply (auto-accept)');

const active = await rpc(member.accessToken, 'get_active_session', {
  p_conversation_id: conversationId,
});
if (!active || !active.id) {
  fail(`expected active session, got ${JSON.stringify(active)}`);
}
ok(`active session ${active.id} status=${active.status}`);

await rpc(member.accessToken, 'end_session', {
  p_session_id: active.id,
  p_end_reason: 'manual',
  p_report_reason: null,
  p_report_message_ids: null,
  p_report_statement: null,
});
ok('end_session');

const after = await rpc(member.accessToken, 'get_active_session', {
  p_conversation_id: conversationId,
});
if (after !== null) {
  fail(`expected null after end, got ${JSON.stringify(after)}`);
}
ok('get_active_session is null after end');

console.log('session-live OK');
