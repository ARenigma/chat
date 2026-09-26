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
 *   list [--limit=n]                    the open queue, child safety first
 *   show <report-id>                    one report with its evidence, and a
 *                                        10-minute link to a reported voice
 *                                        note or story's media (a comment's
 *                                        story: only while it is live, and
 *                                        never past its 24 hours)
 *   act <report-id> --action=<a> [opts] record an action and resolve the report
 *   dismiss <report-id> [--note=...]    close with no action
 *   purge                               drop resolved reports past retention
 *   maintenance                          refresh published reply latencies,
 *                                        delete orphaned voice audio, drop
 *                                        resolved reports past retention
 *                                        (cron this)
 *   metrics [--days=n]                  the safety counters
 *   applications [--status=s]            the provider application queue
 *                                        (default: submitted; try --status=under_review)
 *   claim <user-id>                      move submitted → under_review so your
 *                                        review is recorded before acting
 *   admit <user-id> [--note=...]         approve an application
 *   needinfo <user-id> --fields=a,b      ask for specific fields, resolvable
 *                                        by the applicant without support
 *   decline <user-id> [--note=...]       reject, with a note they can read
 *
 * The contact guard (migrations 157-159)
 *   contacts [--queue=q]                 the review queues: removal_review (a
 *                                        provider at strike 3) and human_review
 *                                        (anyone at strike 5)
 *   contact <user-id>                    one account's strikes, pause, hiding
 *                                        and last 50 events with excerpts
 *   contact-resolve <user-id> --action=<clear|suspend|ban> [--days=n]
 *                                        close a review row; removal of a
 *                                        provider is `ban` (or `suspend`)
 *   contact-strike <story-report-id>     strike the provider of a reported
 *                                        story whose media held a contact
 *                                        detail (once per report)
 *
 * `act` actions: none | warned | suspended | banned | conversation_closed
 *   any action but `none` on a story-comment report also takes the comment
 *   down (a tombstone, as the author's own delete makes), and on a story
 *   report takes the story down (its media is kept while the report names it)
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
    // The key can appear in neither branch: this prints the server's message only.
    fail(`${method} ${path} -> ${response.status}\n${text}`);
  }
  return text === '' ? null : JSON.parse(text);
}

async function rpc(fn, body = {}) {
  return rest(`rpc/${fn}`, { method: 'POST', body });
}

const short = id => (id ?? '').slice(0, 8);
/*
 * Every field this prints is written by a user: a report's detail, a message,
 * a caption, a comment, a display name. A raw ESC in any of them is a terminal
 * escape sequence, and `\x1b[2K\x1b[1A` erases the line above, so a comment
 * could rewrite what the operator reads about it. C0 and C1 controls become
 * U+FFFD before anything else, so they show as a visible mark instead of
 * acting. Tab, LF, VT, FF and CR are left to the whitespace collapse after it,
 * so a CRLF in a message still reads as one space rather than two marks.
 */
const clip = (s, n) => {
  if (s === null || s === undefined) {
    return ',';
  }
  const flat = String(s)
    // Matching control characters is the whole job of this line.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, '\ufffd')
    .replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === 'y';
}

// ---------------------------------------------------------------------------

/**
 * The reasons a report is routed first for. Child safety under both of its
 * names: 'minor_safety' is the older one, 'child_safety' what the app's
 * taxonomy files (026, appConfig's fallback). Marked by 'minor_safety' alone,
 * a child-safety report read like spam. The queue's ORDER BY is the same set
 * (moderation_queue, 150).
 */
const ROUTED_FIRST = ['minor_safety', 'child_safety', 'self_harm'];

async function list() {
  const limit = Number(flag('limit') ?? 40);
  const rows = await rest(`moderation_queue?limit=${limit}`);
  if (rows.length === 0) {
    console.log('queue empty, no open reports');
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
    const marker = ROUTED_FIRST.includes(r.reason) ? '!' : ' ';
    console.log(
      `${marker}${short(r.id).padEnd(8)}${r.reason.padEnd(17)}${age.padEnd(
        7,
      )}` +
        `${priors.padEnd(7)}${short(r.subject_user_id).padEnd(9)}` +
        `${evidenceText(r, 46)}`,
    );
  }
  console.log(
    `\n${rows.length} open. ` +
      `! = routed first (${ROUTED_FIRST.join(
        ', ',
      )}). \`show <id>\` for detail.`,
  );
}

/**
 * What a report's EVIDENCE shows: what kind of thing was reported, and the
 * words snapshotted when it was filed. Never the reporter's own detail. That
 * used to stand in for a missing snapshot, under the same label, and a
 * caption-less story report has none, so "he wrote that he will hurt me" read
 * as evidence the moment before a ban. The reporter's words are printed as
 * theirs (`show`, and the `act` confirmation).
 *
 * The kind comes first, whatever the words. A story report's snapshot is its
 * caption, and a captioned photo showed as the bare caption: an explicit
 * image captioned "good morning" read "good morning" in the queue and in the
 * ban confirmation, a line that looks like a chat message and never says the
 * thing reported is media. And a voice note has no words at all
 * (evidence_voice_path, 011/094): it read "[no snapshot]", before the y/N,
 * for a report whose evidence is kept and playable (`show`).
 */
function evidenceText(r, n) {
  const body = r.evidence_body ?? null;
  const surface = r.evidence_surface ?? null;
  if (surface === 'story') {
    return body === null
      ? '[story media]'
      : clip(`[story media] caption: ${body}`, n);
  }
  if (surface === 'story_comment') {
    return body === null ? '[story comment]' : clip(`[comment] ${body}`, n);
  }
  if (body !== null) {
    return clip(body, n);
  }
  if (r.evidence_voice_path) {
    return '[voice note]';
  }
  return '[no snapshot]';
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
  const priors = await priorsAgainst(r.subject_user_id);
  console.log(`report        ${r.id}`);
  console.log(`reason        ${r.reason}`);
  console.log(`status        ${r.status}`);
  console.log(`filed         ${r.created_at}`);
  console.log(`reporter      ${r.reporter_id ?? '(deleted account)'}`);
  console.log(`subject       ${r.subject_user_id ?? '(deleted account)'}`);
  console.log(
    `priors        ${
      priors === null
        ? 'n/a (deleted account)'
        : `${priors} report(s) against this subject`
    }`,
  );
  console.log(`conversation  ${r.conversation_id ?? ','}`);
  // Story reports (150) carry no conversation. `?? null` because a database
  // without 150 has no such columns and PostgREST simply omits them, which
  // must read as "not a story report" rather than as undefined !== null.
  const storyId = r.story_id ?? null;
  const commentId = r.story_comment_id ?? null;
  const storyMedia = r.evidence_story_media_path ?? null;
  // evidence_surface is durable (150); the ids above are nulled when the
  // story expires, so the surface decides what the snapshot was.
  const surface = r.evidence_surface ?? null;
  const aboutStory =
    surface !== null ||
    storyId !== null ||
    commentId !== null ||
    storyMedia !== null;
  const aboutComment = surface === 'story_comment' || commentId !== null;
  // Only printed when set, so a chat report reads exactly as it always has.
  if (aboutStory) {
    console.log(`story         ${storyId ?? '(expired or deleted)'}`);
    // Whose story, kept past the purge (150), so a comment report still says
    // which provider the comments were piling onto.
    const provider = r.evidence_story_provider_id ?? null;
    console.log(
      `story by      ${provider ?? '(deleted account or not recorded)'}`,
    );
  }
  if (aboutComment) {
    console.log(`comment       ${commentId ?? '(expired with its story)'}`);
  }
  if (aboutStory) {
    // The public name it was posted under, snapshotted with the report (150):
    // display_name is client-writable, so the name on the profile now may not
    // be the one the audience read it next to.
    console.log(`posted as     ${r.evidence_author_name ?? '(not recorded)'}`);
  }
  console.log(`\nreporter said:\n  ${clip(r.detail, 500)}`);
  // evidence_body is the words snapshotted at report time, whichever surface
  // they came from: a message, a story's caption, or a comment (150).
  const evidenceLabel = aboutComment
    ? 'reported comment'
    : aboutStory
    ? 'reported story caption'
    : 'reported message';
  console.log(`\n${evidenceLabel} (snapshot at ${r.evidence_at ?? 'n/a'}):`);
  console.log(`  ${clip(r.evidence_body, 2000)}`);
  if (aboutComment) {
    // The story the comment answered, kept past the story's 24 hours.
    console.log('\non the story captioned:');
    console.log(`  ${clip(r.evidence_context ?? '(no caption)', 500)}`);
  }
  if (r.evidence_voice_path) {
    // A reported voice note is unreadable, so the queue has to hand over
    // something playable or "he sent me something vile" is unactionable the
    // moment it was spoken rather than typed. Ten minutes on the token: long
    // enough to listen twice. What the token does NOT bound is printed with it
    // (`EVIDENCE_LINK_CAVEAT`).
    const signed = await sign(
      'voice-notes',
      r.evidence_voice_path,
      EVIDENCE_LINK_SECONDS,
    );
    console.log('\nreported voice note:');
    console.log(`  ${signedText(signed, 'the audio')}`);
    if (signed.url !== undefined) {
      console.log(
        `  token lasts ${linkLifetime(
          EVIDENCE_LINK_SECONDS,
        )}. ${EVIDENCE_LINK_CAVEAT}`,
      );
    }
  }
  if (aboutStory) {
    // The voice note's reasoning, for a photo or a video. A caption is
    // optional, so for most story reports the media IS the evidence, and the
    // bucket is private (144): without a link there is nothing to look at.
    // Same ten minutes, for the same reasons.
    const media =
      storyMedia !== null
        ? { path: storyMedia, seconds: EVIDENCE_LINK_SECONDS }
        : await liveStoryMedia(storyId);
    if (media === null) {
      console.log('\nstory media:');
      console.log(
        '  (the story has expired or is gone; a comment report keeps the words and the caption, not the media)',
      );
    } else {
      // story_media_path_is_scoped (143) allows .mp4 for a video and only
      // jpg, jpeg, png or webp for an image, so the extension is the type.
      const kind = media.path.endsWith('.mp4') ? 'video' : 'photo';
      const signed = await sign('stories', media.path, media.seconds);
      console.log(
        aboutComment
          ? `\nthe story the comment is on (${kind}):`
          : `\nreported story ${kind}:`,
      );
      console.log(`  ${signedText(signed, 'the media')}`);
      if (signed.url !== undefined) {
        console.log(
          `  token lasts ${linkLifetime(
            media.seconds,
          )}. ${EVIDENCE_LINK_CAVEAT}`,
        );
      }
    }
  }
}

/**
 * How long the token on a link to reported evidence lasts: long enough to
 * watch or listen twice.
 */
const EVIDENCE_LINK_SECONDS = 600;

/**
 * What that token does not bound, printed next to every evidence link.
 *
 * "Link expires in 10 minutes" was not true once the link had been opened.
 * The Smart CDN serves a cached response for the same signed URL until the
 * object is updated or deleted, "even if the token in that URL has already
 * expired" (144's header and story-media-url cite it), and reported evidence
 * is exactly what is NOT deleted: the story media purge skips any object a
 * report names (151), and the voice-note purge any report's path (094). So an
 * operator who opened a link and then pasted it into a thread, trusting ten
 * minutes, handed over the evidence for as long as it is retained.
 * https://supabase.com/docs/guides/storage/cdn/smart-cdn
 */
const EVIDENCE_LINK_CAVEAT =
  'Once opened, the CDN keeps serving this URL until the evidence is purged: never paste it anywhere.';

/** "10 minutes", or the seconds when a story's own end makes it shorter. */
const linkLifetime = seconds =>
  seconds === EVIDENCE_LINK_SECONDS ? '10 minutes' : `${seconds} seconds`;

/**
 * The lifetime of a link to a LIVE story's media: the evidence window, cut to
 * the story's own remaining time, or null when under a second is left. The
 * rule story-media-url applies to a viewer (Math.min(TTL_SECONDS, left)), so
 * an operator's link cannot outlive the 24 hours either.
 */
function storyLinkSeconds(expiresAt, now) {
  const left = Math.floor((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(left) || left < 1) {
    return null;
  }
  return Math.min(EVIDENCE_LINK_SECONDS, left);
}

/**
 * The media key of a story that is still LIVE, and how long a link to it may
 * last, or null.
 *
 * Only reached for a report on a COMMENT. A report on a story snapshots its key
 * (evidence_story_media_path, 150), and the media purge (151) keeps every object
 * a report names, so that link outlives the story's 24 hours for as long as the
 * report is retained. A comment report snapshots the comment's words, which are
 * the evidence, and not the story, which is context: retaining it would keep a
 * provider's photo past its 24 hours because of something a commenter did. So
 * the story can be shown only while it is live. It used to be "while its row
 * still exists", and the row outlives the 24 hours until the hourly sweep
 * (151), so a `show` in that gap signed a working 10-minute link to media the
 * provider's audience could no longer see. Unexpired in the query, and the
 * link capped at what is left (`storyLinkSeconds`). Read with the service
 * role, because no client policy applies to an operator.
 */
async function liveStoryMedia(storyId, now = Date.now()) {
  if (storyId === null || storyId === undefined) {
    return null;
  }
  const [story] = await rest(
    `stories?id=eq.${storyId}` +
      `&expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}` +
      '&select=media_path,expires_at',
  );
  if (story === undefined || !story.media_path) {
    return null;
  }
  const seconds = storyLinkSeconds(story.expires_at, now);
  return seconds === null ? null : { path: story.media_path, seconds };
}

/**
 * How many reports name this subject, or null for a subject whose account is
 * gone. subject_user_id is set null when the account is deleted (005), and a
 * null interpolated into the filter was `eq.null`, which PostgREST sends to
 * Postgres as the string 'null' against a uuid column: 22P02, a 400, and
 * `rest` exits before the report is printed at all. The one case the script
 * already had words for ("(deleted account)") was the case it crashed on.
 */
async function priorsAgainst(subjectId) {
  if (subjectId === null || subjectId === undefined) {
    return null;
  }
  const rows = await rest(
    `reports?subject_user_id=eq.${subjectId}&select=id&limit=100`,
  );
  return rows.length;
}

/**
 * Take down the comment an actioned story-comment report is about.
 *
 * `act` recorded the decision, suspended or banned the author, and closed the
 * report, and never touched the comment: it stayed public under the story for
 * up to 24 hours after the report read "actioned". The suspension clause in
 * story_comment_is_visible (147) now hides a suspended author's comments, and
 * this is the rest: a `warned` author's comment, or a ban that is later
 * lifted, still comes down. A tombstone, the same one the author's or the
 * provider's delete makes (body null, deleted_at set), so the report's own
 * snapshot is the only copy of the words, as it is for any deleted comment.
 * `none` touches nothing; a report whose comment is already purged has
 * nothing left to take down. Only a comment not already deleted is written.
 */
async function takeDownReportedComment(report, action, now = Date.now()) {
  const commentId = report.story_comment_id ?? null;
  if (action === 'none' || commentId === null) {
    return false;
  }
  await rest(`story_comments?id=eq.${commentId}&deleted_at=is.null`, {
    method: 'PATCH',
    body: { body: null, deleted_at: new Date(now).toISOString() },
    prefer: 'return=minimal',
  });
  return true;
}

/**
 * Take down the story an actioned story report is about.
 *
 * `act` recorded the decision and closed the report and left the story up:
 * in every tray and signable through story-media-url for the rest of its 24
 * hours, however the report was actioned. Only a suspension or a ban hid it,
 * and only through provider_is_listed while it lasted. So any action but
 * `none` deletes the row, as the provider's own delete does. The evidence
 * survives it: the report snapshotted the media's key
 * (evidence_story_media_path, 150), the delete records the name for the purge
 * (stories_release_media), and the purge keeps every object a report names
 * (story_objects_to_purge, 151). A comment report is not this: its evidence
 * is the comment, and its story is someone else's context
 * (`takeDownReportedComment`).
 */
async function takeDownReportedStory(report, action) {
  const storyId = report.story_id ?? null;
  if (
    action === 'none' ||
    report.evidence_surface !== 'story' ||
    storyId === null
  ) {
    return false;
  }
  await rest(`stories?id=eq.${storyId}`, {
    method: 'DELETE',
    prefer: 'return=minimal',
  });
  return true;
}

/**
 * A short-lived URL for a private object: `{ url }`, `{ gone: true }` when
 * Storage says there is no such object, or `{ error: status }` for anything
 * else.
 *
 * Storage is not PostgREST, so this cannot go through `rest`. It does not fail
 * the command: a report whose audio or story media has already been purged is
 * still a report worth reading. But gone and failed are told apart. Every
 * non-OK answer used to read "the media is gone; the report outlived it",
 * and for a report that is almost never true (the purges keep every object a
 * report names, 094 and 151), so a 503 or a 429 during `show` on a child
 * safety report told the operator the evidence no longer existed. Storage
 * answers a missing object with 404, or with 400 and `error: "not_found"` in
 * the body. The service key goes in the headers only; the URL printed carries
 * the object's own expiring token and nothing else.
 */
async function sign(bucket, path, seconds) {
  const response = await fetch(
    `${URL_BASE}/storage/v1/object/sign/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: seconds }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const notFound =
      response.status === 404 ||
      body?.error === 'not_found' ||
      String(body?.statusCode ?? '') === '404';
    return notFound ? { gone: true } : { error: response.status };
  }
  const { signedURL } = await response.json();
  return signedURL === undefined
    ? { error: response.status }
    : { url: `${URL_BASE}/storage/v1${signedURL}` };
}

/** What `show` prints for a `sign` answer about `what` ("the audio", "the media"). */
function signedText(signed, what) {
  if (signed.url !== undefined) {
    return signed.url;
  }
  if (signed.gone === true) {
    return `(${what} is gone; the report outlived it)`;
  }
  return `(could not sign a link to ${what}: Storage answered ${signed.error}; it is not gone, run show again)`;
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
    console.log(`evidence ${evidenceText(r, 200)}`);
    console.log(`reporter said ${clip(r.detail, 200)}`);
    if (!(await confirm(`${action} until ${suspendedUntil}?`))) {
      console.log('aborted, nothing was written');
      return;
    }
  }

  // Order matters: the audit row is written first, so an enforcement action can
  // never exist without a record of who ordered it.
  //
  // Resumable: a takedown below can fail after the audit row and suspension
  // landed, which exits with the report still open. Re-running the same act
  // used to record the action a second time (Greptile P1 on 6bb4114). An
  // existing row for this report and action means this is that retry: the
  // record is kept (not written twice); the suspension, the takedowns and the
  // resolve are re-applied, all idempotent.
  const [already] = await rest(
    `moderation_actions?report_id=eq.${r.id}&action=eq.${action}&select=id&limit=1`,
  );
  if (already !== undefined) {
    console.log(`resuming: ${action} was already recorded for this report`);
  }
  if (already === undefined)
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

  // Always, even on a resume: the audit row can land and the PATCH fail, and
  // a resume that skipped it closed a report whose suspension never applied.
  // Setting the same restriction twice is harmless.
  if (suspendedUntil !== null) {
    await rest(`profiles?id=eq.${r.subject_user_id}`, {
      method: 'PATCH',
      body: { suspended_until: suspendedUntil },
      prefer: 'return=minimal',
    });
  }

  // After the audit row, like every enforcement step here.
  const tookDown = await takeDownReportedComment(r, action);
  const tookDownStory = await takeDownReportedStory(r, action);

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
  if (tookDown) {
    console.log(`took down comment ${short(r.story_comment_id)}`);
  }
  if (tookDownStory) {
    console.log(`took down story ${short(r.story_id)}`);
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
    `\n${rows.length} waiting. \`claim <user-id>\` to move to under_review, ` +
      'then `admit`, `needinfo --fields=about,headline`, or `decline`.',
  );
}

async function claim() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: claim <user-id>');
  }
  await rpc('claim_provider_application_review', { p_user_id: id });
  console.log(`claimed ${short(id)}, status is now under_review`);
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
  /*
   * `refund_unanswered_messages` is NOT called here any more, and must not be
   * added back. It credits one token per unanswered member message, which was
   * right when a message cost a token; migration 037 moved chat to per-minute
   * paid sessions and `send_message` (077) debits nothing per message, so every
   * credit it issues today refunds a charge that never happened. Migration 088
   * makes the function itself a no-op and carries the full reasoning.
   */
  const latencies = await rpc('refresh_reply_latencies');
  /**
   * Storage has no foreign key to `messages`, so deleting an account cascades the
   * rows away and leaves the audio behind, orphaned and unreachable. Without this
   * the deletion promise in web/privacy.html is false for voice notes.
   *
   * The function is server-side rather than a listing sweep here, so the 24 hour
   * grace period and the "reported audio is exempt" rule live next to the
   * constraint they protect. See `purge_orphaned_voice_notes` in migration 011.
   */
  const audio = await rpc('purge_orphaned_voice_notes');
  /*
   * Also scheduled on pg_cron (151), and here for a project without it: the
   * report purge is what frees a reported story's media once its report's
   * retention runs out (story_objects_to_purge keeps every object a report
   * names).
   */
  const reports = await rpc('purge_expired_reports');
  console.log(`refreshed reply latency for ${latencies} provider(s)`);
  console.log(`deleted ${audio} orphaned voice note(s)`);
  console.log(
    `purged ${reports} resolved report(s) past the 90 day retention window`,
  );
}

// ---------------------------------------------------------------------------
// The contact guard (157-159)
// ---------------------------------------------------------------------------

const GUARD_QUEUES = new Set(['removal_review', 'human_review']);

/** The accounts the ladder sent to a person, providers first, oldest first. */
async function contacts() {
  const queue = flag('queue');
  if (queue !== undefined && !GUARD_QUEUES.has(queue)) {
    fail('--queue must be removal_review or human_review');
  }
  const filter = queue === undefined ? '' : `&review_state=eq.${queue}`;
  const rows = await rest(
    `contact_guard_review_queue?select=*${filter}&order=role.desc,review_requested_at.asc`,
  );
  if (rows.length === 0) {
    console.log('the contact-guard review queues are empty');
    return;
  }
  for (const r of rows) {
    console.log(
      `${short(r.user_id)}  ${r.review_state.padEnd(14)} ${r.role.padEnd(8)} ` +
        `strikes=${r.active_strikes}  since=${r.review_requested_at}  ` +
        `${clip(r.display_name, 30)}  [${(r.categories ?? []).join(',')}]`,
    );
  }
  console.log(`\n${rows.length} to review. Details: contact <user-id>`);
}

/** Every contact-guard event and strike for one account, excerpts clipped. */
async function contact() {
  const id = positional[0];
  if (id === undefined) {
    fail('usage: contact <user-id>');
  }
  const [queue] = await rest(
    `contact_guard_review_queue?user_id=eq.${id}&select=*`,
  );
  const [restriction] = await rest(
    `contact_guard_restrictions?user_id=eq.${id}&select=*`,
  );
  const strikes = await rest(
    `contact_guard_strikes?user_id=eq.${id}&select=created_at,expires_at,voided_at&order=created_at.desc`,
  );
  const events = await rest(
    `contact_guard_events?user_id=eq.${id}&select=created_at,surface,field,tier,outcome,category,reason,rules,excerpt,counts_as_strike&order=created_at.desc&limit=50`,
  );
  console.log(`account     ${id}`);
  console.log(`review      ${queue?.review_state ?? 'none'}`);
  console.log(`paused      ${restriction?.paused_until ?? '-'}`);
  console.log(`hidden      ${restriction?.directory_hidden_until ?? '-'}`);
  const active = strikes.filter(
    s => s.voided_at === null && new Date(s.expires_at) > new Date(),
  );
  console.log(`strikes     ${active.length} active of ${strikes.length}`);
  for (const e of events) {
    console.log(
      `  ${e.created_at}  ${e.outcome.padEnd(7)} ${e.tier.padEnd(
        6,
      )} ${e.surface.padEnd(13)} ` +
        `${(e.category ?? '-').padEnd(7)} ${
          e.counts_as_strike ? 'STRIKE ' : '       '
        }` +
        `${clip(e.excerpt, 120)}`,
    );
  }
}

/** Resolve a review row: clear, suspend (--days) or ban; audited by the function. */
async function contactResolve() {
  const id = positional[0];
  const action = flag('action');
  const note = flag('note') ?? null;
  const actor = flag('actor') ?? `ops:${process.env.USER ?? 'unknown'}`;
  if (id === undefined || !['clear', 'suspend', 'ban'].includes(action ?? '')) {
    fail(
      'usage: contact-resolve <user-id> --action=<clear|suspend|ban> [--days=n] [--note=...]',
    );
  }
  const days = action === 'suspend' ? Number(flag('days')) : null;
  if (action === 'suspend' && (!Number.isFinite(days) || days <= 0)) {
    fail('--days=<n> is required for --action=suspend');
  }
  const [row] = await rest(
    `contact_guard_review_queue?user_id=eq.${id}&select=*`,
  );
  if (row === undefined) {
    fail(`no contact-guard review is open for ${id}`);
  }
  if (action !== 'clear') {
    console.log(`account  ${id} (${row.role}, ${clip(row.display_name, 40)})`);
    console.log(
      `queue    ${row.review_state}, ${row.active_strikes} active strikes`,
    );
    if (
      !(await confirm(
        `${action}${action === 'suspend' ? ` for ${days} days` : ''}?`,
      ))
    ) {
      console.log('aborted, nothing was written');
      return;
    }
  }
  const result = await rpc('contact_guard_resolve_review', {
    p_user_id: id,
    p_action: action,
    p_days: days,
    p_actor: actor,
    p_note: note,
  });
  console.log(
    `resolved ${result.was} for ${short(id)}: ${result.action}` +
      (result.suspended_until ? ` until ${result.suspended_until}` : ''),
  );
}

/** A strike against the provider of a reported story whose media held a contact detail. */
async function contactStrike() {
  const reportId = positional[0];
  if (reportId === undefined) {
    fail('usage: contact-strike <story-report-id> [--note=...]');
  }
  const note = flag('note') ?? null;
  const actor = flag('actor') ?? `ops:${process.env.USER ?? 'unknown'}`;
  const result = await rpc('contact_guard_strike_from_report', {
    p_report_id: reportId,
    p_actor: actor,
    p_note: note,
  });
  if (result.already) {
    console.log(
      `report ${short(reportId)} already struck (event ${short(
        result.event_id,
      )}); nothing written`,
    );
    return;
  }
  console.log(
    `strike ${result.strikes} recorded for report ${short(reportId)}` +
      (result.restricted_until
        ? `, paused until ${result.restricted_until}`
        : '') +
      (result.directory_hidden_until
        ? `, hidden until ${result.directory_hidden_until}`
        : ''),
  );
  console.log('the report itself stays open: act or dismiss it as usual');
}

const COMMANDS = {
  contacts,
  contact,
  'contact-resolve': contactResolve,
  'contact-strike': contactStrike,
  list,
  show,
  act,
  dismiss,
  purge,
  metrics,
  applications,
  claim,
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
