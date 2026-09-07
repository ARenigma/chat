#!/usr/bin/env node
/**
 * Runs the real migrations against a real Postgres, then asserts the schema with
 * pgTAP.
 *
 * Two things are proven here that unit tests cannot:
 *   1. `public.deduct_user_token` behaves exactly like `applyDebit` in
 *      `src/lib/tokenLedger.ts`. The case table is generated from
 *      `supabase/tests/ledger_cases.json`, the same fixture the Jest test reads,
 *      so the two implementations cannot drift silently.
 *   2. Row Level Security actually isolates users, the wallet primitives are not
 *      client-callable, and account deletion really cascades.
 *
 * Output is TAP, parsed here so CI gets a per-assertion verdict rather than a
 * single pass/fail. `--tap` writes raw TAP to stdout for an external reporter.
 *
 * Two execution modes:
 *   - default: manages its own Postgres container. Needs Docker; tears everything
 *     down on exit, including on failure.
 *   - DATABASE_URL set: talks to a server somebody else provisioned, e.g. a
 *     GitLab `services:` container. Needs `psql` and a server with pgTAP
 *     available, and touches no containers at all.
 *
 * The second mode exists because a CI runner using the Docker executor cannot
 * nest Docker without privileged mode, and requiring that of a self-hosted
 * runner is a worse trade than requiring a service image.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONTAINER = 'companionchat-dbtest';
const IMAGE = 'companionchat/postgres-pgtap:16';
const GENERATED = join(ROOT, 'supabase/tests/000_ledger_parity.generated.sql');
const RAW_TAP = process.argv.includes('--tap');
/** When set, no container is created and psql runs against this server. */
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const MANAGED = DATABASE_URL === '';

const MIGRATIONS = [
  'supabase/tests/harness.sql',
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_bootstrap_and_grants.sql',
  'supabase/migrations/003_human_conversations.sql',
  'supabase/migrations/004_message_guard_and_directory.sql',
  'supabase/migrations/005_trust_and_safety.sql',
  'supabase/migrations/006_phone_auth_and_provider_onboarding.sql',
  'supabase/migrations/007_conversation_side.sql',
  'supabase/migrations/008_push_tokens.sql',
  'supabase/migrations/009_push_sender.sql',
  'supabase/migrations/010_phone_verification.sql',
  'supabase/migrations/011_reactions_replies_voice_calls.sql',
  'supabase/migrations/012_declared_presence_and_pii_guard.sql',
  'supabase/migrations/013_provider_avatars.sql',
  'supabase/migrations/014_message_attachments.sql',
  'supabase/migrations/015_push_avatar.sql',
  'supabase/migrations/016_engagement_nudges.sql',
  'supabase/migrations/017_call_push.sql',
  'supabase/migrations/018_firebase_phone_exchange.sql',
  'supabase/migrations/019_token_ledger_and_invoices.sql',
  'supabase/migrations/020_mock_recharge.sql',
  'supabase/migrations/021_chat_minute.sql',
  'supabase/migrations/022_chat_minute_drain.sql',
  'supabase/migrations/023_voice_peaks.sql',
  'supabase/migrations/024_send_message_return.sql',
  'supabase/migrations/025_voice_peaks_range.sql',
  'supabase/migrations/026_admin_config_and_policy.sql',
  'supabase/migrations/027_policy_versions_and_acceptance.sql',
  'supabase/migrations/028_balance_buckets_and_ledger.sql',
  'supabase/migrations/029_billing_snapshot_and_accrual.sql',
  'supabase/migrations/030_paid_sessions.sql',
  'supabase/migrations/031_purge_and_evidence.sql',
  'supabase/migrations/032_telemetry_event_extensions.sql',
  'supabase/migrations/033_credit_purchased_recharge.sql',
  'supabase/migrations/034_admin_schema_api_access.sql',
  'supabase/migrations/035_public_config_rpc.sql',
  'supabase/migrations/036_fix_provider_share_unit.sql',
  'supabase/migrations/037_session_cutover.sql',
  'supabase/migrations/038_provider_review_and_earnings.sql',
  'supabase/migrations/039_cashfree_telemetry_events.sql',
  'supabase/migrations/040_profile_setup_and_first_interaction.sql',
  'supabase/migrations/041_enable_payments_first_interaction.sql',
  'supabase/migrations/042_about_directory_and_perf_events.sql',
  'supabase/migrations/043_member_age_bracket.sql',
  'supabase/migrations/044_independent_call_controls.sql',
  'supabase/migrations/045_message_origin_and_hidden_retention.sql',
  'supabase/migrations/046_invoice_on_recharge.sql',
  'supabase/migrations/047_fix_public_policy_urls.sql',
  'supabase/migrations/048_provider_payout_accounts.sql',
  'supabase/migrations/049_pan_mandatory_for_payout.sql',
  'supabase/migrations/050_provider_payout_disbursement.sql',
  'supabase/migrations/051_provider_auto_onboarding.sql',
  'supabase/migrations/052_call_media_experiment.sql',
  'supabase/migrations/053_start_call_media_backend.sql',
  'supabase/migrations/054_identity_state.sql',
  'supabase/migrations/055_mirror_phone_to_profile.sql',
  'supabase/migrations/056_identity_dob_before_promotion.sql',
  'supabase/migrations/057_agora_default_backend.sql',
  'supabase/migrations/058_clear_pending_earnings.sql',
  'supabase/migrations/059_media_cogs_ledger.sql',
  'supabase/migrations/060_payout_transfer_settle.sql',
  'supabase/migrations/061_media_cogs_reconcile_tighten.sql',
  'supabase/migrations/062_session_seconds_remaining.sql',
  'supabase/migrations/063_profile_guard_covers_every_server_owned_column.sql',
  'supabase/migrations/064_provider_channels.sql',
  'supabase/migrations/065_provider_category.sql',
  'supabase/migrations/066_session_reviews_and_ratings.sql',
  'supabase/migrations/067_decline_session_request.sql',
  'supabase/migrations/068_chat_open_alerts.sql',
  'supabase/migrations/069_usage_ledger.sql',
  'supabase/migrations/070_provider_photos.sql',
  'supabase/migrations/071_config_readable_by_the_server.sql',
  'supabase/migrations/072_member_language_preferences.sql',
  'supabase/migrations/073_call_upgrade_from_chat.sql',
  'supabase/migrations/074_audio_to_video_upgrade.sql',
  'supabase/migrations/075_provider_languages_are_mandatory.sql',
];

const docker = (args, options = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', ...options });

function cleanup() {
  if (MANAGED) {
    try {
      docker(['rm', '-f', CONTAINER]);
    } catch {
      // Already gone.
    }
  }
  try {
    rmSync(GENERATED);
  } catch {
    // Never written.
  }
}

function quit(message) {
  console.error(`\ndb-test FAILED: ${message}`);
  cleanup();
  process.exit(1);
}

/** Turn the shared fixture into pgTAP assertions against the live function. */
function generateParitySql() {
  const fixture = JSON.parse(
    readFileSync(join(ROOT, 'supabase/tests/ledger_cases.json'), 'utf8'),
  );
  const uid = '99999999-9999-4999-8999-999999999999';
  const perCase = 2;

  const blocks = fixture.cases.flatMap(c => {
    const setup = `update public.profiles set token_balance = ${c.current} where id = '${uid}';`;
    const call = `public.deduct_user_token('${uid}', ${c.cost})`;
    return c.success
      ? [
          setup,
          `select is((${call} ->> 'success')::boolean, true, 'parity[${c.name}]: ${c.current} - ${c.cost} succeeds');`,
          `select is((select token_balance from public.profiles where id = '${uid}'), ${c.newBalance}, 'parity[${c.name}]: balance is ${c.newBalance}');`,
        ]
      : [
          setup,
          `select is(${call} ->> 'error', 'INSUFFICIENT_BALANCE', 'parity[${c.name}]: ${c.current} - ${c.cost} is rejected');`,
          `select is((select token_balance from public.profiles where id = '${uid}'), ${c.newBalance}, 'parity[${c.name}]: balance untouched on rejection');`,
        ];
  });

  const sql = [
    '-- GENERATED by scripts/db-test.mjs from supabase/tests/ledger_cases.json.',
    '-- Do not edit; edit the fixture. Asserts the SQL wallet agrees with',
    '-- applyDebit() in src/lib/tokenLedger.ts on every row.',
    '\\set ON_ERROR_STOP on',
    'begin;',
    `select plan(${fixture.cases.length * perCase});`,
    '',
    `insert into auth.users (id) values ('${uid}');`,
    '',
    ...blocks,
    '',
    'select * from finish();',
    'rollback;',
    '',
  ].join('\n');

  writeFileSync(GENERATED, sql);
  return fixture.cases.length;
}

function psql(file, { tap = false } = {}) {
  const sql = readFileSync(file, 'utf8');
  const common = ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'];
  const result = MANAGED
    ? spawnSync(
        'docker',
        [
          'exec',
          '-i',
          CONTAINER,
          'psql',
          ...common,
          '-U',
          'postgres',
          '-d',
          'postgres',
        ],
        { input: sql, encoding: 'utf8' },
      )
    : spawnSync('psql', [DATABASE_URL, ...common], {
        input: sql,
        encoding: 'utf8',
      });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (!tap && (result.status !== 0 || /^psql:.*ERROR/m.test(output))) {
    console.error(output);
    quit(`${file} did not apply`);
  }
  return output;
}

/** Minimal TAP consumer: enough for plan + ok/not ok, which is all pgTAP emits. */
function parseTap(output) {
  const lines = output.split('\n');
  const planned = Number(
    lines
      .find(l => /^1\.\.\d+$/.test(l.trim()))
      ?.trim()
      .slice(3) ?? 0,
  );
  const results = [];
  for (const line of lines) {
    const match = /^(not ok|ok)\s+(\d+)\s*-?\s*(.*)$/.exec(line.trim());
    if (match) {
      results.push({ pass: match[1] === 'ok', name: match[3] });
    }
  }
  const diagnostics = lines
    .filter(l => l.trimStart().startsWith('#'))
    .map(l => l.trim());
  return { planned, results, diagnostics };
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

// --- Boot -------------------------------------------------------------------
if (MANAGED) {
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    quit('Docker is not available. Start Docker Desktop, or set DATABASE_URL.');
  }

  cleanup();

  if (!RAW_TAP) {
    console.log(`db-test: building ${IMAGE} (cached after the first run)`);
  }
  docker([
    'build',
    '-q',
    '-t',
    IMAGE,
    '-f',
    join(ROOT, 'supabase/tests/Dockerfile'),
    join(ROOT, 'supabase/tests'),
  ]);

  docker([
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    IMAGE,
  ]);

  /**
   * Two-stage wait, because `pg_isready` alone is a lie on a fresh container.
   *
   * The postgres entrypoint starts a *temporary* server to run initdb and any
   * bootstrap scripts, then shuts it down and starts the real one. That
   * temporary server answers `pg_isready` on the same socket, so a single probe
   * can pass, and then the first real query lands in the gap between the two
   * and fails with "No such file or directory" on the socket. Seen twice on
   * this machine, a first-migration failure with no bad SQL behind it, which
   * is the worst kind of flake to debug.
   *
   * So: wait for the entrypoint to *say* it has finished initialising, and only
   * then wait for the socket.
   */
  let initialised = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' });
    if (/init process complete/.test(`${logs.stdout}${logs.stderr}`)) {
      initialised = true;
      break;
    }
    spawnSync('sleep', ['0.5']);
  }
  if (!initialised) {
    quit('Postgres never finished initialising');
  }

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = spawnSync(
      'docker',
      ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'],
      {
        encoding: 'utf8',
      },
    );
    if (probe.status === 0) {
      ready = true;
      break;
    }
    spawnSync('sleep', ['0.5']);
  }
  if (!ready) {
    quit('Postgres never became ready');
  }
} else {
  if (!RAW_TAP) {
    console.log(
      'db-test: using the server in DATABASE_URL (no container managed)',
    );
  }
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = spawnSync('psql', [DATABASE_URL, '-c', 'select 1'], {
      encoding: 'utf8',
    });
    if (probe.status === 0) {
      ready = true;
      break;
    }
    spawnSync('sleep', ['0.5']);
  }
  if (!ready) {
    quit('could not reach the server in DATABASE_URL');
  }
}

// --- Migrate ----------------------------------------------------------------
for (const relative of MIGRATIONS) {
  if (!RAW_TAP) {
    console.log(`db-test: applying ${relative}`);
  }
  psql(join(ROOT, relative));
}

// The grants Supabase applies by default; deferred until the tables exist.
writeFileSync(
  join(ROOT, 'supabase/tests/.grants.tmp.sql'),
  'select test.apply_supabase_grants();\n',
);
psql(join(ROOT, 'supabase/tests/.grants.tmp.sql'));
rmSync(join(ROOT, 'supabase/tests/.grants.tmp.sql'));

// --- Assert -----------------------------------------------------------------
const caseCount = generateParitySql();
const suites = [
  {
    file: GENERATED,
    label: `ledger parity (${caseCount} cases from ledger_cases.json)`,
  },
  {
    file: join(ROOT, 'supabase/tests/010_wallet_and_grants.sql'),
    label: 'wallet, grants, deletion cascade',
  },
  {
    file: join(ROOT, 'supabase/tests/020_conversations_and_roles.sql'),
    label: 'roles, admission, two-party conversations',
  },
  {
    file: join(ROOT, 'supabase/tests/030_message_guard_and_directory.sql'),
    label: 'message immutability, directory boundary',
  },
  {
    file: join(ROOT, 'supabase/tests/040_trust_and_safety.sql'),
    label: 'blocking, reporting, suspension, rate limits, telemetry',
  },
  {
    file: join(ROOT, 'supabase/tests/050_onboarding_and_reputation.sql'),
    label: 'age gate, onboarding transitions, reputation, silence refunds',
  },
  {
    file: join(ROOT, 'supabase/tests/060_conversation_side.sql'),
    label: 'per-conversation membership survives a role change',
  },
  {
    file: join(ROOT, 'supabase/tests/070_push_tokens.sql'),
    label: 'push tokens: registration, reassignment, sender isolation',
  },
  {
    file: join(ROOT, 'supabase/tests/080_phone_verification.sql'),
    label: 'phone verification: a claim only the server can make',
  },
  {
    file: join(ROOT, 'supabase/tests/090_reactions_replies_voice_presence.sql'),
    label: 'reactions, replies, voice notes, presence, member pseudonymity',
  },
  {
    file: join(ROOT, 'supabase/tests/100_calls_and_metering.sql'),
    label: 'calls: blocking parity, server-authoritative per-minute metering',
  },
  {
    file: join(ROOT, 'supabase/tests/110_declared_presence_and_pii_guard.sql'),
    label: 'declared presence, and PII no client can write',
  },
  {
    file: join(ROOT, 'supabase/tests/120_token_ledger.sql'),
    label: 'token ledger, invoice counters, and GST invoices',
  },
  {
    file: join(ROOT, 'supabase/tests/130_mock_recharge.sql'),
    label: 'mock recharge: app_flags, function grant, and MOCK_DISABLED gate',
  },
  {
    file: join(ROOT, 'supabase/tests/140_chat_minute.sql'),
    label: 'spend_chat_minute: grant, shape, and balance gate',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/150_public_config_and_report_taxonomy.sql',
    ),
    label: 'public config and report taxonomy',
  },
  {
    file: join(ROOT, 'supabase/tests/160_session_cutover.sql'),
    label: 'paid-session client/server cutover',
  },
  {
    file: join(ROOT, 'supabase/tests/170_provider_review_and_earnings.sql'),
    label: 'provider review claim and session-era earnings view',
  },
  {
    file: join(ROOT, 'supabase/tests/180_profile_setup.sql'),
    label: 'profile setup username RPCs and conversation openers',
  },
  {
    file: join(ROOT, 'supabase/tests/190_openers_and_hidden_retention.sql'),
    label: 'sequential openers, live origin, hidden 30-day retention, purge',
  },
  {
    file: join(ROOT, 'supabase/tests/200_call_media_experiment.sql'),
    label: 'server call-media assignment and restricted QoE evidence',
  },
  {
    file: join(ROOT, 'supabase/tests/210_earnings_clear_and_media_cogs.sql'),
    label: 'earnings clear job and Agora COGS / margin ledger',
  },
  {
    file: join(ROOT, 'supabase/tests/220_payout_settle_and_inr_sync.sql'),
    label: 'payout transfer settle and INR call sync assert',
  },
  {
    file: join(ROOT, 'supabase/tests/230_media_cogs_reconcile_tighten.sql'),
    label: 'media COGS dual-source reconcile, invoice, alerts',
  },
  {
    file: join(ROOT, 'supabase/tests/240_session_seconds_remaining.sql'),
    label:
      'session seconds_remaining: one snapshot, member only, cron-lag invariant',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/250_profile_guard_server_owned_columns.sql',
    ),
    label:
      'profiles guard: wallet buckets, reputation, suspension are not client-writable',
  },
  {
    file: join(ROOT, 'supabase/tests/260_provider_channels.sql'),
    label:
      'per-provider channels: the floor, and one choke point every path hits',
  },
  {
    file: join(ROOT, 'supabase/tests/270_provider_category.sql'),
    label: 'provider category: listener default, set once at onboarding',
  },
  {
    file: join(ROOT, 'supabase/tests/280_session_reviews_and_ratings.sql'),
    label: 'session reviews: one per session, all count, and the ratings read',
  },
  {
    file: join(ROOT, 'supabase/tests/290_decline_session_request.sql'),
    label: 'declining a session request: recipient only, idempotent',
  },
  {
    file: join(ROOT, 'supabase/tests/300_chat_open_alerts.sql'),
    label: 'chat-open alerts: both ways, and only when it could matter',
  },
  {
    file: join(ROOT, 'supabase/tests/310_usage_ledger.sql'),
    label: "usage ledger: one row, two sides, neither sees the other's figure",
  },
  {
    file: join(ROOT, 'supabase/tests/320_provider_photos.sql'),
    label:
      'provider photos: own rows only, one primary, and avatar_url follows it',
  },
  {
    file: join(ROOT, 'supabase/tests/330_member_language_preferences.sql'),
    label:
      'language preference: the owner writes it, nobody else reads it, and the 063 guard still bites',
  },
  {
    file: join(ROOT, 'supabase/tests/331_provider_languages_are_mandatory.sql'),
    label:
      'provider languages: a direct PATCH cannot empty them, but an edit still can change them',
  },
];

let passed = 0;
const failures = [];

for (const suite of suites) {
  const output = psql(suite.file, { tap: true });
  if (RAW_TAP) {
    process.stdout.write(output);
    continue;
  }

  const { planned, results, diagnostics } = parseTap(output);
  if (results.length === 0) {
    console.error(output);
    quit(`${suite.label}: no TAP output, the suite did not run`);
  }
  if (planned !== results.length) {
    failures.push(
      `${suite.label}: planned ${planned} assertions, ran ${results.length}`,
    );
  }

  console.log(`\ndb-test: ${suite.label}`);
  for (const result of results) {
    if (result.pass) {
      passed += 1;
      console.log(`  ok    ${result.name}`);
    } else {
      failures.push(`${suite.label}: ${result.name}`);
      console.log(`  FAIL  ${result.name}`);
    }
  }
  for (const line of diagnostics) {
    if (/^#\s*(Looks like|Failed)/.test(line)) {
      console.log(`  ${line}`);
    }
  }
}

cleanup();

if (RAW_TAP) {
  process.exit(0);
}

if (failures.length > 0) {
  console.error('\ndb-test FAILED');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`\ndb-test OK, ${passed} pgTAP assertions passed`);
