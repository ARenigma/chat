#!/usr/bin/env node
/**
 * The moderation queue, as a CLI.
 *
 * A web console would be nicer and is not the point yet: what a queue needs
 * first is that reports are *seen* and that acting on one is recorded. A CLI
 * does both today, and every action it takes goes through the same RPCs and
 * tables an eventual console would use, so building that later is a UI change
 * rather than a rewrite.
 *
 * Requires the service role key, which is why this is a script run by a person
 * on a trusted machine and never anything the app can reach:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/moderate.mjs list
 *
 * Commands
 *   list [--limit=n]                    the open queue, minor_safety first
 *   show <report-id>                    one report with its evidence
 *   act <report-id> --action=<a> [opts] record an action and resolve the report
 *   dismiss <report-id> [--note=...]    close with no action
 *   purge                               drop resolved reports past retention
 *   maintenance                          refund unanswered messages, refresh
 *                                        published reply latencies (cron this)
 *   metrics [--days=n]                  the safety counters
 *   applications [--status=s]            the provider application queue
 *   admit <user-id> [--note=...]         approve an application
 *   needinfo <user-id> --fields=a,b      ask for specific fields, resolvable
 *                                        by the applicant without support
 *   decline <user-id> [--note=...]       reject, with a note they can read
 *
 * `act` actions: none | warned | suspended | banned | conversation_closed
 *   --days=n   suspension length; required for `suspended`
 *   --note=... free text recorded in the audit trail
 *   --actor=x  who is acting; defaults to $USER
 *
 * Suspending or banning asks for confirmation, because both are visible to the
 * person on the other end and neither is convenient to undo quietly.
 */
import { createInterface } from 'node:readline/promises';

const URL_BASE = process.env.SUPABASE_URL ?? '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const args = process.argv.slice(2);
const command = args[0] ?? 'list';
const positional = args.slice(1).filter(a => !a.startsWith('--'));
const flag = name => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
};

function fail(message) {
  console.error(`moderate: ${message}`);
  process.exit(1);
}

if (URL_BASE === '' || KEY === '') {
  fail(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      '  Get the key from the Supabase dashboard -> Project Settings -> API.\n' +
      '  Never put it in .env — that file is bundled into the app.',
  );
}

/** Thin REST wrapper. No dependency, and no client that could cache a token. */
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    // The key can appear in neither branch: this prints the server's message only.
    fail(`${method} ${path} -> ${response.status}\n${text}`);
  }
  return text === '' ? null : JSON.parse(text);
}

async function rpc(fn, body = {}) {
  return rest(`rpc/${fn}`, { method: 'POST', body });
}

const short = id => (id ?? '').slice(0, 8);
const clip = (s, n) => {
  if (s === null || s === undefined) {
    return '—';
  }
  const flat = String(s).replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ---------------------------------------------------------------------------

async function list() {
  const limit = Number(flag('limit') ?? 40);
  const rows = await rest(`moderation_queue?limit=${limit}`);
  if (rows.length === 0) {
    console.log('queue empty — no open reports');
    return;
  }
  console.log(
    `${'REPORT'.padEnd(9)}${'REASON'.padEnd(17)}${'AGE'.padEnd(7)}` +
      `${'PRIORS'.padEnd(7)}${'SUBJECT'.padEnd(9)}EVIDENCE`,
  );
  for (const r of rows) {
    const age = `${Math.floor(
      (Date.now() - new Date(r.created_at)) / 3_600_000,
    )}h`;
    // A repeat subject is the single most useful column in a triage list.
    const priors = String(r.reports_against_subject ?? 0);
    const marker =
      r.reason === 'minor_safety' || r.reason === 'self_harm' ? '!' : ' ';
    console.log(
      `${marker}${short(r.id).padEnd(8)}${r.reason.padEnd(17)}${age.padEnd(
        7,
      )}` +
        `${priors.padEnd(7)}${short(r.subject_user_id).padEnd(9)}` +
        `${clip(r.evidence_body ?? r.detail, 46)}`,
    );
  }
  console.log(
    `\n${rows.length} open. ` +
      '! = routed first (minor_safety, self_harm). `show <id>` for detail.',
  );
}

async function show() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: show <report-id>');
  }
  const [r] = await rest(`reports?id=eq.${id}&select=*`);
  if (r === undefined) {
    fail(`no report ${id}`);
  }
  const priors = await rest(
    `reports?subject_user_id=eq.${r.subject_user_id}&select=id&limit=100`,
  );
  console.log(`report        ${r.id}`);
  console.log(`reason        ${r.reason}`);
  console.log(`status        ${r.status}`);
  console.log(`filed         ${r.created_at}`);
  console.log(`reporter      ${r.reporter_id ?? '(deleted account)'}`);
  console.log(`subject       ${r.subject_user_id ?? '(deleted account)'}`);
  console.log(`priors        ${priors.length} report(s) against this subject`);
  console.log(`conversation  ${r.conversation_id ?? '—'}`);
  console.log(`\nreporter said:\n  ${clip(r.detail, 500)}`);
  console.log(`\nreported message (snapshot at ${r.evidence_at ?? 'n/a'}):`);
  console.log(`  ${clip(r.evidence_body, 2000)}`);
}

const ACTIONS = new Set([
  'none',
  'warned',
  'suspended',
  'banned',
  'conversation_closed',
]);

async function act() {
  const id = positional[0];
  const action = flag('action');
  const note = flag('note') ?? null;
  const actor = flag('actor') ?? `ops:${process.env.USER ?? 'unknown'}`;

  if (id === undefined || action === undefined) {
    fail(
      'usage: act <report-id> --action=<none|warned|suspended|banned|conversation_closed>',
    );
  }
  if (!ACTIONS.has(action)) {
    fail(`unknown action "${action}". One of: ${[...ACTIONS].join(', ')}`);
  }

  const [r] = await rest(`reports?id=eq.${id}&select=*`);
  if (r === undefined) {
    fail(`no report ${id}`);
  }
  if (r.subject_user_id === null && action !== 'none') {
    fail('the subject account is gone; nothing to enforce against');
  }

  let suspendedUntil = null;
  if (action === 'suspended') {
    const days = Number(flag('days'));
    if (!Number.isFinite(days) || days <= 0) {
      fail('--days=<n> is required for --action=suspended');
    }
    suspendedUntil = new Date(Date.now() + days * 86_400_000).toISOString();
  }
  if (action === 'banned') {
    // A ban is a suspension with no end, so there is one enforcement path in
    // send_message rather than two that can disagree.
    suspendedUntil = new Date('2999-01-01T00:00:00.000Z').toISOString();
  }

  if (action === 'suspended' || action === 'banned') {
    console.log(`subject  ${r.subject_user_id}`);
    console.log(`reason   ${r.reason}`);
    console.log(`evidence ${clip(r.evidence_body ?? r.detail, 200)}`);
    if (!(await confirm(`${action} until ${suspendedUntil}?`))) {
      console.log('aborted — nothing was written');
      return;
    }
  }

  // Order matters: the audit row is written first, so an enforcement action can
  // never exist without a record of who ordered it.
  await rest('moderation_actions', {
    method: 'POST',
    body: {
      report_id: r.id,
      subject_user_id: r.subject_user_id,
      action,
      actor,
      note,
    },
    prefer: 'return=minimal',
  });

  if (suspendedUntil !== null) {
    await rest(`profiles?id=eq.${r.subject_user_id}`, {
      method: 'PATCH',
      body: { suspended_until: suspendedUntil },
      prefer: 'return=minimal',
    });
  }

  await rest(`reports?id=eq.${r.id}`, {
    method: 'PATCH',
    body: {
      status: 'actioned',
      resolved_at: new Date().toISOString(),
      resolver_note: note,
    },
    prefer: 'return=minimal',
  });

  console.log(`recorded ${action} on ${short(r.subject_user_id)} by ${actor}`);
  if (suspendedUntil !== null) {
    console.log(`enforced until ${suspendedUntil}`);
  }
}

async function dismiss() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: dismiss <report-id> [--note=...]');
  }
  const note = flag('note') ?? null;
  const actor = flag('actor') ?? `ops:${process.env.USER ?? 'unknown'}`;

  // A dismissal is a decision and is recorded like any other.
  await rest('moderation_actions', {
    method: 'POST',
    body: { report_id: id, action: 'none', actor, note },
    prefer: 'return=minimal',
  });
  await rest(`reports?id=eq.${id}`, {
    method: 'PATCH',
    body: {
      status: 'dismissed',
      resolved_at: new Date().toISOString(),
      resolver_note: note,
    },
    prefer: 'return=minimal',
  });
  console.log(`dismissed ${short(id)}`);
}

async function purge() {
  const removed = await rpc('purge_expired_reports');
  console.log(
    `purged ${removed} resolved report(s) past the 90 day retention window`,
  );
}

async function metrics() {
  const days = Number(flag('days') ?? 14);
  const rows = await rest(`safety_metrics?limit=${days}`);
  if (rows.length === 0) {
    console.log('no telemetry yet');
    return;
  }
  console.log(
    `${'DAY'.padEnd(12)}${'SENT'.padEnd(8)}${'REJECTED'.padEnd(10)}` +
      `${'REPORTS'.padEnd(9)}${'BLOCKS'.padEnd(8)}ACTIVE`,
  );
  for (const r of rows) {
    console.log(
      `${String(r.day).slice(0, 10).padEnd(12)}${String(r.messages_sent).padEnd(
        8,
      )}` +
        `${String(r.sends_rejected).padEnd(10)}${String(
          r.reports_submitted,
        ).padEnd(9)}` +
        `${String(r.blocks_created).padEnd(8)}${r.active_users}`,
    );
  }
  console.log(
    '\nWatch the ratios, not the counts: reports or blocks per active user ' +
      'climbing is the abuse signal.',
  );
}

// --- Provider applications --------------------------------------------------
// Separate from the abuse queue on purpose: these are two different jobs with
// two different tempos, and mixing them buries the urgent one.

async function applications() {
  const status = flag('status') ?? 'submitted';
  const rows = await rest(
    `provider_applications?status=eq.${status}&order=submitted_at.asc&select=*`,
  );
  if (rows.length === 0) {
    console.log(`no applications with status "${status}"`);
    return;
  }
  console.log(
    `${'USER'.padEnd(10)}${'NAME'.padEnd(16)}${'AGE'.padEnd(5)}` +
      `${'LANGS'.padEnd(18)}HEADLINE`,
  );
  for (const a of rows) {
    const age =
      a.date_of_birth === null
        ? '?'
        : String(
            Math.floor(
              (Date.now() - new Date(a.date_of_birth)) /
                (365.25 * 24 * 3600 * 1000),
            ),
          );
    console.log(
      `${short(a.user_id).padEnd(10)}${clip(a.display_name, 15).padEnd(16)}` +
        `${age.padEnd(5)}${clip((a.languages ?? []).join(','), 17).padEnd(
          18,
        )}` +
        `${clip(a.headline, 40)}`,
    );
  }
  console.log(
    `\n${rows.length} waiting. \`admit <user-id>\`, ` +
      '`needinfo <user-id> --fields=about,headline`, or `decline <user-id>`.',
  );
}

async function admit() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: admit <user-id> [--note=...]');
  }
  await rpc('approve_provider_application', {
    p_user_id: id,
    p_note: flag('note') ?? null,
  });
  console.log(`admitted ${short(id)} — they are now in the directory`);
}

async function needinfo() {
  const id = positional[0];
  const fields = (flag('fields') ?? '')
    .split(',')
    .map(f => f.trim())
    .filter(Boolean);
  if (id === undefined || fields.length === 0) {
    fail('usage: needinfo <user-id> --fields=about,headline [--note=...]');
  }
  // Naming the fields is the whole point: "Something Missing" with no detail is
  // what makes applicants churn in public. See docs/clarity-learnings.md.
  await rpc('request_application_info', {
    p_user_id: id,
    p_missing: fields,
    p_note: flag('note') ?? null,
  });
  console.log(`asked ${short(id)} for: ${fields.join(', ')}`);
}

async function decline() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: decline <user-id> [--note=...]');
  }
  await rpc('reject_provider_application', {
    p_user_id: id,
    p_note: flag('note') ?? null,
  });
  console.log(`declined ${short(id)}`);
}

async function maintenance() {
  const refunded = await rpc('refund_unanswered_messages');
  const latencies = await rpc('refresh_reply_latencies');
  console.log(`refunded ${refunded} unanswered message(s)`);
  console.log(`refreshed reply latency for ${latencies} provider(s)`);
}

const COMMANDS = {
  list,
  show,
  act,
  dismiss,
  purge,
  metrics,
  applications,
  admit,
  needinfo,
  decline,
  maintenance,
};
const run = COMMANDS[command];
if (run === undefined) {
  fail(
    `unknown command "${command}". One of: ${Object.keys(COMMANDS).join(', ')}`,
  );
}
await run();
