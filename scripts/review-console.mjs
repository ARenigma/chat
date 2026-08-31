#!/usr/bin/env node
/**
 * Provider admission queue CLI. (build-spec.md §16)
 *
 * Dedicated to the review loop only: list → claim → admit | needinfo | decline.
 * Abuse queue work stays in moderate.mjs to keep the two tempos separate.
 *
 * Requires the service role key, which is why this is a script run by a person
 * on a trusted machine and never anything the app can reach:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/review-console.mjs list
 *
 * Commands
 *   list                                 the open queue (submitted + under_review +
 *                                        needs_info), oldest first
 *   show <user-id>                       one application in full
 *   claim <user-id>                      move submitted → under_review
 *   admit <user-id> [--note=...]         approve; becomes a provider in the directory
 *   needinfo <user-id> --fields=a,b      ask for specific fields, applicant can
 *                                        resubmit without support
 *   decline <user-id> [--note=...]       reject, with a note they can read
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
  console.error(`review: ${message}`);
  process.exit(1);
}

if (URL_BASE === '' || KEY === '') {
  fail(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      '  Get the key from the Supabase dashboard -> Project Settings -> API.\n' +
      '  Never put it in .env, that file is bundled into the app.',
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
    fail(`${method} ${path} -> ${response.status}\n${text}`);
  }
  return text === '' ? null : JSON.parse(text);
}

async function rpc(fn, body = {}) {
  return rest(`rpc/${fn}`, { method: 'POST', body });
}

const short = id => (id ?? '').slice(0, 8);
const clip = (s, n) => {
  if (s === null || s === undefined) return '—';
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
  // provider_review_queue is accessible via service_role; it returns the three
  // active statuses ordered by submitted_at ascending (oldest first).
  const rows = await rest(
    'provider_review_queue?order=submitted_at.asc&select=*',
  );
  if (!rows || rows.length === 0) {
    console.log(
      'queue empty — no applications in submitted, under_review, or needs_info',
    );
    return;
  }
  console.log(
    `${'USER'.padEnd(10)}${'STATUS'.padEnd(14)}${'NAME'.padEnd(
      16,
    )}${'AGE'.padEnd(5)}` + `${'LANGS'.padEnd(18)}HEADLINE`,
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
      `${short(a.user_id).padEnd(10)}${(a.status ?? '?').padEnd(14)}` +
        `${clip(a.display_name, 15).padEnd(16)}${age.padEnd(5)}` +
        `${clip((a.languages ?? []).join(','), 17).padEnd(18)}` +
        `${clip(a.headline, 40)}`,
    );
  }
  console.log(
    `\n${rows.length} in queue. \`claim <user-id>\` to start a review.`,
  );
}

async function show() {
  const id = positional[0];
  if (id === undefined) fail('usage: show <user-id>');

  const rows = await rest(`provider_applications?user_id=eq.${id}&select=*`);
  const a = rows?.[0];
  if (a === undefined) fail(`no application for user ${id}`);

  const age =
    a.date_of_birth === null
      ? 'unknown'
      : `${Math.floor(
          (Date.now() - new Date(a.date_of_birth)) /
            (365.25 * 24 * 3600 * 1000),
        )} years`;

  console.log(`user          ${a.user_id}`);
  console.log(`status        ${a.status}`);
  console.log(`submitted     ${a.submitted_at ?? '—'}`);
  console.log(`reviewed      ${a.reviewed_at ?? '—'}`);
  console.log(`name          ${a.display_name ?? '—'}`);
  console.log(`gender        ${a.gender ?? '—'}`);
  console.log(`age           ${age}`);
  console.log(`languages     ${(a.languages ?? []).join(', ') || '—'}`);
  console.log(`headline      ${a.headline ?? '—'}`);
  console.log(`\nabout:\n  ${clip(a.about, 1000)}`);
  if ((a.missing_fields ?? []).length > 0) {
    console.log(`\nmissing       ${a.missing_fields.join(', ')}`);
  }
  if (a.reviewer_note) {
    console.log(`reviewer note ${a.reviewer_note}`);
  }
}

async function claim() {
  const id = positional[0];
  if (id === undefined) fail('usage: claim <user-id>');
  await rpc('claim_provider_application_review', { p_user_id: id });
  console.log(`claimed ${short(id)}, status is now under_review`);
}

async function admit() {
  const id = positional[0];
  if (id === undefined) fail('usage: admit <user-id> [--note=...]');
  await rpc('approve_provider_application', {
    p_user_id: id,
    p_note: flag('note') ?? null,
  });
  console.log(`admitted ${short(id)}, they are now in the directory`);
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
  await rpc('request_application_info', {
    p_user_id: id,
    p_missing: fields,
    p_note: flag('note') ?? null,
  });
  console.log(`asked ${short(id)} for: ${fields.join(', ')}`);
}

async function decline() {
  const id = positional[0];
  if (id === undefined) fail('usage: decline <user-id> [--note=...]');

  if (!(await confirm(`decline application for ${short(id)}?`))) {
    console.log('aborted, nothing was written');
    return;
  }
  await rpc('reject_provider_application', {
    p_user_id: id,
    p_note: flag('note') ?? null,
  });
  console.log(`declined ${short(id)}`);
}

const COMMANDS = { list, show, claim, admit, needinfo, decline };
const run = COMMANDS[command];
if (run === undefined) {
  fail(
    `unknown command "${command}". One of: ${Object.keys(COMMANDS).join(', ')}`,
  );
}
await run();
