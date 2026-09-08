#!/usr/bin/env node
/**
 * Production invariant check.
 *
 * `node scripts/prod-check.mjs`
 *
 * Exit 0 = every invariant holds. Exit 1 = at least one is violated, and the
 * offending rows are printed.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * On 2026-09-07 two testers lost an evening to a session that could never
 * start: they were on versionCode 10109, the database was on migration 079, and
 * the consent sheet that completes a chat session only exists from 10110. Their
 * requests sat `pending` with `responded_at` set, forever.
 *
 * Nothing threw. No exception on the device, nothing in the logs, nothing in
 * Sentry — every layer did exactly what its own code said, and the composition
 * deadlocked. That is the shape of the expensive bugs in this app, and it is
 * the shape no error tracker and no diff reviewer can see: there is no error,
 * and no single file is wrong.
 *
 * What DOES see it is the data. A stuck state is visible as a row that has sat
 * in an impossible shape for longer than the product allows. Finding it took
 * about fifteen hand-written SQL queries. This file is those queries, so the
 * next time it is one command.
 *
 * ---------------------------------------------------------------------------
 * The rule for adding a check
 * ---------------------------------------------------------------------------
 * Every check must be a statement about a state that CANNOT be correct, not a
 * state that is merely unusual. A check that fires on healthy data gets ignored
 * within a week, and an ignored check is worse than no check because it makes
 * the next real failure look like noise. If a state is legitimate under any
 * timing, it does not go here — bound it in the query until it is not.
 *
 * Each check therefore carries a grace window, chosen from the product rule it
 * is derived from rather than from taste. Where there is no product rule, say
 * so in the comment.
 */

import { execFileSync } from 'node:child_process';

const CHECKS = [
  {
    name: 'chat request answered but never started',
    /*
     * THE 2026-09-07 BUG. A `chat` request whose provider has replied
     * (`responded_at` set) but which is still `pending` with no `paid_sessions`
     * row for the conversation.
     *
     * The member's consent sheet is the only thing that advances this.
     *
     * NARROWED 2026-09-08, because migration 086 made the broad version cry
     * wolf. This used to fire on any request answered more than ten minutes
     * ago with no session — and that WAS the signature of the bug it was
     * written for. It no longer is: before 086 a provider's Accept sometimes
     * created the session outright, and now it never does, so "answered, waiting
     * on the member" is the normal intermediate state of every single chat
     * request. A member who simply has not opened the app yet would fail this
     * check, and a check that fails on healthy data is a check people stop
     * reading.
     *
     * So it now requires the conversation to have CARRIED ON — a message from
     * either side after the provider answered — with still no session. That is
     * the defect and not the pause: the two of them are talking, the consent
     * sheet did not convert, and nobody is being billed for it. It is the
     * revenue leak the 2026-09-07 report described ("continuous prompt on every
     * send gating msg off") seen from the server, and it cannot be produced by
     * a member who is merely slow to answer, because a member who has not
     * answered cannot send.
     *
     * Grace stays 10 minutes on top of that, so a message crossing the sheet in
     * flight does not trip it.
     */
    sql: `
      select r.id::text as request_id,
             r.conversation_id::text as conversation_id,
             to_char(r.created_at, 'YYYY-MM-DD HH24:MI') as created,
             round(extract(epoch from (now() - r.responded_at)) / 60) as stuck_minutes
      from session_requests r
      where r.channel = 'chat'
        and r.status = 'pending'
        and r.responded_at is not null
        and r.responded_at < now() - interval '10 minutes'
        and r.expires_at > now()
        and not exists (
          select 1 from paid_sessions s
          where s.conversation_id = r.conversation_id
            and s.started_at > r.created_at
        )
        -- ...and the conversation carried on regardless. See the note above:
        -- without this the check fires on every member who has not yet opened
        -- the app, which after 086 is most of them.
        and exists (
          select 1 from messages m
          where m.conversation_id = r.conversation_id
            and m.created_at > r.responded_at
        )
      order by r.responded_at`,
  },
  {
    name: 'request pending past its own expiry',
    /*
     * A `pending` request whose `expires_at` has passed. Both readers of a
     * request — `confirm_chat_session` (077:41) and `accept_session_request`
     * (086) — already refuse one in this state and mark it expired, so a row
     * that stays pending is a row lying about a decision the clock already
     * made.
     *
     * It matters because `send_message` (077:168) opens a request only when
     * none is `pending`, testing the status and not the expiry, while
     * `session_requests_one_pending` permits one pending row per conversation
     * and channel. So a single stale row suppresses every later request in that
     * conversation: messages keep flowing, no session can open, nobody is
     * billed, and nothing throws. That is the 2026-09-07 shape and it was found
     * live on 2026-09-08.
     *
     * Migration 090 sweeps these every minute. Grace is 5 minutes, which is
     * five missed sweeps — enough that a slow tick is not noise, little enough
     * that a dead sweep is caught the same day.
     */
    sql: `
      select r.id::text as request_id,
             r.conversation_id::text as conversation_id,
             r.channel::text as channel,
             round(extract(epoch from (now() - r.expires_at)) / 60) as expired_minutes_ago
      from session_requests r
      where r.status = 'pending'
        and r.expires_at < now() - interval '5 minutes'
      order by r.expires_at`,
  },
  {
    name: 'session live with no active lease',
    /*
     * A `paid_sessions` row with no `ended_at` whose newest lease heartbeat is
     * older than the server's own grace period. The meter is notionally running
     * for someone who is not there.
     *
     * Grace: 5 minutes, against a 30-second server grace window
     * (`HEARTBEAT_INTERVAL_MS` is 10s, three misses expire the lease). Ten times
     * the real bound, because the sweeper is not instantaneous and a check that
     * races its own cleanup is a check that cries wolf.
     */
    sql: `
      select s.id::text as session_id,
             s.channel,
             to_char(s.started_at, 'YYYY-MM-DD HH24:MI') as started,
             round(extract(epoch from (now() - s.started_at)) / 60) as running_minutes
      from paid_sessions s
      where s.ended_at is null
        and s.started_at < now() - interval '5 minutes'
        and not exists (
          select 1 from session_leases l
          where l.session_id = s.id
            and l.last_heartbeat_at > now() - interval '5 minutes'
        )
      order by s.started_at`,
  },
  {
    name: 'call ringing far past any answer',
    /*
     * A `calls` row still `ringing`. Requests expire in 30 seconds, so a ring
     * that has outlived that by an order of magnitude was never resolved to
     * answered, declined or missed.
     *
     * Grace: 10 minutes.
     */
    sql: `
      select c.id::text as call_id,
             c.medium,
             to_char(c.created_at, 'YYYY-MM-DD HH24:MI') as created,
             round(extract(epoch from (now() - c.created_at)) / 60) as ringing_minutes
      from calls c
      where c.status = 'ringing'
        and c.created_at < now() - interval '10 minutes'
      order by c.created_at`,
  },
  {
    name: 'a member is being billed for a session they declined',
    /*
     * THE ONE ON THIS LIST THAT COSTS SOMEBODY MONEY, and the only one added
     * after a defect was reproduced rather than imagined.
     *
     * Before migration 086, `accept_session_request` let the RECIPIENT of a
     * chat request create the paid session — and on the ordinary member-first
     * path the recipient is the PROVIDER. So tapping Accept on ChatRingScreen
     * started billing a member who had confirmed nothing, and it kept working
     * after the member declined, because 082's decline was enforced in the
     * client's composer and a build without 082 keeps sending.
     *
     * 086 makes both impossible. This query is what proves it stayed
     * impossible, and it is also the query to run FIRST if a member ever
     * disputes a charge: it lists every live session on a conversation whose
     * member has declined.
     *
     * No grace window. There is no timing under which this is legitimate — the
     * trigger 086 adds clears the flag the instant a member consents, so a row
     * that is both in a session and declined cannot exist for a moment.
     */
    sql: `
      select s.id::text        as session_id,
             s.member_id::text as member_id,
             s.status,
             c.chat_consent_declined_at,
             round(extract(epoch from (now() - s.accepted_at)) / 60) as minutes_old
      from   paid_sessions s
      join   conversations c on c.id = s.conversation_id
      where  s.channel = 'chat'
        and  c.chat_consent_declined_at is not null
        and  s.status in ('pending_leases', 'active', 'warning', 'grace')
      order  by s.accepted_at`,
  },
  {
    name: 'provider live with no language',
    /*
     * Migration 075 makes this impossible with a CHECK constraint, so this
     * check should never fire. It is here precisely BECAUSE it should never
     * fire: if it ever does, the constraint has been dropped, and a constraint
     * silently disappearing is exactly the kind of thing nobody notices.
     *
     * No grace window — there is no timing under which this is legitimate.
     */
    sql: `
      select id::text as profile_id, display_name
      from profiles
      where role = 'provider'
        and coalesce(cardinality(languages), 0) = 0`,
  },
  {
    name: 'client_support floor is unreadable pre-auth',
    /*
     * Not a data invariant but a reachability one, and it belongs here because
     * the version gate is worthless if the anon role cannot read the floor:
     * `supportVerdict` fails OPEN, so a broken grant does not raise an error,
     * it silently disables the gate. Precisely the failure mode this whole file
     * is about.
     *
     * Fires when the domain has no active prod payload, or when the payload has
     * no `min_version_code` key.
     */
    sql: `
      select 'client_support has no readable prod floor' as problem
      where not exists (
        select 1 from admin.config_active
        where domain = 'client_support'
          and environment = 'prod'
          and payload ? 'min_version_code'
      )`,
  },
];

function query(sql) {
  const out = execFileSync(
    'supabase',
    ['db', 'query', '--linked', sql.trim()],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  // The CLI prints progress lines around the JSON, so the object is extracted
  // rather than parsed from the whole stream. Same reason `functions list`
  // needs this treatment.
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`no JSON in supabase output:\n${out}`);
  }
  const parsed = JSON.parse(match[0]);
  if (parsed._tag === 'Error') {
    throw new Error(parsed.error?.message ?? 'query failed');
  }
  return parsed.rows ?? [];
}

let violations = 0;

for (const check of CHECKS) {
  let rows;
  try {
    rows = query(check.sql);
  } catch (err) {
    // A check that cannot run is a failure, not a pass. Reporting it as OK is
    // how a silent gate becomes a green light.
    console.log(`ERROR  ${check.name}`);
    console.log(`       ${err.message.split('\n')[0]}`);
    violations += 1;
    continue;
  }
  if (rows.length === 0) {
    console.log(`ok     ${check.name}`);
    continue;
  }
  violations += 1;
  console.log(`FAIL   ${check.name}  (${rows.length})`);
  for (const row of rows.slice(0, 10)) {
    console.log(`       ${JSON.stringify(row)}`);
  }
  if (rows.length > 10) {
    console.log(`       … and ${rows.length - 10} more`);
  }
}

console.log(
  violations === 0
    ? `\nprod-check OK, ${CHECKS.length} invariants hold`
    : `\nprod-check FAILED: ${violations} of ${CHECKS.length}`,
);
process.exit(violations === 0 ? 0 : 1);
