#!/usr/bin/env node
/**
 * Sign the emulator in, without typing a password into the app.
 *
 * The problem this solves: every screen worth looking at is behind auth, and auth
 * is Google OAuth through the system browser, which an emulator with no Google
 * account cannot complete. So the redesign could be tested by reading code and
 * not by looking at it, which is precisely the gap MEMORY.md records as having
 * let three UI bugs through.
 *
 * How it gets in, and why this route rather than another:
 *
 *   - The app stores its session in MMKV, whose on-disk format is not something
 *     to hand-assemble from outside.
 *   - `src/lib/storage.ts` already runs `migrateLegacyStorage()` at import time,
 *     which discovers Supabase session keys in **AsyncStorage** and moves them
 *     into MMKV. That is a supported path that exists for real users upgrading.
 *   - AsyncStorage on Android is a SQLite file. `adb root` plus the emulator's
 *     own `sqlite3` can write one row into it.
 *
 * So: mint a real session against the real project with the password grant the
 * provider console already uses, write it where the migration will find it, and
 * let the app's own code do the rest. No app change, no auth bypass compiled into
 * anything, and nothing here can run against a device that is not rooted.
 *
 *   node scripts/dev-session.mjs
 *
 * The project comes from `.env`; the service role key comes from the authenticated
 * Supabase CLI. No password is read and nothing is printed: the token goes to the
 * device and is dropped.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE = 'com.companionchat';

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

function fail(message) {
  console.error(`dev-session FAILED: ${message}`);
  process.exit(1);
}

const URL_BASE = process.env.SUPABASE_URL ?? fromEnvFile('SUPABASE_URL');
const ANON = process.env.SUPABASE_ANON_KEY ?? fromEnvFile('SUPABASE_ANON_KEY');
/**
 * Which side of the product to sign in as.
 *
 *   node scripts/dev-session.mjs            provider (the default)
 *   node scripts/dev-session.mjs --member   member
 *
 * Two accounts rather than one because the trees are disjoint: `App.tsx` routes a
 * provider to ProviderHomeScreen and a member to the inbox, so a provider session
 * cannot reach the inbox, the directory or the chat screen, which is where most of
 * the redesign lives.
 *
 * The member is a purpose-made test account rather than a borrowed real one. Real
 * members signed in with Google, so minting a session for one means acting as a
 * person, and their rows are the only real conversation data the project has.
 */
const AS_MEMBER = process.argv.includes('--member');
const EMAIL = AS_MEMBER
  ? process.env.MEMBER_EMAIL ?? 'ada.member@chatapp.test'
  : process.env.PROVIDER_EMAIL ??
    fromEnvFile('PROVIDER_EMAIL') ??
    'ada.provider@chatapp.test';
if (!URL_BASE || !ANON) {
  fail(
    'SUPABASE_URL and SUPABASE_ANON_KEY are required (they default to .env)',
  );
}
if (!EMAIL) {
  fail('PROVIDER_EMAIL is required (set it in .env)');
}
/**
 * The storage key Supabase uses, derived rather than guessed.
 *
 * It is `sb-<project-ref>-auth-token`, where the ref is the subdomain. Deriving
 * it from SUPABASE_URL means pointing this at a different project cannot write a
 * session under the wrong key and leave the app looking signed out for no visible
 * reason.
 */
const ref = new URL(URL_BASE).hostname.split('.')[0];
const STORAGE_KEY = `sb-${ref}-auth-token`;

function adb(args, { input } = {}) {
  return execFileSync('adb', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Root first. Without it the app's data directory is unreadable and unwritable. */
try {
  adb(['root']);
} catch {
  // Already root, or a build that refuses. The write below will say which.
}
execFileSync('adb', ['wait-for-device'], { stdio: 'ignore' });

/**
 * The service role key, from the authenticated CLI rather than from a file.
 *
 * Not stored in the repo and never printed. `supabase projects api-keys` needs
 * the CLI's own login, so this tool cannot run for somebody who is not already
 * an owner of the project.
 */
function serviceRoleKey() {
  const raw = execFileSync(
    'npx',
    ['supabase', 'projects', 'api-keys', '--project-ref', ref],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const key = JSON.parse(raw).keys.find(k => k.id === 'service_role')?.api_key;
  if (typeof key !== 'string') {
    fail('could not read the service_role key. Is the Supabase CLI logged in?');
  }
  return key;
}

/**
 * Mint a session with the admin API, not the password grant.
 *
 * The password grant returns 422 "Email logins are disabled": the live project
 * has the email provider off, while `supabase/config.toml` declares it on. That
 * drift is worth fixing separately, and fixing it here is not an option, because
 * `supabase config push` sends the whole auth block and the Google OAuth secret
 * only exists as `env(SUPABASE_AUTH_GOOGLE_SECRET)`, which is not available
 * locally. Pushing without it blanks the secret, which is exactly how Google
 * sign-in went down on 2026-08-21.
 *
 * `admin/generate_link` plus `verify` sidesteps the provider flags entirely: the
 * first call is authorised by the service role and the second is the ordinary
 * token-hash exchange. Nothing about the project's configuration changes, and no
 * password is typed into anything.
 */
const SERVICE_ROLE = serviceRoleKey();

const link = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
});
let linkBody = await link.json();

/*
 * A missing account is created rather than reported. `generate_link` answers 422
 * for an address it does not know, and requiring somebody to go and make the test
 * member by hand defeats the point of a one-command tool.
 *
 * `email_confirm: true` because there is no inbox to click through, and the
 * account exists to be signed into rather than to receive anything.
 */
if (!link.ok || typeof linkBody.hashed_token !== 'string') {
  const created = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, email_confirm: true }),
  });
  if (!created.ok) {
    const detail = await created.json();
    fail(
      `could not create ${EMAIL} (${created.status}: ${
        detail.msg ?? 'no detail'
      })`,
    );
  }
  console.log(`  created ${EMAIL}`);
  const retry = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  linkBody = await retry.json();
  if (!retry.ok || typeof linkBody.hashed_token !== 'string') {
    fail(
      `generate_link still failed after creating ${EMAIL} (${retry.status})`,
    );
  }
}

const verify = await fetch(`${URL_BASE}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'magiclink',
    token_hash: linkBody.hashed_token,
  }),
});
const body = await verify.json();
if (!verify.ok || typeof body.access_token !== 'string') {
  fail(
    `verify returned ${verify.status} (${
      body.msg ?? body.error_description ?? 'no detail'
    })`,
  );
}

/**
 * The shape gotrue-js persists.
 *
 * Assembled rather than copied from a real device because there is no signed-in
 * device to copy from. Every field is one the client reads on boot: without
 * `expires_at` it treats the session as expired and refreshes silently, which
 * works, and therefore hides a wrong `access_token` behind a successful refresh
 * and makes a failure here look like a failure somewhere else.
 */
const session = {
  access_token: body.access_token,
  refresh_token: body.refresh_token,
  token_type: body.token_type ?? 'bearer',
  expires_in: body.expires_in,
  expires_at:
    body.expires_at ??
    Math.floor(Date.now() / 1000) + (body.expires_in ?? 3600),
  user: body.user,
};

/**
 * Where AsyncStorage actually lives, discovered rather than hardcoded.
 *
 * This cost a wasted round: the obvious answer is `RKStorage` with a table called
 * `catalystLocalStorage`, which is what every article says, and it is what the
 * library used before it moved to Room. This app's version writes a database
 * called `AsyncStorage` with a table called `Storage`. Writing to the old name
 * succeeds, reports one row, and the app never opens the file, so the failure
 * looks exactly like the session being rejected.
 *
 * So both are probed and the table is read out of `sqlite_master` instead of
 * being assumed. A library upgrade that renames either one will fail loudly here
 * rather than quietly writing to a file nothing reads.
 */
function shell(command) {
  return execFileSync('adb', ['shell', command], { encoding: 'utf8' }).trim();
}

function findStore() {
  const dir = `/data/data/${PACKAGE}/databases`;
  for (const db of ['AsyncStorage', 'RKStorage']) {
    const path = `${dir}/${db}`;
    let tables = '';
    try {
      tables = shell(
        `sqlite3 ${path} "select name from sqlite_master where type='table';"`,
      );
    } catch {
      continue;
    }
    for (const table of ['Storage', 'catalystLocalStorage']) {
      if (tables.split('\n').includes(table)) {
        return { path, table };
      }
    }
  }
  fail(
    'no AsyncStorage table found on the device. Launch the app once so it creates ' +
      'its database, then run this again.',
  );
}

const store = findStore();

const sql = [
  `DELETE FROM \`${store.table}\` WHERE \`key\` = '${STORAGE_KEY}';`,
  `INSERT INTO \`${
    store.table
  }\` (\`key\`, \`value\`) VALUES ('${STORAGE_KEY}', '${JSON.stringify(
    session,
  ).replace(/'/g, "''")}');`,
  // Fold the write-ahead log back into the database file. Without this the row
  // sits in -wal, and the app's own Room connection opens the main file first.
  'PRAGMA wal_checkpoint(TRUNCATE);',
  `SELECT count(*) FROM \`${store.table}\` WHERE \`key\` = '${STORAGE_KEY}';`,
].join('\n');

const scratch = join(tmpdir(), 'dev-session.sql');
writeFileSync(scratch, sql, { mode: 0o600 });

try {
  // Stopped first: writing under a live Room connection is how a -wal file and a
  // main file end up disagreeing.
  adb(['shell', `am force-stop ${PACKAGE}`]);
  adb(['push', scratch, '/data/local/tmp/dev-session.sql']);
  // Last line only: `PRAGMA wal_checkpoint` prints its own row above the count.
  const rows = adb([
    'shell',
    `sqlite3 ${store.path} < /data/local/tmp/dev-session.sql`,
  ])
    .trim()
    .split('\n')
    .pop()
    .trim();
  adb(['shell', 'rm', '-f', '/data/local/tmp/dev-session.sql']);
  // The app's own uid must own every file it is about to read.
  const uid = adb(['shell', `stat -c %u /data/data/${PACKAGE}`]).trim();
  adb(['shell', `chown -R ${uid}:${uid} /data/data/${PACKAGE}/databases`]);
  adb(['shell', `chmod 660 ${store.path}`]);

  /*
   * Delete the MMKV store so the migration runs again.
   *
   * `migrateLegacyStorage()` short-circuits on `mmkv.getBoolean('migrated.v1')`,
   * which any previous launch has already set. Without this the row above is
   * written correctly, sits in AsyncStorage forever, and the app never looks at
   * it: the symptom is a perfectly successful injection followed by a sign-in
   * screen, which reads as the session being rejected.
   *
   * This throws away local-only state with it: the theme choice, the last
   * conversation, the update-prompt timestamp. All of it is recomputable and this
   * only ever runs against an emulator, so that is the cheaper side of the trade
   * than hand-editing MMKV's binary format from outside.
   */
  adb([
    'shell',
    `rm -f /data/data/${PACKAGE}/files/mmkv/companionchat /data/data/${PACKAGE}/files/mmkv/companionchat.crc`,
  ]);
  if (rows !== '1') {
    fail(`wrote to ${store.path} but read back ${rows} rows, expected 1`);
  }
  console.log(
    `dev-session OK: ${STORAGE_KEY} -> ${store.path} (${store.table})`,
  );
  console.log(
    `  as ${EMAIL}. Restart the app twice: migrateLegacyStorage() does not`,
  );
  console.log(
    '  block the first frame, so the boot decision can beat it once.',
  );
} catch (error) {
  fail(
    `could not write to the device (${
      error.message.split('\n')[0]
    }). Is an emulator running and rooted?`,
  );
} finally {
  unlinkSync(scratch);
}
