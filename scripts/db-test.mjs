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
  'supabase/migrations/076_handoff_and_member_consent.sql',
  'supabase/migrations/077_sp_initiate_member_consent.sql',
  'supabase/migrations/078_decline_status_cast.sql',
  'supabase/migrations/079_start_call_status_cast.sql',
  'supabase/migrations/080_client_support_floor.sql',
  'supabase/migrations/081_message_idempotency.sql',
  'supabase/migrations/082_decline_means_no_session.sql',
  'supabase/migrations/083_provider_expertise.sql',
  'supabase/migrations/084_seed_provider_expertise.sql',
  'supabase/migrations/086_only_the_member_starts_a_paid_chat.sql',
  'supabase/migrations/088_unanswered_message_refund_is_pre_cutover.sql',
  'supabase/migrations/089_repair_call_media_assignment_kind_check.sql',
  'supabase/migrations/090_expire_stale_session_requests.sql',
  'supabase/migrations/091_upgraded_to_call_is_an_end_reason.sql',
  'supabase/migrations/092_messages_push_immediately.sql',
  'supabase/migrations/093_repair_storage_purge_functions.sql',
  'supabase/migrations/094_storage_purge_uses_allow_delete_guc.sql',
  'supabase/migrations/095_session_duration_equals_billed_minutes.sql',
  'supabase/migrations/096_block_requires_prior_conversation.sql',
  'supabase/migrations/097_recharge_helpers_credit_the_bucket.sql',
  'supabase/migrations/098_conversation_labels.sql',
  'supabase/migrations/099_chat_session_survives_a_ringing_call.sql',
  'supabase/migrations/100_account_deletion_cascades.sql',
  'supabase/migrations/101_account_deletion_keeps_the_invoice.sql',
  'supabase/migrations/102_first_recharge_discount.sql',
  'supabase/migrations/103_edit_and_delete_messages.sql',
  'supabase/migrations/104_provider_photo_management.sql',
  'supabase/migrations/105_provider_initiated_contact.sql',
  'supabase/migrations/106_clean_public_policy_urls.sql',
  'supabase/migrations/107_end_session_flushes_owed_minutes.sql',
  'supabase/migrations/108_telemetry_call_and_perf_events.sql',
  'supabase/migrations/109_call_rate_limit_is_configurable.sql',
  'supabase/migrations/110_a_message_push_names_the_member_who_sent_it.sql',
  'supabase/migrations/111_open_alerts_read_availability_not_presence.sql',
  'supabase/migrations/112_a_provider_face_is_a_photograph.sql',
  'supabase/migrations/113_the_test_providers_have_a_gender_so_they_can_have_a_face.sql',
  'supabase/migrations/114_founder_allowlist_is_case_insensitive.sql',
  'supabase/migrations/115_call_heartbeats_are_activity.sql',
  'supabase/migrations/116_messages_session_id_is_not_client_writable.sql',
  'supabase/migrations/117_mock_recharge_is_rate_limited.sql',
  'supabase/migrations/118_session_leases_require_a_real_participant.sql',
  'supabase/migrations/119_call_quality_records_loss_rate_and_mos.sql',
  'supabase/migrations/120_start_call_detects_a_simultaneous_ring.sql',
  'supabase/migrations/121_disable_scheduled_engagement_nudges.sql',
  'supabase/migrations/122_avatar_repair_and_member_backfill.sql',
  'supabase/migrations/123_in_place_media_upgrade.sql',
  'supabase/migrations/124_usage_ledger_elapsed_seconds.sql',
  'supabase/migrations/125_server_favorites.sql',
  'supabase/migrations/126_idle_home_suggestions.sql',
  'supabase/migrations/127_truecaller_phone_identity.sql',
  'supabase/migrations/128_truecaller_identity_rls.sql',
  'supabase/migrations/129_truecaller_challenge_resume.sql',
  'supabase/migrations/130_canonical_phone_owner.sql',
  'supabase/migrations/131_truecaller_recheck_phone_owner.sql',
  'supabase/migrations/132_video_switch_bills_only_the_difference.sql',
  'supabase/migrations/133_profiles_are_not_client_insertable_or_deletable.sql',
  'supabase/migrations/134_video_switch_pending_session_and_quote.sql',
  'supabase/migrations/135_video_switch_pending_session_checks_balance.sql',
  'supabase/migrations/136_switched_call_falls_back_to_voice_at_start.sql',
  'supabase/migrations/137_video_switch_acceptance_respects_kill_switch.sql',
];

/**
 * Migrations that insert FIXTURE ROWS rather than change the schema, and are
 * therefore applied by `supabase db push` but NOT by this harness.
 *
 * 085 seeds six astrologer profiles so the Astrologers tab is not empty. Adding
 * it to the list above broke four unrelated suites at once, and the reason is
 * worth stating: every pgTAP file here starts from an empty database and
 * asserts absolute counts — `010` checks `count(*) from profiles` is 2 after
 * inserting two users. A migration that ships six people makes that 8, and the
 * failure looks like a bug in the wallet.
 *
 * The distinction is real and not a dodge. 084 IS in the list, because it is a
 * backfill over whatever rows exist — a no-op on an empty database — and suite
 * 370 replays its statement against its own fixtures to test it. 085 is data.
 * Schema migrations belong in a schema harness; fixtures do not.
 *
 * `contract.test.ts` knows about this list by name, so a new migration still
 * cannot be forgotten — it has to be put in one list or the other, on purpose.
 */
export const SEED_MIGRATIONS = [
  'supabase/migrations/085_seed_astrologers.sql',
  'supabase/migrations/087_seed_astrologer_photos.sql',
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

/**
 * The schema-equivalence check, and the one test in this file that is not pgTAP.
 *
 * Lifted from the reference app, whose single most valuable hand-written test is not a
 * behaviour test at all: `TestDatabaseMigration` builds its SQLite schema TWICE
 * — once fresh via createTables() and once by replaying every migration from
 * v120 — and asserts the two are identical
 * (TMessagesProj_AppTests/.../TestDatabaseMigration.kt:12-27). 682 lines, and it
 * catches the class of bug where "what a new environment gets" and "what a
 * migrated environment gets" have quietly diverged.
 *
 * Ours is the same idea against a committed snapshot: apply all migrations to a
 * fresh Postgres, render the schema as sorted text, and diff it against
 * `supabase/schema/snapshot.txt`. The value is not the pass — it is that any
 * migration which changes the schema must also change the snapshot, so the
 * change arrives as a REVIEWABLE diff instead of as a surprise in production.
 * That is the shape of every environment-drift incident this project has had:
 * a function deployed from a different commit, a client one migration behind.
 *
 * Catalog queries rather than pg_dump: pg_dump emits version banners, SET
 * statements and an ordering that shift between server builds, so a snapshot of
 * it produces diffs about the dumper rather than about the schema.
 *
 * Regenerate deliberately with `node scripts/db-test.mjs --update-schema`.
 */
function schemaSnapshot() {
  const sql = readFileSync(join(ROOT, 'supabase/schema/dump.sql'), 'utf8');
  const common = ['-v', 'ON_ERROR_STOP=1', '-q'];
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
        { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      )
    : spawnSync('psql', [DATABASE_URL, ...common], {
        input: sql,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
  if (result.status !== 0) {
    console.error(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    quit('schema dump failed');
  }
  return `${result.stdout ?? ''}`
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.length > 0)
    .sort()
    .join('\n');
}

function checkSchemaSnapshot() {
  const path = join(ROOT, 'supabase/schema/snapshot.txt');
  const actual = schemaSnapshot();

  if (process.argv.includes('--update-schema')) {
    writeFileSync(path, `${actual}\n`);
    console.log(
      `\nschema snapshot UPDATED (${
        actual.split('\n').length
      } facts) -> supabase/schema/snapshot.txt`,
    );
    return;
  }

  let expected;
  try {
    expected = readFileSync(path, 'utf8').trimEnd();
  } catch {
    writeFileSync(path, `${actual}\n`);
    console.log(
      `\nschema snapshot CREATED (${actual.split('\n').length} facts)`,
    );
    return;
  }

  if (expected === actual) {
    console.log(
      `\nschema snapshot OK, ${actual.split('\n').length} facts match`,
    );
    return;
  }

  const exp = new Set(expected.split('\n'));
  const act = new Set(actual.split('\n'));
  const added = [...act].filter(l => !exp.has(l));
  const removed = [...exp].filter(l => !act.has(l));
  console.error('\nschema snapshot MISMATCH');
  for (const l of removed.slice(0, 40)) console.error(`  - ${l}`);
  for (const l of added.slice(0, 40)) console.error(`  + ${l}`);
  if (removed.length + added.length > 80) {
    console.error(`  ... ${removed.length + added.length - 80} more`);
  }
  console.error(
    '\nIf these changes are intended, regenerate with:\n' +
      '  node scripts/db-test.mjs --update-schema\n' +
      'and commit the diff, so the schema change is reviewed rather than assumed.',
  );
  quit(`schema drifted: ${removed.length} removed, ${added.length} added`);
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
  {
    file: join(ROOT, 'supabase/tests/340_client_support_floor.sql'),
    label:
      'client support floor: anon can read it, and the allowlist 080 rewrote is intact',
  },
  {
    file: join(ROOT, 'supabase/tests/350_message_idempotency.sql'),
    label:
      'message idempotency: the same nonce twice is one message, a different nonce is two',
  },
  {
    file: join(ROOT, 'supabase/tests/360_decline_means_no_session.sql'),
    label:
      'decline means no session: the flag outlives the request, so the prompt stops returning',
  },
  {
    file: join(ROOT, 'supabase/tests/370_provider_expertise.sql'),
    label:
      'provider expertise: the provider owns their own tags, and approval carries them',
  },
  {
    file: join(ROOT, 'supabase/tests/380_only_the_member_pays.sql'),
    label:
      'only the member pays: a provider cannot start a paid chat, and a decline binds server-side',
  },
  {
    file: join(ROOT, 'supabase/tests/340_sp_initiate_member_consent.sql'),
    label:
      'SP-initiate: provider first chat and call, member confirms the session',
  },
  {
    file: join(ROOT, 'supabase/tests/390_calls_can_actually_start.sql'),
    label:
      'calls can start: the media-assignment trigger and its constraint agree',
  },
  {
    file: join(ROOT, 'supabase/tests/400_stale_requests_do_not_suppress.sql'),
    label:
      'stale requests: an expired pending row stops blocking the next request',
  },
  {
    file: join(ROOT, 'supabase/tests/410_upgrade_handoff_is_writable.sql'),
    label: 'upgrade handoff: start_call can end the session it is taking over',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/420_writers_stay_inside_their_constraints.sql',
    ),
    label:
      'writers vs constraints: no function writes a literal its CHECK forbids',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/430_chat_session_survives_a_ringing_call.sql',
    ),
    label: 'chat survives a ringing call, and dies only when the call connects',
  },
  /*
   * ARMED by migration 100. This suite was written first and left unregistered
   * on purpose, because it proved a live 23503 whose fix needed an owner
   * decision — anonymise the billing rows or destroy them — that could not be
   * read off the code. The decision is in 100's header; this is now a gate.
   */
  {
    file: join(
      ROOT,
      'supabase/tests/440_delete_account_survives_a_paid_session.sql',
    ),
    label:
      'delete account: a member or provider with paid sessions can leave, and the billing rows stay',
  },
  /*
   * The other half of the same button, and a different set of tables: 440 is
   * about paid SESSIONS, this is about MONEY IN. Neither of its two blockers
   * — invoices.transaction_id RESTRICT over a CASCADEd token_transactions row,
   * and refund_reviews.user_id NO ACTION — needs a session to exist, which is
   * why 440 stayed green through both. Armed by migration 101.
   */
  {
    file: join(
      ROOT,
      'supabase/tests/450_delete_account_survives_an_invoice.sql',
    ),
    label:
      'delete account: a member who recharged can leave, and the GST invoice stays intact',
  },
  {
    file: join(ROOT, 'supabase/tests/460_edit_and_delete_messages.sql'),
    label:
      'edit and delete a message, and a provider who can see who they are talking to',
  },
  {
    file: join(ROOT, 'supabase/tests/470_call_heartbeats_are_activity.sql'),
    label:
      "a call's own heartbeat counts as activity, so it survives past 5m30s while a quiet chat still ends there",
  },
  {
    file: join(
      ROOT,
      'supabase/tests/480_messages_session_id_is_not_client_writable.sql',
    ),
    label:
      'messages.session_id/client_nonce/notified_at cannot be set by the recipient',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/490_session_leases_require_a_real_participant.sql',
    ),
    label:
      'session_leases cannot be planted by a stranger, and a stray row cannot fake "both present"',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/500_start_call_detects_a_simultaneous_ring.sql',
    ),
    label:
      'a simultaneous call in the same conversation is refused with ALREADY_RINGING, not silently replaced',
  },
  {
    file: join(ROOT, 'supabase/tests/510_truecaller_identity_linking.sql'),
    label:
      'Truecaller identity ownership, conflicts, grants, challenge replay, and deletion cascade',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/520_video_switch_bills_only_the_difference.sql',
    ),
    label:
      'voice → video needs the peer, charges only the difference, and accrual pays what was debited',
  },
  {
    file: join(
      ROOT,
      'supabase/tests/530_profiles_are_not_client_insertable_or_deletable.sql',
    ),
    label:
      'a client cannot delete or re-insert its profile to grant itself a balance, role, or verified phone',
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

/*
 * The schema snapshot runs BEFORE cleanup, because it needs the container the
 * migrations were applied to. An earlier draft put it after the final log line
 * and it failed with "No such container" — the teardown here is what owns the
 * ordering, not the position of the console.log.
 *
 * Skipped under --tap: that mode's stdout is consumed by an external TAP
 * reporter, and a human-readable schema diff in the middle of it is not TAP.
 */
if (!RAW_TAP) {
  checkSchemaSnapshot();
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
