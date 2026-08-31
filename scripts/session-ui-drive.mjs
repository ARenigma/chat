#!/usr/bin/env node
/**
 * Drive the provider half of a live session while the phone shows the member
 * half. The physical S22 is not rooted, so we cannot inject a second session —
 * instead: you (or Maestro) act as the member on-device; this script replies as
 * the provider and ends the session so the UI transitions are visible.
 *
 * Usage:
 *   1. On the phone: open a chat with the provider below, send any text.
 *   2. node scripts/session-ui-drive.mjs [--provider-email EMAIL] [--watch]
 *
 * With --watch it polls for a pending request from any conversation involving
 * the provider and auto-replies once, then waits for Enter before ending.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROVIDER_EMAIL =
  process.env.PROVIDER_EMAIL ?? 'ada.provider@chatapp.test';
const WATCH = process.argv.includes('--watch');
const autoEndArg = process.argv.find(a => a.startsWith('--auto-end='));
const AUTO_END_SEC = autoEndArg
  ? Number(autoEndArg.split('=')[1])
  : process.argv.includes('--auto-end')
  ? 12
  : null;

function fromEnvFile(key) {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find(l => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

function fail(msg) {
  console.error(`session-ui-drive FAILED: ${msg}`);
  process.exit(1);
}

const URL_BASE = process.env.SUPABASE_URL ?? fromEnvFile('SUPABASE_URL');
const ANON = process.env.SUPABASE_ANON_KEY ?? fromEnvFile('SUPABASE_ANON_KEY');
if (!URL_BASE || !ANON) fail('SUPABASE_URL / SUPABASE_ANON_KEY required');

const ref = new URL(URL_BASE).hostname.split('.')[0];
const SERVICE = (() => {
  const raw = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', ref],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const key = JSON.parse(raw).keys.find(k => k.id === 'service_role')?.api_key;
  if (!key) fail('no service_role key');
  return key;
})();

async function ensureSession(email) {
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
    fail(`generate_link ${email}: ${link.status}`);
  }
  const verify = await fetch(`${URL_BASE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: body.hashed_token }),
  });
  const session = await verify.json();
  if (!verify.ok) fail(`verify ${email}: ${verify.status}`);
  return { token: session.access_token, userId: session.user.id };
}

async function rpc(token, fn, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    fail(`${fn}: ${res.status} ${text}`);
  }
  return data;
}

async function adminGet(path) {
  const res = await fetch(`${URL_BASE}${path}`, {
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
    },
  });
  const data = await res.json();
  if (!res.ok) fail(`GET ${path}: ${res.status}`);
  return data;
}

const provider = await ensureSession(PROVIDER_EMAIL);
console.log(`provider ${PROVIDER_EMAIL} (${provider.userId})`);

// Accept policies if needed
const pending = await rpc(provider.token, 'pending_policy_acceptances');
if (Array.isArray(pending)) {
  for (const row of pending) {
    if (row.version_id) {
      await rpc(provider.token, 'accept_policy', {
        p_version_id: row.version_id,
        p_device_info: 'session-ui-drive',
      });
    }
  }
}

async function findPendingForProvider() {
  // session_requests where recipient is this provider and status pending
  const rows = await adminGet(
    `/rest/v1/session_requests?recipient_id=eq.${provider.userId}&status=eq.pending&order=created_at.desc&limit=5&select=*`,
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function waitForPending(timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await findPendingForProvider();
    if (row) return row;
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 2000));
  }
  fail(
    'timed out waiting for a pending session_request — send a message from the phone first',
  );
}

console.log('');
console.log('On the phone:');
console.log('  1. Open chat with Ada (or this provider)');
console.log('  2. Send any text message');
console.log('  3. Await chip removed — composer stays ready after first send');
console.log('');
console.log(
  WATCH
    ? 'Watching for pending request…'
    : 'Looking for an existing pending request…',
);

const request = WATCH
  ? await waitForPending()
  : (await findPendingForProvider()) ?? (await waitForPending());

console.log('');
console.log(
  `pending request ${request.id} conversation=${request.conversation_id}`,
);
console.log('Replying as provider (this auto-accepts the session)…');

const reply = await rpc(provider.token, 'send_message', {
  p_conversation_id: request.conversation_id,
  p_body: `I'm here — session accepted ${new Date().toLocaleTimeString(
    'en-IN',
  )}`,
});
if (reply?.error) fail(`send_message: ${reply.error}`);
console.log('Provider replied. On the phone you should now see:');
console.log(
  '  "Waiting for both people to be present. Billing has not started."',
);
console.log(
  '  (both sides holding a lease → status becomes active and billing starts)',
);

const active = await rpc(provider.token, 'get_active_session', {
  p_conversation_id: request.conversation_id,
});
console.log(`active session: ${JSON.stringify(active)}`);

// Claim leases from provider side so the session can leave pending_leases
if (active?.id) {
  for (let i = 0; i < 3; i += 1) {
    const claim = await rpc(provider.token, 'claim_session_lease', {
      p_session_id: active.id,
      p_kind: 'foreground',
    });
    console.log(`provider lease heartbeat → ${claim}`);
    await new Promise(r => setTimeout(r, 1000));
  }
}

if (AUTO_END_SEC !== null) {
  console.log(`\nHolding ${AUTO_END_SEC}s so you can see the phone UI…`);
  await new Promise(r => setTimeout(r, AUTO_END_SEC * 1000));
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question(
      '\nPress Enter on this terminal to END the session (watch the phone)… ',
      () => {
        rl.close();
        resolve();
      },
    );
  });
}

if (active?.id) {
  await rpc(provider.token, 'end_session', {
    p_session_id: active.id,
    p_end_reason: 'manual',
    p_report_reason: null,
    p_report_message_ids: null,
    p_report_statement: null,
  });
  console.log('Session ended. Phone banner should clear.');
}

console.log('session-ui-drive OK');
