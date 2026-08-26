#!/usr/bin/env node
/**
 * A provider, from the terminal.
 *
 * The provider surface does not exist in the app yet (ADR-0002 describes it; it
 * is not built), which makes the human-to-human path impossible to test: one
 * device cannot be both sides. Every device journey we have therefore only
 * proves the sender's half.
 *
 * This closes that gap cheaply. It authenticates as a real admitted provider
 * and talks through exactly the same RPCs the app would, `send_message`, the
 * same RLS, the same rate limits, so replying here exercises the phone's
 * Realtime subscription, typing indicator and read receipts for real.
 *
 * It is a test and ops tool, not a product surface, and it is deliberately
 * unglamorous so nobody mistakes it for one.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   PROVIDER_EMAIL=... PROVIDER_PASSWORD=... \
 *   node scripts/provider-console.mjs
 *
 * Values default to `.env` and `.secrets/provider-password.txt` when present.
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function fromEnvFile(key) {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) {
    return undefined;
  }
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find(l => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

function readSecret(relative) {
  const file = join(ROOT, relative);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
}

const URL_BASE = process.env.SUPABASE_URL ?? fromEnvFile('SUPABASE_URL') ?? '';
const ANON =
  process.env.SUPABASE_ANON_KEY ?? fromEnvFile('SUPABASE_ANON_KEY') ?? '';
const EMAIL = process.env.PROVIDER_EMAIL ?? 'ada.provider@chatapp.test';
const PASSWORD =
  process.env.PROVIDER_PASSWORD ??
  readSecret('.secrets/provider-password.txt') ??
  '';

const POLL_MS = 2000;

function fail(message) {
  console.error(`provider-console: ${message}`);
  process.exit(1);
}

if (URL_BASE === '' || ANON === '') {
  fail('SUPABASE_URL and SUPABASE_ANON_KEY are required (or present in .env)');
}
if (PASSWORD === '') {
  fail('PROVIDER_PASSWORD is required (or .secrets/provider-password.txt)');
}

// --- Auth -------------------------------------------------------------------
const tokenResponse = await fetch(
  `${URL_BASE}/auth/v1/token?grant_type=password`,
  {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  },
);
if (!tokenResponse.ok) {
  fail(
    `sign-in failed (${tokenResponse.status}): ${(
      await tokenResponse.text()
    ).slice(0, 200)}`,
  );
}
const session = await tokenResponse.json();
const SELF = session.user?.id;
let jwt = session.access_token;

// The session is short-lived and this console is meant to be left open.
setInterval(async () => {
  const r = await fetch(`${URL_BASE}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (r.ok) {
    jwt = (await r.json()).access_token;
  }
}, 45 * 60 * 1000).unref();

const authed = () => ({
  apikey: ANON,
  Authorization: `Bearer ${jwt}`,
  'Content-Type': 'application/json',
});

async function rest(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: authed(),
    ...init,
  });
  const text = await r.text();
  if (!r.ok) {
    fail(`${init.method ?? 'GET'} ${path} -> ${r.status}\n${text}`);
  }
  return text === '' ? null : JSON.parse(text);
}

// --- Pick a thread ----------------------------------------------------------
const threads = await rest('conversation_summaries?order=last_message_at.desc');
if (threads.length === 0) {
  console.log(
    `signed in as ${EMAIL}\n\n` +
      'No conversations yet. Open the app on your phone, tap Ada in the\n' +
      'directory, send a message, then re-run this.',
  );
  process.exit(0);
}

const thread = threads[0];
console.log(`signed in as ${EMAIL} (${SELF.slice(0, 8)})`);
console.log(
  `${threads.length} thread(s); attached to the most recent ` +
    `(member ${thread.peer_id.slice(0, 8)}, ${thread.unread_count} unread)\n`,
);

// --- Replay history, then follow --------------------------------------------
let seen = new Set();

function show(m) {
  const mine = m.sender_id === SELF;
  const when = new Date(m.created_at).toTimeString().slice(0, 5);
  const who = mine ? 'you ' : 'them';
  const receipt = mine && m.read_at !== null ? '  ✓read' : '';
  console.log(`${when} ${who} │ ${m.body}${receipt}`);
}

const initial = await rest(
  `messages?conversation_id=eq.${thread.id}&order=created_at.asc&limit=50`,
);
for (const m of initial) {
  seen.add(m.id);
  show(m);
}
console.log('\n, type a reply and press enter; ctrl-c to quit ,\n');

// Polling rather than a socket: this is the side under test's *counterpart*, and
// a poll here still exercises the phone's Realtime subscription when we send.
// It also keeps this script free of the realtime client and its Node quirks.
async function poll() {
  const rows = await rest(
    `messages?conversation_id=eq.${thread.id}&order=created_at.asc&limit=50`,
  );
  for (const m of rows) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      show(m);
    } else if (m.sender_id === SELF && m.read_at !== null) {
      // Surface the read receipt the phone just wrote, once.
      const key = `read:${m.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.log(`     ↳ member read: "${m.body.slice(0, 40)}"`);
      }
    }
  }
}
setInterval(() => {
  void poll();
}, POLL_MS).unref();

// --- Send -------------------------------------------------------------------
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '',
});
rl.on('line', async line => {
  const body = line.trim();
  if (body === '') {
    return;
  }
  const result = await rest('rpc/send_message', {
    method: 'POST',
    body: JSON.stringify({ p_conversation_id: thread.id, p_body: body }),
  });
  if (result?.success !== true) {
    // The rejection codes are the interesting output here: BLOCKED, SUSPENDED
    // and RATE_LIMITED all come from migration 005 and are worth seeing.
    console.log(`     ✗ not sent: ${result?.error ?? 'unknown'}`);
  }
});
rl.on('close', () => process.exit(0));
