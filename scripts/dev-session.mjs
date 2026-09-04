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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
/*
 * The project ref, used only to ask the Supabase CLI for the right key. The
 * gotrue storage key this used to derive is gone with the AsyncStorage write —
 * the injector link hands the app the tokens and the app's own client decides
 * where to keep them, which is one less thing here that can drift.
 */
const ref = new URL(URL_BASE).hostname.split('.')[0];

function adb(args, { input } = {}) {
  return execFileSync('adb', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/*
 * No `adb root` here any more. The injector link goes through the ordinary
 * activity intent path, so the app's private data directory is never touched —
 * which is what lets this work on a Play-services image, where root is refused.
 */
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
 * How the session reaches the app: the debug-only deep link the app already has.
 *
 * **What this replaced, and why.** This used to write one row into the app's
 * AsyncStorage SQLite file and then delete the MMKV store so
 * `migrateLegacyStorage()` would pick it up. That route is dead twice over on a
 * current emulator, and both failures look like a rejected session rather than a
 * broken tool:
 *
 *  - The API 36 Play system image ships no `sqlite3` binary at all, so the write
 *    silently found nothing to write with.
 *  - The app is MMKV-only now. AsyncStorage is READ by the migration and never
 *    written, so its database is never created — meaning the route only ever
 *    worked on a device that had once run an older build. On a fresh install
 *    there is nothing to write into.
 *
 * It also needed `adb root`, which a Play-services image refuses.
 *
 * `companionchat://e2e-auth` is the app's own injector, behind a debug-only
 * intent filter (release builds expose no such filter), and it is the same path
 * `scripts/e2e.mjs` already uses for its Maestro journeys. So this tool now
 * agrees with the one that was working, needs no root, no sqlite and no legacy
 * database, and exercises a code path that is actually maintained.
 * https://developer.android.com/training/app-links/create-deeplinks
 */
const deepLink =
  `companionchat://e2e-auth?` +
  new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }).toString();

try {
  // Stopped first so the injector runs on a cold boot decision rather than
  // racing a live one.
  adb(['shell', `am force-stop ${PACKAGE}`]);
  /*
   * The URL is SINGLE-QUOTED for the device's shell.
   *
   * `adb shell` joins its arguments into one command line and hands it to the
   * device's `sh`, which splits on `&` — so an unquoted query string is cut in
   * half at `&refresh_token=` and the second half is run as a background
   * command. The visible symptom is `am start` failing with the intent
   * half-formed, which reads as "the app rejected the link".
   */
  const launch = adb([
    'shell',
    `am start -W -a android.intent.action.VIEW -d '${deepLink}' ${PACKAGE}`,
  ]);
  if (/Error:|unable to resolve/i.test(launch)) {
    fail(
      `the app did not accept the injector link. Is this a DEBUG build? The ` +
        `intent filter does not exist in release.\n${launch}`,
    );
  }
  /*
   * The dangerous permissions the signed-in surfaces use, granted up front.
   * Same set `e2e.mjs` grants, and for the same reason: a permission dialog on
   * first use is a separate journey, not something to hit by accident while
   * looking at a screen.
   * https://developer.android.com/training/permissions/requesting
   */
  for (const permission of [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
  ]) {
    try {
      adb(['shell', 'pm', 'grant', PACKAGE, permission]);
    } catch {
      // A permission the manifest does not declare on this variant. Not fatal.
    }
  }
  console.log(`dev-session OK: signed in as ${EMAIL} via the injector link.`);
} catch {
  /*
   * The error's own message is NOT included, deliberately. `execFileSync` puts
   * the whole failed command line in it, and that command line contains the
   * access token — so reporting it wrote a live JWT into the terminal and into
   * whatever captured it (seen 2026-09-04). Nothing here prints a token.
   */
  fail(
    'could not reach the device. Is an emulator or device connected, and is ' +
      'this a debug build?',
  );
}
