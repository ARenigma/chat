#!/usr/bin/env node
/**
 * Stage 3 driver: the real-device critical user journeys.
 *
 * Maestro can drive the UI but it cannot cut the network, seed a wallet, or read
 * the database — and three of the five journeys need exactly that. So the flows
 * stay declarative and this script owns everything around them:
 *
 *   - stands up the local Supabase stack, so the cascade can be checked in SQL
 *     rather than inferred from the UI
 *   - points the Edge Function at scripts/openai-stub.mjs, so replies are exact
 *     and no device in the matrix bills real tokens
 *   - seeds the wallet straight into Postgres before the low-balance journey,
 *     instead of sending 48 throwaway messages
 *   - toggles the emulator's radios around the fault-injection journeys
 *   - asserts, after the deletion flow, that not one row survived
 *
 * Prerequisites (all present on the CI runner): supabase CLI, adb with a booted
 * device, maestro, docker. Run `npm run e2e` after `npm run android` has
 * installed a debug build, or pass --install to have this script build one.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_ID = 'com.companionchat';
const STUB_PORT = 8788;

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

const state = { stub: null, supabaseStarted: false };

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
  if (state.stub) {
    state.stub.kill('SIGTERM');
    state.stub = null;
  }
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
const status = tryRun('supabase', ['status'], { stdio: 'pipe' });
if (!status.ok) {
  run('supabase', ['start']);
  state.supabaseStarted = true;
}
run('supabase', ['db', 'reset', '--no-seed']); // Applies supabase/migrations in order.

const anonKey = (() => {
  const out = tryRun('supabase', ['status', '-o', 'env'], {
    stdio: 'pipe',
  }).out;
  const match = /ANON_KEY="?([^"\n]+)"?/.exec(out);
  if (!match) {
    fail('could not read the local anon key from `supabase status`');
  }
  return match[1];
})();

step('starting the deterministic OpenAI stub');
state.stub = spawn(process.execPath, [join(ROOT, 'scripts/openai-stub.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, STUB_PORT: String(STUB_PORT) },
});
spawnSync('sleep', ['1']);
if (!tryRun('curl', ['-sf', `http://127.0.0.1:${STUB_PORT}/healthz`]).ok) {
  fail('the OpenAI stub did not come up');
}

step('serving the Edge Function against the stub');
const functionsEnv = join(ROOT, 'supabase/.env.e2e');
writeFileSync(
  functionsEnv,
  [
    `OPENAI_BASE_URL=http://${HOST_FROM_EMULATOR}:${STUB_PORT}`,
    'OPENAI_API_KEY=stub-key-not-used',
    'OPENAI_MODEL=gpt-4o-mini',
    '',
  ].join('\n'),
);
const functions = spawn(
  'supabase',
  ['functions', 'serve', '--env-file', functionsEnv],
  {
    cwd: ROOT,
    stdio: 'inherit',
  },
);
spawnSync('sleep', ['6']);

// ---------------------------------------------------------------------------
// App under test
// ---------------------------------------------------------------------------
if (INSTALL) {
  step('building and installing a debug build against the local stack');
  writeFileSync(
    join(ROOT, '.env'),
    [
      `SUPABASE_URL=http://${HOST_FROM_EMULATOR}:${SUPABASE_LOCAL_PORT}`,
      `SUPABASE_ANON_KEY=${anonKey}`,
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

// ---------------------------------------------------------------------------
// Journeys. Each entry may prepare state before its flow runs.
// ---------------------------------------------------------------------------
const journeys = [
  { flow: '01-instant-launch.yaml' },
  { flow: '02-chat-stream.yaml' },
  {
    flow: '03-token-economy.yaml',
    before() {
      // Seed the wallet at the threshold rather than sending 48 messages.
      sql(
        'update public.profiles set token_balance = 3, last_refill_at = null',
      );
      console.log('   seeded every wallet to 3 tokens');
    },
  },
  {
    flow: '04-network-faults.yaml',
    before() {
      setRadios(false);
      console.log('   radios off: wifi and mobile data disabled');
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
        chats: Number(sql('select count(*) from public.chats')),
        messages: Number(sql('select count(*) from public.messages')),
      };
      // The flow starts a fresh anonymous session afterwards, so exactly one
      // profile with no chats and no messages is the correct end state.
      if (
        counts.profiles !== 1 ||
        counts.chats !== 0 ||
        counts.messages !== 0
      ) {
        fail(
          'deletion cascade incomplete: ' +
            `${counts.profiles} profile(s), ${counts.chats} chat(s), ${counts.messages} message(s)`,
        );
      }
      console.log(
        '   cascade verified in SQL: no chats, no messages, one fresh profile',
      );
    },
  },
].filter(j => (ONLY ? j.flow.includes(ONLY) : true));

let failedFlow = null;

for (const journey of journeys) {
  step(`journey ${journey.flow}`);
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

functions.kill('SIGTERM');
teardown();

if (failedFlow) {
  console.error(`\ne2e FAILED at ${failedFlow}`);
  process.exit(1);
}

console.log(
  `\ne2e OK — ${journeys.length} critical user journey(s) passed on ${APP_ID}`,
);
