#!/usr/bin/env node
/**
 * Stage 3 driver: the real-device critical user journeys.
 *
 * Maestro can drive the UI but it cannot cut the network, seed a wallet, or read
 * the database, and three of the five journeys need exactly that. So the flows
 * stay declarative and this script owns everything around them:
 *
 *   - stands up the local Supabase stack, so the cascade can be checked in SQL
 *     rather than inferred from the UI
 *   - seeds an admitted provider, because the directory is a server query now
 *     and admission is deliberately service-role only
 *   - seeds the wallet straight into Postgres before the low-balance journey,
 *     instead of sending 48 throwaway messages
 *   - toggles the emulator's radios around the fault-injection journeys
 *   - sets font_scale=2.0 and wm size 1280x800 for the coverage journeys
 *   - asserts, after the deletion flow, that not one row survived
 *
 * Prerequisites (all present on the CI runner): supabase CLI, adb with a booted
 * device, maestro, docker. Run `npm run e2e` after `npm run android` has
 * installed a debug build, or pass --install to have this script build one.
 * Target an API 24 AVD the same way: boot that emulator, then run this script.
 * The flows are API-agnostic; minSdk 24 is the claimed floor.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_ID = 'com.companionchat';

// The loopback alias an Android emulator uses to reach its host.
const HOST_FROM_EMULATOR = '10.0.2.2';
const SUPABASE_LOCAL_PORT = 54321;
const SUPABASE_DB_PORT = 54322;

const args = new Set(process.argv.slice(2));
const KEEP = args.has('--keep');
const INSTALL = args.has('--install');
const ONLY = [...args]
  .find(a => a.startsWith('--only='))
  ?.slice('--only='.length);

const state = {
  supabaseStarted: false,
  memberSession: null,
  memberSessionInstalled: false,
};

function run(cmd, argv, options = {}) {
  return execFileSync(cmd, argv, {
    encoding: 'utf8',
    cwd: ROOT,
    stdio: options.quiet ? 'pipe' : 'inherit',
    ...options,
  });
}

function tryRun(cmd, argv, options = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', cwd: ROOT, ...options });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function step(message) {
  console.log(`\n── ${message}`);
}

function fail(message) {
  console.error(`\ne2e FAILED: ${message}`);
  teardown();
  process.exit(1);
}

function need(binary, hint) {
  if (!tryRun('which', [binary]).ok) {
    fail(`\`${binary}\` is not on PATH. ${hint}`);
  }
}

/** psql against the local Supabase database, which is where the proof lives. */
function sql(query) {
  const r = tryRun('psql', [
    `postgresql://postgres:postgres@127.0.0.1:${SUPABASE_DB_PORT}/postgres`,
    '-t',
    '-A',
    '-c',
    query,
  ]);
  if (!r.ok) {
    fail(`psql failed for: ${query}\n${r.out}`);
  }
  return r.out.trim();
}

function adb(argv) {
  return tryRun('adb', argv).out;
}

function setRadios(enabled) {
  const verb = enabled ? 'enable' : 'disable';
  adb(['shell', 'svc', 'wifi', verb]);
  adb(['shell', 'svc', 'data', verb]);
  // Give the connectivity change time to propagate to the app process.
  spawnSync('sleep', ['4']);
}

function teardown() {
  setRadios(true);
  if (state.supabaseStarted && !KEEP) {
    tryRun('supabase', ['stop', '--no-backup']);
  }
}

process.on('SIGINT', () => {
  teardown();
  process.exit(130);
});

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------
need('adb', 'Install Android platform-tools.');
need('maestro', 'curl -Ls https://get.maestro.mobile.dev | bash');
need('supabase', 'brew install supabase/tap/supabase');
need('psql', 'Needed to assert the deletion cascade in SQL.');

const devices = adb(['devices'])
  .split('\n')
  .slice(1)
  .filter(l => /\tdevice$/.test(l));
if (devices.length === 0) {
  fail('no booted device or emulator. Start one and re-run.');
}
console.log(`e2e: driving ${devices.length} device(s)`);

// ---------------------------------------------------------------------------
// Backend: local stack + deterministic upstream
// ---------------------------------------------------------------------------
step('starting the local Supabase stack');
// Current Supabase CLI validates enabled hook secrets even though these journeys
// never exercise SMS. Supply a deterministic local-only signing value when the
// production secret is intentionally absent from the developer shell.
process.env.SEND_SMS_HOOK_SECRET ??= `v1,whsec_${Buffer.from(
  'pappal-local-e2e-hook-secret-0001',
).toString('base64')}`;
const status = tryRun('supabase', ['status'], { stdio: 'pipe' });
if (!status.ok) {
  // These journeys need Postgres, Auth, PostgREST, Realtime, and Kong only.
  // Excluding unrelated services avoids pulling Studio/observability/storage
  // images and keeps local startup materially smaller and faster.
  run('supabase', [
    'start',
    '--exclude',
    'storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
  ]);
  state.supabaseStarted = true;
}
run('supabase', ['db', 'reset', '--no-seed']); // Applies supabase/migrations in order.

const localKeys = (() => {
  const out = tryRun('supabase', ['status', '-o', 'env'], {
    stdio: 'pipe',
  }).out;
  const anon = /ANON_KEY="?([^"\n]+)"?/.exec(out)?.[1];
  const serviceRole = /SERVICE_ROLE_KEY="?([^"\n]+)"?/.exec(out)?.[1];
  if (!anon || !serviceRole) {
    fail('could not read the local API keys from `supabase status`');
  }
  return { anon, serviceRole };
})();
const localUrl = `http://127.0.0.1:${SUPABASE_LOCAL_PORT}`;
const admin = createClient(localUrl, localKeys.serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A provider is not something a client can create: `approve_provider_application`
// is service-role only by design (ADR-0002), so the fixture is applied in SQL.
// The uuid is fixed so a failed run leaves a diagnosable database.
step('seeding an admitted provider');
const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
sql(
  `insert into auth.users (id) values ('${PROVIDER_ID}') on conflict do nothing`,
);
// `presence` alongside `is_available` since 012 split them: the flow checks a
// directory row, and without a declared presence the row renders no dot.
sql(
  `update public.profiles set display_name = 'Ada', is_available = true,
     presence = 'here', presence_visible = true where id = '${PROVIDER_ID}'`,
);
// Migration 006 made admission conditional on a complete application and a
// verifiable adult date of birth, so the fixture supplies both.
sql(
  `insert into public.provider_applications
     (user_id, status, display_name, gender, date_of_birth, headline, languages, about)
   values ('${PROVIDER_ID}', 'submitted', 'Ada', 'female',
           (current_date - interval '26 years')::date,
           'I listen more than I talk', ARRAY['English','Hindi'],
           'I have spent years sitting with friends through the hour after the news lands. I do not tidy your story. I stay with it until it has room to breathe.')
   on conflict (user_id) do nothing`,
);
sql(`select public.approve_provider_application('${PROVIDER_ID}')`);
if (sql('select count(*) from public.provider_directory') !== '1') {
  fail('the provider fixture is not visible in provider_directory');
}
console.log('   provider "Ada" admitted and discoverable');

// A member session, injected rather than earned.
//
// Google Credential Manager and Firebase's system-owned OTP flow cannot be made
// deterministic by Maestro without testing provider UI rather than our app. The
// member is therefore created with the local admin API and journeys after 01 use
// a real injected Supabase session. Journey 01 still asserts that both supported
// entry points are present.
step('seeding a member session');
const MEMBER_EMAIL = 'maestro-member@pappal.test';
const { data: createdMember, error: memberError } =
  await admin.auth.admin.createUser({
    email: MEMBER_EMAIL,
    email_confirm: true,
  });
if (memberError || !createdMember.user) {
  fail(
    `could not create member fixture: ${
      memberError?.message ?? 'missing user'
    }`,
  );
}
const MEMBER_ID = createdMember.user.id;
const { data: memberLink, error: linkError } =
  await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: MEMBER_EMAIL,
  });
if (linkError || !memberLink.properties?.hashed_token) {
  fail(
    `could not mint member fixture session: ${
      linkError?.message ?? 'missing token hash'
    }`,
  );
}
const anonymousClient = createClient(localUrl, localKeys.anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: verifiedMember, error: verifyError } =
  await anonymousClient.auth.verifyOtp({
    token_hash: memberLink.properties.hashed_token,
    type: 'email',
  });
if (verifyError || !verifiedMember.session) {
  fail(
    `could not verify member fixture session: ${
      verifyError?.message ?? 'missing session'
    }`,
  );
}
state.memberSession = verifiedMember.session;
sql(`update public.profiles set promo_balance = 50 where id = '${MEMBER_ID}'`);
sql(
  `insert into public.policy_acceptances (user_id, policy_kind, version_id)
   select '${MEMBER_ID}', current_policy.kind, current_policy.id
   from (
     select distinct on (kind) id, kind
     from public.policy_versions
     where effective_at <= now()
     order by kind, version desc
   ) current_policy
   on conflict do nothing`,
);
console.log('   member seeded with current policy acceptance');

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------
if (INSTALL) {
  step('building and installing a debug build against the local stack');
  writeFileSync(
    join(ROOT, '.env'),
    [
      `SUPABASE_URL=http://${HOST_FROM_EMULATOR}:${SUPABASE_LOCAL_PORT}`,
      `SUPABASE_ANON_KEY=${localKeys.anon}`,
      'SENTRY_DSN=',
      'APP_ENV=e2e',
      '',
    ].join('\n'),
  );
  run('./gradlew', ['installDebug', '--no-daemon'], {
    cwd: join(ROOT, 'android'),
  });
}

const shots = join(ROOT, 'artifacts');
if (!existsSync(shots)) {
  mkdirSync(shots, { recursive: true });
}

function installMemberSession() {
  if (!state.memberSession) {
    fail('member fixture session was not prepared');
  }
  const deepLink =
    'companionchat://e2e-auth?' +
    new URLSearchParams({
      access_token: state.memberSession.access_token,
      refresh_token: state.memberSession.refresh_token,
    }).toString();

  // Android's supported boundary for routing URI data into an activity. The
  // matching intent filter is debug-only, so release builds expose no injector.
  // https://developer.android.com/training/app-links/create-deeplinks
  const launch = adb([
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    deepLink,
    APP_ID,
  ]);
  if (/Error:|unable to resolve/i.test(launch)) {
    fail(`could not inject the member session:\n${launch}`);
  }

  // Permission prompts are covered separately. Stable signed-in journeys grant
  // only the dangerous permissions used by messaging and calls.
  // https://developer.android.com/training/permissions/requesting
  for (const permission of [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
  ]) {
    adb(['shell', 'pm', 'grant', APP_ID, permission]);
  }
  spawnSync('sleep', ['2']);
  state.memberSessionInstalled = true;
  console.log('   member session installed; test permissions granted');
}

// ---------------------------------------------------------------------------
// Journeys. Each entry may prepare state before its flow runs.
// ---------------------------------------------------------------------------
const journeys = [
  { flow: '01-instant-launch.yaml' },
  { flow: '02-send-and-persist.yaml' },
  {
    flow: '03-token-economy.yaml',
    before() {
      // Low balance is now a display/recharge state. Message sends are charged
      // only by accepted paid sessions (ADR-0020), never one token per message.
      sql(
        'update public.profiles set token_balance = 3, last_refill_at = null',
      );
      console.log('   seeded every wallet to 3 tokens');
    },
  },
  {
    flow: '04-network-faults.yaml',
    before() {
      state.balanceBeforeOffline = sql(
        "select coalesce(sum(token_balance), -1) from public.profiles where role = 'member'",
      );
      setRadios(false);
      console.log(
        `   radios off; member balance is ${state.balanceBeforeOffline}`,
      );
    },
    after() {
      // An unreachable server cannot mutate the authoritative paid-session
      // ledger, so this is an equality check rather than a refund check.
      setRadios(true);
      const after = sql(
        "select coalesce(sum(token_balance), -1) from public.profiles where role = 'member'",
      );
      if (after !== state.balanceBeforeOffline) {
        fail(
          `an offline send moved the wallet: ${state.balanceBeforeOffline} -> ${after}`,
        );
      }
      console.log('   verified in SQL: no token was spent while offline');
    },
  },
  {
    flow: '05-offline-resume.yaml',
    before() {
      setRadios(true);
      console.log('   radios back on');
    },
  },
  {
    flow: '06-account-deletion.yaml',
    before() {
      const users = sql('select count(*) from auth.users');
      const messages = sql('select count(*) from public.messages');
      if (Number(users) === 0 || Number(messages) === 0) {
        fail(`nothing to delete: ${users} user(s), ${messages} message(s)`);
      }
      console.log(
        `   before deletion: ${users} user(s), ${messages} message(s)`,
      );
    },
    after() {
      // The GDPR claim is a SQL claim. Assert it in SQL.
      const counts = {
        profiles: Number(sql('select count(*) from public.profiles')),
        conversations: Number(sql('select count(*) from public.conversations')),
        messages: Number(sql('select count(*) from public.messages')),
      };
      // Anonymous sign-in is disabled. The seeded provider is not the member
      // being deleted, so only that provider profile remains.
      if (
        counts.profiles !== 1 ||
        counts.conversations !== 0 ||
        counts.messages !== 0
      ) {
        fail(
          'deletion cascade incomplete: ' +
            `${counts.profiles} profile(s), ${counts.conversations} conversation(s), ` +
            `${counts.messages} message(s)`,
        );
      }
      console.log(
        '   cascade verified in SQL: no conversations, no messages, provider intact',
      );
    },
  },
  {
    flow: '07-font-scale.yaml',
    before() {
      // 200% is the published Android accessibility large-text target.
      adb(['shell', 'settings', 'put', 'system', 'font_scale', '2.0']);
      console.log('   font_scale=2.0');
    },
    after() {
      adb(['shell', 'settings', 'put', 'system', 'font_scale', '1.0']);
    },
  },
  {
    flow: '08-large-screen.yaml',
    before() {
      // 1280x800 dp at mdpi is an expanded window (≥840dp width).
      adb(['shell', 'wm', 'size', '1280x800']);
      console.log('   wm size 1280x800 (expanded width class)');
    },
    after() {
      adb(['shell', 'wm', 'size', 'reset']);
    },
  },
].filter(j => (ONLY ? j.flow.includes(ONLY) : true));

let failedFlow = null;

for (const journey of journeys) {
  step(`journey ${journey.flow}`);
  if (
    journey.flow !== '01-instant-launch.yaml' &&
    !state.memberSessionInstalled
  ) {
    installMemberSession();
  }
  journey.before?.();

  const result = spawnSync(
    'maestro',
    [
      'test',
      join(ROOT, '.maestro', journey.flow),
      '--format',
      'junit',
      '--output',
      join(shots, `${journey.flow.replace('.yaml', '')}.xml`),
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    adb(['logcat', '-d', '-t', '400']); // Surfaced in CI logs for triage.
    failedFlow = journey.flow;
    break;
  }
  journey.after?.();
}

teardown();

if (failedFlow) {
  console.error(`\ne2e FAILED at ${failedFlow}`);
  process.exit(1);
}

console.log(
  `\ne2e OK, ${journeys.length} critical user journey(s) passed on ${APP_ID}`,
);
