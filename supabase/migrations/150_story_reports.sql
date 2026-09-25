-- ===========================================================================
-- 150  Reporting a story or a comment, through the reports that exist
-- ===========================================================================
-- Public comments make abuse a real risk (owner's words), so both a story and
-- a comment are reportable, and the provider can report any comment on their
-- own story. This EXTENDS public.reports rather than adding a second queue:
-- moderation_queue, scripts/moderate.mjs, the minor_safety-first ordering and
-- purge_expired_reports all already work on that table, and a parallel table
-- would need every one of them copied.
--
-- The 005 retention argument carries over unchanged and matters more here,
-- because a story deletes itself after a day and a comment can be deleted by
-- its author in a second, or by the provider before they think to report it
-- (section 3 lets that delete file the report first). So a report snapshots its evidence at report time:
-- the caption or comment body into evidence_body, and a story's media path
-- into evidence_story_media_path, which the media purge (151) treats as
-- retained, as 094 treats evidence_voice_path. The references themselves are
-- `on delete set null`, so the report survives the thing it is about.
--
-- Same rate limit as submit_report, counted over the same rows: 10 reports an
-- hour per reporter, across conversations and stories together. Mass false
-- reporting is a harassment vector whichever surface it starts from. Section 0
-- makes it a limit that holds under concurrency, on all three entry points.

alter table public.reports
  add column if not exists story_id uuid
    references public.stories(id) on delete set null,
  add column if not exists story_comment_id uuid
    references public.story_comments(id) on delete set null,
  add column if not exists evidence_story_media_path text,
  -- Durable: never set null. The story and comment ids above go when the
  -- story expires, and a report reviewed after that could not tell a
  -- comment's snapshot from a chat message's (Greptile P1 on 5cb4480).
  add column if not exists evidence_surface text
    check (evidence_surface in ('story', 'story_comment')),
  add column if not exists evidence_context text,
  -- The reported story's or comment's own id, copied at report time and never
  -- nulled, unlike story_id and story_comment_id, which the purge clears. A
  -- retry with the client-minted report id is matched on this: against the
  -- nulled ids a genuine retry after a purge was refused, and a naive `<>`
  -- matched a retry naming a different story.
  add column if not exists evidence_target_id uuid,
  -- Whose story it was, for either kind of report. A story report's subject
  -- is the provider, but a COMMENT report's subject is the commenter, its
  -- story_id goes null when the story is purged, and its media path is
  -- deliberately not kept; so after 24 hours nothing on it said which
  -- provider was being targeted, and five members piling onto one provider's
  -- stories read as five unrelated comment reports. Set null only when that
  -- provider deletes their account, as subject_user_id is.
  add column if not exists evidence_story_provider_id uuid
    references public.profiles(id) on delete set null,
  -- The public name the reported thing was published under, as the audience
  -- saw it: the commenter's for a comment, the provider's for a story.
  -- profiles.display_name is client-writable (148), so a comment posted under
  -- an abusive name that passes public_display_name's shape, with a harmless
  -- body, read as harmless the moment its author renamed.
  add column if not exists evidence_author_name text;

comment on column public.reports.story_id is
  'The reported story, or the story a reported comment was on (150). Set null '
  'when the story expires or is deleted; the evidence columns keep what it was.';
comment on column public.reports.story_comment_id is
  'The reported story comment (150). Set null when purged.';
comment on column public.reports.evidence_surface is
  'Which story surface a report came from (150): story or story_comment. Null '
  'for chat reports. Kept after the story is purged, unlike story_id.';
comment on column public.reports.evidence_context is
  'For a comment report, the caption of the story it was on, copied at report '
  'time so a moderator can read the comment in context after the story is gone.';
comment on column public.reports.evidence_story_provider_id is
  'The provider whose story a story or comment report was about, kept after '
  'the story is purged (150), so reports that pile onto one provider read as '
  'one. Set null when that provider deletes their account.';
comment on column public.reports.evidence_author_name is
  'The public name (public_display_name, 148) the reported comment or story '
  'was published under, copied at report time (150), so a rename afterwards '
  'does not erase what the audience saw.';
comment on column public.reports.evidence_story_media_path is
  'Object key in the `stories` bucket, copied at report time. The media purge '
  '(151) never removes an object any report still names.';

-- A reporter reads their own reports through my_reports (005), and no longer
-- through the whole row. 005 granted SELECT on the table because my_reports is
-- security_invoker and runs with the caller's rights, and RLS kept each
-- reporter to their own rows. That was harmless while the subject of a report
-- was always somebody the reporter already knew: their chat peer, or (for a
-- story, below) the provider whose name is on the story. A COMMENT report
-- changes that. Its subject_user_id is the commenter's account id, which the
-- comment feed withholds from every stranger on purpose (147, 148), and a
-- report on the comment would hand it straight back from the reporter's own
-- row. resolver_note, which 005 already said a reporter may not see, came
-- back the same way.
--
-- So the grant is narrowed to the columns my_reports selects, plus
-- reporter_id for its WHERE. RLS still limits the rows; column privileges now
-- limit what each row says. count(*) needs no column, so a client that counts
-- still can. Service-role readers (moderate.mjs, the admin console) are
-- untouched: the grant is to `authenticated` only.
-- https://www.postgresql.org/docs/16/sql-grant.html
revoke select on public.reports from authenticated;
grant select (id, reporter_id, reason, status, created_at, resolved_at)
  on public.reports to authenticated;

-- The media purge (151) asks "does any report name this object" once per
-- candidate.
create index if not exists reports_evidence_story_media_path
  on public.reports (evidence_story_media_path)
  where evidence_story_media_path is not null;

-- Both references are `on delete set null`, so every story a provider deletes
-- and every story and comment the hourly purge removes looks up the reports
-- that point at it. Unindexed, that is a scan of all of `reports` per row
-- deleted; partial, because almost every report is about a conversation and
-- has neither column set.
create index if not exists reports_story_id
  on public.reports (story_id)
  where story_id is not null;
create index if not exists reports_story_comment_id
  on public.reports (story_comment_id)
  where story_comment_id is not null;
-- Read by an account deletion's set null, and by the queue's "who else was
-- reported about this provider" question.
create index if not exists reports_evidence_story_provider_id
  on public.reports (evidence_story_provider_id)
  where evidence_story_provider_id is not null;

-- ---------------------------------------------------------------------------
-- The one lock order: profiles, then the story, then the comment
-- ---------------------------------------------------------------------------
-- An account deletion locks profiles first and then, through the cascade,
-- the account's stories and comments. A report took them the other way
-- round: the story (and comment) FOR SHARE, then, at its insert, the
-- subject's profile, which the foreign key check locks FOR KEY SHARE. So a
-- report on a provider's story while that provider deleted their account
-- could each hold the row the other wanted next; Postgres broke the deadlock
-- by aborting one of them, and when it was the report the deletion then took
-- the story with no report filed. Reproduced two-session (supabase/tests/
-- 566): the report failed with 40P01 "while locking tuple ... in relation
-- profiles" at the FK check.
--
-- "Profiles first" was not true of the deletion either, and section 6 makes
-- it true. delete_user_account (100) ends the account's live sessions before
-- the cascade, and end_session's owed-minute flush (107) debits the MEMBER's
-- wallet, which deduct_tokens (028) takes FOR UPDATE; only then does it delete
-- its own profile. So a provider P deleting while a paid session with member
-- M was owed a minute locked M, then P; a comment report on M's comment under
-- P's story locks P, then M, when P's id is the lower. Each held what the
-- other wanted, and Postgres aborted one: reproduced two-session in 566, the
-- report failing with 40P01 "while locking tuple ... in relation profiles",
-- or the deletion. Now the deletion locks its live sessions, then every
-- profile it will touch (its own and each live session's other side) FOR
-- UPDATE in id order, before it ends anything: the same order a report takes.
--
-- So every story report path reads the ids it needs UNLOCKED (a story's
-- provider and a comment's author and story are written once and never
-- change), locks every profile its insert will check FOR KEY SHARE first, in
-- id order, and only then the story and the comment. A deletion that started
-- first finishes first, and the report finds nothing left to report; one
-- that starts second waits for the report, whose snapshot then survives the
-- cascade with its references set null. FOR KEY SHARE conflicts only with
-- FOR UPDATE, which is a delete, an update of a key column, or an explicit
-- SELECT ... FOR UPDATE: the wallet's deduct_tokens takes that on the
-- profile, so a report does hold a debit back for the few statements it runs.
-- A plain UPDATE takes FOR NO KEY UPDATE and never waits on it.
--
-- And no row is locked by a call that is going to be refused. The budget
-- (section 0) is checked first, under the reporter's own lock, and what the
-- caller may see is checked next, unlocked; only a report that will be filed
-- takes a row lock, and then checks again under it. Rows first, a member at
-- the 10/hour limit looping report_story held the story FOR SHARE on every
-- refused call while waiting for their own lock, and with twenty connections
-- the provider's delete of that story never got in (8 s statement timeout,
-- twice). A stranger looping delete_story_comment on a comment they may not
-- touch did the same with three row locks (section 3).
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-DEADLOCKS

-- ---------------------------------------------------------------------------
-- 0. One budget, one lock
-- ---------------------------------------------------------------------------
-- The limit is a count(*) of the reporter's last hour, and under READ
-- COMMITTED a count does not see a parallel transaction's uncommitted insert.
-- Fifty reports fired at once all counted nine and all went in: 28 landed in
-- one burst against a limit of 10. Nothing else bounds it, since a reporter
-- may report the same story again. So every entry point takes the SAME
-- per-reporter transaction lock before it counts, the pattern create_story
-- (143) and post_story_comment (147) use, and the second report waits for
-- the first to commit and then counts it.
--
-- submit_report (011) counts the same rows, so it takes the same lock, or a
-- conversation report and a story report fired together would each see the
-- other's budget as unspent. It is re-created here from 011's body with that
-- one line added and nothing else changed. The lock is re-entrant within a
-- transaction, so delete_story_comment, which takes it and then calls
-- report_story_comment (section 3), does not deadlock on itself; and it is
-- the FIRST lock every story entry point takes, before any row, so no two of
-- them can hold a row and this lock in opposite orders.
-- https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
create or replace function public.submit_report(
  p_conversation_id uuid,
  p_message_id uuid,
  p_reason public.report_reason,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_subject uuid;
  v_body text;
  v_voice text;
  v_at timestamptz;
  v_id uuid;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations where id = p_conversation_id;

  if v_member is null then
    raise exception 'no such conversation' using errcode = 'no_data_found';
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_subject := case when v_uid = v_member then v_provider else v_member end;

  -- The one line 150 adds: the shared report lock (section 0).
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  -- Same two conditions as before: in the reported conversation, and not written
  -- by the reporter. A voice note snapshots its path instead of its text, and
  -- the voice-notes purge (011, 094) treats that path as retained.
  if p_message_id is not null then
    select body, voice_path, created_at into v_body, v_voice, v_at
    from public.messages
    where id = p_message_id
      and conversation_id = p_conversation_id
      and sender_id = v_subject;
  end if;

  insert into public.reports (
    reporter_id, subject_user_id, conversation_id, message_id,
    reason, detail, evidence_body, evidence_voice_path, evidence_at
  )
  values (
    v_uid, v_subject, p_conversation_id, p_message_id,
    p_reason, btrim(p_detail), v_body, v_voice, v_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 0a. Who may report: whoever can see it, or saw it before being blocked
-- ---------------------------------------------------------------------------
-- Both report paths asked story_is_visible, which excludes a blocked pair, and
-- 152 gives the provider a one-call block against any commenter. So a member
-- who viewed a story and objected in a comment could be blocked by the story's
-- provider and then refused ("no such story"): the one person who objected was
-- the one who could no longer report, with no conversation to report from and
-- no block of their own to make (096). The media went at 24 hours with no
-- report on it.
--
-- So a story is reportable by whoever may see it now, or by whoever viewed it
-- (a story_views row, 145) while it is still unexpired. A block cannot take
-- away a report about something the reporter already saw; a blocked member
-- who never viewed it learns nothing and is refused as before. Expiry still
-- ends it: past 24 hours the object is on its way out (151), and a report
-- then would promise evidence the purge may already have claimed.
--
-- A comment the same way: every test story_comment_is_visible makes (147),
-- with the story's visibility replaced by the same "can see it, or viewed the
-- story before the block". A comment by an author blocked with the reporter
-- or the provider stays unreportable, as it was never shown to them.
--
-- Internal: only the report functions call them, as their owner.
create or replace function public.story_is_reportable(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.story_is_visible(p_story_id)
      or exists (
        select 1
        from public.stories s
        join public.story_views v on v.story_id = s.id and v.viewer_id = auth.uid()
        where s.id = p_story_id
          and s.expires_at > now()
      );
$$;

comment on function public.story_is_reportable(uuid) is
  'Whether the caller may report this story: they can see it now, or they '
  'viewed it and it has not expired, so a block by its provider cannot '
  'silence a viewer who objected (150).';

revoke all on function public.story_is_reportable(uuid) from public, anon, authenticated;

create or replace function public.story_comment_is_reportable(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.story_comment_is_visible(p_comment_id)
      or exists (
        select 1
        from public.story_comments c
        join public.stories s on s.id = c.story_id
        join public.profiles a on a.id = c.author_id
        join public.story_views v on v.story_id = s.id and v.viewer_id = auth.uid()
        where c.id = p_comment_id
          and c.deleted_at is null
          and (a.suspended_until is null or a.suspended_until <= now())
          and s.expires_at > now()
          and not public.is_blocked_pair(auth.uid(), c.author_id)
          and not public.is_blocked_pair(s.provider_id, c.author_id)
      )
      -- The story's own provider can always report a comment on it, blocked
      -- author or not: blocking the author (152) must not take away the
      -- report that is the provider's one route to moderation.
      or exists (
        select 1
        from public.story_comments c
        join public.stories s on s.id = c.story_id
        where c.id = p_comment_id
          and c.deleted_at is null
          and s.provider_id = auth.uid()
      );
$$;

comment on function public.story_comment_is_reportable(uuid) is
  'Whether the caller may report this comment: story_comment_is_visible, or '
  'every one of its tests with "viewed the unexpired story" standing in for '
  'the story''s visibility (150).';

revoke all on function public.story_comment_is_reportable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Reporting a story
-- ---------------------------------------------------------------------------
-- Raises rather than returning json, matching submit_report (005/011): the
-- client's report sheet already handles that function's shape, and one report
-- surface should fail one way.
--
-- The client names the report, as it names a comment (post_story_comment,
-- 147): p_report_id is a v4 uuid minted once per report and resent on every
-- retry. Without it a report whose response was lost was filed again by the
-- retry, a second row that spent a second unit of the hourly budget and
-- counted twice in reports_against_subject. Looked up under the reporter's
-- lock and before the budget, so a retry of a report that landed is the
-- original id even with the budget now spent; the same id from another
-- account, or for another story, is refused (22023) and says nothing about
-- whose it is. Optional so an older caller still works; every client sends it.
create or replace function public.report_story(
  p_story_id  uuid,
  p_reason    public.report_reason,
  p_detail    text default null,
  p_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_provider uuid;
  v_story    public.stories%rowtype;
  v_existing public.reports%rowtype;
  v_name     text;
  v_recent   integer;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- The budget first, under the reporter's lock, so parallel reports cannot
  -- all see nine (section 0) and a refused one has locked no row (above).
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  -- A retry after a lost response is the report already filed (above).
  if p_report_id is not null then
    select * into v_existing from public.reports where id = p_report_id;
    if found then
      -- story_id goes null when the story is purged; the surface does not.
      if v_existing.reporter_id is distinct from v_uid
         or v_existing.evidence_surface is distinct from 'story'
         or v_existing.evidence_target_id is distinct from p_story_id then
        raise exception 'report id already used' using errcode = '22023';
      end if;
      return v_existing.id;
    end if;
  end if;

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  /*
   * Then what the caller may see, unlocked: only what the reporter can
   * actually see, or saw before a block (section 0a), so a report cannot be
   * used to pull the caption and media path of a story they were never
   * shown, and a caller who could not file one takes no row lock at all.
   * Asked again under the lock below.
   */
  select s.provider_id into v_provider from public.stories s where s.id = p_story_id;

  if v_provider is null or not public.story_is_reportable(p_story_id) then
    raise exception 'no such story' using errcode = 'no_data_found';
  end if;

  if v_provider = v_uid then
    raise exception 'cannot report your own story' using errcode = '22023';
  end if;

  -- The profiles the insert checks come first (the lock order above): the
  -- reporter's and the provider's.
  perform 1 from public.profiles
  where id in (v_uid, v_provider)
  order by id
  for key share;

  /*
   * The media purge's lock, shared, between the profiles and the story. The
   * purge's claim (151) takes it exclusively before it lists what to remove,
   * and it lists an expired story's object at once. Without this, a report
   * that checked a story just before it expired, and committed just after,
   * filed evidence naming an object the claim had handed to the Edge
   * Function in between (reproduced two-session: the report committed with
   * evidence_story_media_path set to a name already in story_media_released).
   * Now a claim waits for this report to commit and then sees it, since the
   * purge list skips any object a report names; and a claim that committed
   * first is seen here, below. create_story takes it shared too (143).
   */
  perform pg_advisory_xact_lock_shared(hashtextextended('story_media_purge', 0));

  /*
   * Lock the story before reading its evidence, as report_story_comment does
   * for a comment. Read unlocked, a provider deleting the story (or the
   * expiry sweep removing it) between the check and the insert made the
   * report fail on the story reference, and the member could not report it
   * at all (Greptile P1 on 1e845ce). The lock makes the delete wait for this
   * report to commit; one that committed first is refused here as a story
   * that no longer exists.
   */
  select * into v_story from public.stories where id = p_story_id for share;

  if not found or not public.story_is_reportable(p_story_id) then
    raise exception 'no such story' using errcode = 'no_data_found';
  end if;

  -- A name the purge already claimed may be gone from the bucket by now, and
  -- a report naming it would promise evidence that is not there.
  if exists (select 1 from public.story_media_released m where m.name = v_story.media_path) then
    raise exception 'no such story' using errcode = 'no_data_found';
  end if;

  -- The name the story was posted under, from the profile locked above.
  select public.public_display_name(p) into v_name
  from public.profiles p where p.id = v_story.provider_id;

  begin
    insert into public.reports (
      id, reporter_id, subject_user_id, story_id, reason, detail,
      evidence_body, evidence_story_media_path, evidence_at, evidence_surface,
      evidence_story_provider_id, evidence_author_name, evidence_target_id
    )
    values (
      coalesce(p_report_id, gen_random_uuid()), v_uid, v_story.provider_id, v_story.id,
      p_reason, nullif(btrim(p_detail), ''),
      v_story.caption, v_story.media_path, v_story.created_at, 'story',
      v_story.provider_id, v_name, v_story.id
    )
    returning id into v_id;
  exception
    -- The same id filed at the same moment by another account, under its
    -- own reporter lock: the lookup above cannot see an uncommitted row, the
    -- primary key can.
    when unique_violation then
      raise exception 'report id already used' using errcode = '22023';
  end;

  return v_id;
end;
$$;

comment on function public.report_story(uuid, public.report_reason, text, uuid) is
  'Report a story the caller can see, or viewed before its provider blocked '
  'them (not their own). Snapshots the caption, media path and the name it '
  'was posted under as evidence. Shares submit_report''s 10/hour limit. '
  'Idempotent on the client-minted report id.';

revoke all on function public.report_story(uuid, public.report_reason, text, uuid) from public, anon;
grant execute on function public.report_story(uuid, public.report_reason, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reporting a comment
-- ---------------------------------------------------------------------------
-- Anyone who can see the comment, which includes the story's provider, or
-- who viewed its story before a block (section 0a), and never its author.
-- Idempotent on p_report_id, as report_story is (section 1).
create or replace function public.report_story_comment(
  p_comment_id uuid,
  p_reason     public.report_reason,
  p_detail     text default null,
  p_report_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_story    uuid;
  v_author   uuid;
  v_provider uuid;
  v_gone     timestamptz;
  v_comment  public.story_comments%rowtype;
  v_parent   public.stories%rowtype;
  v_existing public.reports%rowtype;
  v_name     text;
  v_recent   integer;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- The budget first, under the reporter's lock (section 0, and the lock
  -- order above): a refused report locks no row.
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  -- A retry after a lost response is the report already filed (section 1).
  -- story_comment_id goes null when the story is purged; the surface does not.
  if p_report_id is not null then
    select * into v_existing from public.reports where id = p_report_id;
    if found then
      if v_existing.reporter_id is distinct from v_uid
         or v_existing.evidence_surface is distinct from 'story_comment'
         or v_existing.evidence_target_id is distinct from p_comment_id then
        raise exception 'report id already used' using errcode = '22023';
      end if;
      return v_existing.id;
    end if;
  end if;

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  /*
   * The ids, unlocked, and whether the caller may report this at all. The
   * story id is safe to read this way because a comment never moves:
   * post_story_comment writes story_id once and nothing updates it, and the
   * author and the provider never change either. If the story goes before
   * the lock, its comments went with it, and the lock below finds nothing.
   */
  select c.story_id, c.author_id, c.deleted_at into v_story, v_author, v_gone
  from public.story_comments c where c.id = p_comment_id;
  select s.provider_id into v_provider from public.stories s where s.id = v_story;

  if v_provider is null or v_gone is not null
     or not public.story_comment_is_reportable(p_comment_id) then
    raise exception 'no such comment' using errcode = 'no_data_found';
  end if;

  if v_author = v_uid then
    raise exception 'cannot report your own comment' using errcode = '22023';
  end if;

  /*
   * Then the rows, and the evidence read from them. Read unlocked, an author
   * deleting the comment in the same instant could null its body before the
   * insert, and the report was filed with no text for a moderator to review
   * (Greptile P1 on 7036bf8). The lock makes a concurrent delete wait for
   * this report to commit; a delete that committed first leaves deleted_at
   * set, and the report is refused as if the comment were gone, which it is.
   * The story is locked for the same reason: its caption is the context the
   * report keeps.
   *
   * The profiles the insert checks first (the lock order above): the
   * reporter's, the commenter's (the subject) and the story's provider's
   * (evidence_story_provider_id). Then the story, then the comment: the one
   * order every story path takes (delete_story_comment, section 3, too),
   * because it is the order a story's own delete takes them in. Deleting a
   * story, by its provider or by the hourly expiry, locks the story row and
   * then, through the cascade, every comment on it. This function used to
   * lock the comment and then the story, so a report and a delete of the
   * same story could each hold the row the other wanted next, and Postgres
   * broke the deadlock by aborting one of them: the report, or the
   * provider's delete (Greptile P1 on bb32af4).
   */
  perform 1 from public.profiles
  where id in (v_uid, v_author, v_provider)
  order by id
  for key share;

  select * into v_parent from public.stories where id = v_story for share;

  select * into v_comment from public.story_comments where id = p_comment_id for share;

  if v_parent.id is null
     or v_comment.id is null
     or v_comment.deleted_at is not null
     or not public.story_comment_is_reportable(p_comment_id) then
    raise exception 'no such comment' using errcode = 'no_data_found';
  end if;

  -- The name the comment was published under, from the profile locked above:
  -- the name the audience read it next to, which its author may change.
  select public.public_display_name(p) into v_name
  from public.profiles p where p.id = v_comment.author_id;

  begin
    insert into public.reports (
      id, reporter_id, subject_user_id, story_id, story_comment_id, reason, detail,
      evidence_body, evidence_at, evidence_surface, evidence_context,
      evidence_story_provider_id, evidence_author_name, evidence_target_id
    )
    values (
      coalesce(p_report_id, gen_random_uuid()), v_uid, v_comment.author_id,
      v_comment.story_id, v_comment.id, p_reason,
      nullif(btrim(p_detail), ''), v_comment.body, v_comment.created_at,
      -- The caption of the story the comment answered, so it still reads in
      -- context once the story is purged. Not its media: keeping a provider's
      -- photo past its 24 hours because of what a commenter wrote is the
      -- trade moderate.mjs's liveStoryMediaPath already declines. The
      -- provider's id instead, so the report still says whose story it was.
      'story_comment', v_parent.caption, v_parent.provider_id, v_name, v_comment.id
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'report id already used' using errcode = '22023';
  end;

  return v_id;
end;
$$;

comment on function public.report_story_comment(uuid, public.report_reason, text, uuid) is
  'Report a story comment the caller can see, or saw before a block (not '
  'their own); the story''s provider included. Snapshots the body and the '
  'name it was published under. Shares submit_report''s 10/hour limit. '
  'Idempotent on the client-minted report id.';

revoke all on function public.report_story_comment(uuid, public.report_reason, text, uuid) from public, anon;
grant execute on function public.report_story_comment(uuid, public.report_reason, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Report, then delete, in one transaction
-- ---------------------------------------------------------------------------
-- Deleting is a provider's natural first move on an abusive comment, and the
-- tombstone (147) erases the body, after which report_story_comment has
-- nothing to report. So the provider's delete can carry a report reason: the
-- report is filed first, snapshotting the words, and the tombstone follows in
-- the same transaction. If the report cannot be filed (the 10/hour limit, or
-- a comment the provider can no longer see), nothing is deleted and the error
-- says why, so the evidence is never lost to a delete the caller meant to
-- report. The client offers plain delete as the fallback.
--
-- Replaces 147's one-argument version rather than overloading it: an
-- overload with defaulted arguments would make a one-argument call ambiguous.
-- Everything 147 says about who may delete still holds.
--
-- Idempotent with a report too, on p_report_id (section 1). A retry after a
-- lost response used to find the tombstone the first call wrote and answer
-- NOT_FOUND, so the client could not tell that the report existed. Now the
-- report is looked up first, under the reporter's lock, and a retry of a
-- report-and-delete that landed is its original success.
drop function if exists public.delete_story_comment(uuid);

create or replace function public.delete_story_comment(
  p_comment_id    uuid,
  p_report_reason public.report_reason default null,
  p_report_detail text default null,
  p_report_id     uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_story    uuid;
  v_author   uuid;
  v_provider uuid;
  v_deleted  timestamptz;
  v_recent   integer;
  v_report   uuid;
  v_existing public.reports%rowtype;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  /*
   * Who may do this, answered unlocked and before any lock. It used to lock
   * the three profiles, the story and the comment FIRST, so a stranger's
   * call, refused FORBIDDEN, still took all of them on the way; five
   * parallel loops of it held the story FOR SHARE for long enough that the
   * provider's delete of the story timed out at 8 s, and it took 4 ms with
   * the loops stopped. The ids never change once written (report_story_comment
   * says why), so the answer read here is the answer.
   */
  select c.story_id, c.author_id, c.deleted_at into v_story, v_author, v_deleted
  from public.story_comments c where c.id = p_comment_id;
  select s.provider_id into v_provider from public.stories s where s.id = v_story;

  -- NOT_FOUND to a stranger, as for no comment: see 147.
  if v_author is null or v_provider is null
     or (v_uid <> v_author and v_uid <> v_provider) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if p_report_reason is not null then
    -- Only the story's provider reports-and-deletes. The author has nothing to
    -- report about their own words, which report_story_comment refuses too.
    if v_uid <> v_provider then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
    end if;
    -- The reporter's lock and budget before any row, the order every report
    -- takes (section 0): a row lock held here while report_story_comment
    -- waited for the lock would cross a report that holds the lock and
    -- waits for this comment.
    perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));
    -- A retry of a report-and-delete that landed: the report and the
    -- tombstone went in together, so this is the original success. Before
    -- the tombstone test below, which is what used to answer it NOT_FOUND.
    if p_report_id is not null then
      select * into v_existing from public.reports where id = p_report_id;
      if found then
        if v_existing.reporter_id is distinct from v_uid
           or v_existing.evidence_surface is distinct from 'story_comment'
           or v_existing.evidence_target_id is distinct from p_comment_id then
          return json_build_object('success', false, 'error', 'BAD_REQUEST');
        end if;
        return json_build_object('success', true, 'report_id', v_existing.id);
      end if;
    end if;
    -- Already a tombstone: the words are gone, there is nothing to snapshot.
    if v_deleted is not null then
      return json_build_object('success', false, 'error', 'NOT_FOUND');
    end if;

    select count(*)::int into v_recent
    from public.reports
    where reporter_id = v_uid and created_at > now() - interval '1 hour';

    if v_recent >= 10 then
      return json_build_object('success', false, 'error', 'RATE_LIMITED');
    end if;
  elsif v_deleted is not null then
    -- Already gone is success, and needs no lock: a repeat delete of a
    -- tombstone, in a loop or not, holds nothing.
    return json_build_object('success', true, 'report_id', null);
  end if;

  -- Profiles, then story, then comment, the one order (report_story_comment
  -- says why). This function calls report_story_comment with the comment
  -- already locked, so locking only the comment here, as 147 did, put the
  -- story second again; and a report filed from here checks three profiles,
  -- so they go first here too, the caller's included.
  perform 1 from public.profiles
  where id in (v_uid, v_author, v_provider)
  order by id
  for key share;

  select s.provider_id into v_provider from public.stories s where s.id = v_story for share;

  select c.author_id, c.deleted_at into v_author, v_deleted
  from public.story_comments c
  where c.id = p_comment_id
  for update;

  -- Gone between the read above and the lock.
  if v_author is null or v_provider is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if p_report_reason is not null then
    if v_deleted is not null then
      return json_build_object('success', false, 'error', 'NOT_FOUND');
    end if;
    -- report_story_comment raises, as submit_report does; translated here so
    -- this function keeps its json shape. The block is a subtransaction, so a
    -- refused report leaves nothing behind and the delete below never runs.
    begin
      v_report := public.report_story_comment(
        p_comment_id, p_report_reason, p_report_detail, p_report_id);
    exception
      when no_data_found then
        return json_build_object('success', false, 'error', 'NOT_FOUND');
      when program_limit_exceeded then
        return json_build_object('success', false, 'error', 'RATE_LIMITED');
      -- The id is another account's (report_story_comment's 22023).
      when invalid_parameter_value then
        return json_build_object('success', false, 'error', 'BAD_REQUEST');
    end;
  end if;

  -- Already gone is success: the client's intent is satisfied.
  if v_deleted is null then
    update public.story_comments
    set body = null, deleted_at = now()
    where id = p_comment_id;
  end if;

  return json_build_object('success', true, 'report_id', v_report);
end;
$$;

comment on function public.delete_story_comment(uuid, public.report_reason, text, uuid) is
  'Tombstone a story comment: its author or the story''s provider only. With a '
  'report reason (the provider only), files the report first, in the same '
  'transaction, and deletes nothing if the report is refused. Idempotent, '
  'with a report on its client-minted report id; never gated on the kill '
  'switch, blocks or expiry.';

revoke all on function public.delete_story_comment(uuid, public.report_reason, text, uuid) from public, anon;
grant execute on function public.delete_story_comment(uuid, public.report_reason, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The operator's queue shows what a story report is about
-- ---------------------------------------------------------------------------
-- `create or replace`, appending seven columns after 011's twelve, which is
-- the one change replace allows. Every existing column keeps its name,
-- position and expression, so scripts/moderate.mjs (which selects the whole
-- row) gains fields and loses none.
create or replace view public.moderation_queue as
  select
    r.id,
    r.reason,
    r.status,
    r.created_at,
    r.detail,
    r.evidence_body,
    r.evidence_voice_path,
    r.subject_user_id,
    r.conversation_id,
    (select count(*) from public.reports r2
      where r2.subject_user_id = r.subject_user_id) as reports_against_subject,
    p.suspended_until,
    p.role as subject_role,
    r.story_id,
    r.story_comment_id,
    r.evidence_story_media_path,
    r.evidence_surface,
    r.evidence_context,
    r.evidence_story_provider_id,
    r.evidence_author_name
  from public.reports r
  left join public.profiles p on p.id = r.subject_user_id
  where r.status = 'open'
  -- Child safety first, whichever name it was filed under: 'minor_safety'
  -- is the older reason, 'child_safety' the one the app's taxonomy offers
  -- (026's seed, appConfig's fallback). Ordered by 'minor_safety' alone, a
  -- child-safety report sat behind every older spam report, off the bottom
  -- of `moderate list`.
  order by
    (r.reason in ('minor_safety', 'child_safety')) desc,
    (r.reason = 'self_harm') desc,
    r.created_at asc;

revoke all on public.moderation_queue from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A report's retention runs out, audit trail and all
-- ---------------------------------------------------------------------------
-- purge_expired_reports (005) is what frees a report's story media: the
-- media purge (151) keeps every object a report names, for as long as the
-- report exists. And it could not delete a report anyone had acted on.
-- moderation_actions.report_id is `on delete set null`, which Postgres runs
-- as an UPDATE of the action row, and the append-only trigger (005) refuses
-- every UPDATE; moderate.mjs writes an action row for every `act` and every
-- `dismiss`, so the first expired report that had been handled failed the
-- whole purge with 42501, and nothing was ever purged. The same set null on
-- subject_user_id refused the deletion of any account that had been the
-- subject of an action, through the profiles cascade.
--
-- So the trigger lets exactly the referential write through: reached from
-- inside the foreign key's own action (a trigger, so the depth is above one;
-- a statement a client sends is at depth one), taking report_id or
-- subject_user_id from a value to null, and changing nothing else. Every
-- other UPDATE and every DELETE is refused as before. The action row stays,
-- as the audit trail must, and says who acted and what they did; which
-- report it answered is gone with the report, as the retention says.
-- https://www.postgresql.org/docs/16/ddl-constraints.html#DDL-CONSTRAINTS-FK
-- https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-SESSION
create or replace function public.moderation_actions_are_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and (new.id, new.action, new.actor, new.note, new.created_at)
         is not distinct from (old.id, old.action, old.actor, old.note, old.created_at)
     and (new.report_id is not distinct from old.report_id
          or (old.report_id is not null and new.report_id is null))
     and (new.subject_user_id is not distinct from old.subject_user_id
          or (old.subject_user_id is not null and new.subject_user_id is null))
     and (new.report_id, new.subject_user_id)
         is distinct from (old.report_id, old.subject_user_id) then
    return new;
  end if;
  raise exception 'moderation_actions is append-only' using errcode = '42501';
end;
$$;

-- A report a moderation case points at (031, end_session's report path) is
-- kept while the case is: that reference is plain, not set null, and the
-- case is the link to its evidence, which has a retention of its own. It
-- used to fail the purge as a whole, as the action rows did.
create or replace function public.purge_expired_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.reports r
    where r.status <> 'open'
      and r.resolved_at is not null
      and r.resolved_at < now() - interval '90 days'
      and not exists (select 1 from public.moderation_cases c where c.report_id = r.id)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_reports() from public, anon, authenticated;
grant execute on function public.purge_expired_reports() to service_role;

-- ---------------------------------------------------------------------------
-- 6. An account deletion takes profiles in the one order
-- ---------------------------------------------------------------------------
-- 100's body, unchanged, behind a lock prologue (the lock order at the top
-- says why). end_session locks the session row and then, through
-- deduct_tokens (028), the member's profile FOR UPDATE; the delete then takes
-- the caller's own. With the caller the provider and the member's id the
-- higher, that is the reverse of id order, and a story report takes profiles
-- in id order. So before it ends anything, the deletion locks:
--
--   1. the caller's live sessions, oldest first, FOR UPDATE, as end_session
--      would one at a time (meter_active_sessions takes a session and then
--      its member's profile too, so sessions before profiles is the order
--      every path already has);
--   2. every profile it is going to lock: its own, and the other side of
--      each of those sessions, FOR UPDATE, in id order.
--
-- A report that already holds one of them makes the deletion wait for its
-- commit, and its snapshot survives the cascade; one that starts after waits
-- on the first profile it shares with the deletion and finds nothing left to
-- report. Neither can hold a profile the other already waits on.
-- CREATE OR REPLACE keeps the grant (002, 028, 100); section 7 of 143 leaves
-- it callable, it is a client RPC.
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-DEADLOCKS
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchased  integer;
  v_tx_id      uuid;
  v_session_id uuid;
  v_locked     uuid[];
begin
  -- 0. The lock order (above): the live sessions, then every profile. The
  --    sessions locked here are the ones step 1 ends: a session that
  --    appeared after this lock was never ordered before the profiles, so
  --    it is left to the cascade rather than locked out of order below.
  select coalesce(array_agg(id order by created_at), '{}')
  into   v_locked
  from (
    select id, created_at
    from   public.paid_sessions
    where  (member_id = auth.uid() or provider_id = auth.uid())
      and  status not in ('ended', 'reported_hold')
    order  by created_at
    for update
  ) s;

  perform 1
  from   public.profiles p
  where  p.id = auth.uid()
     or  p.id in (
           select case when ps.member_id = auth.uid() then ps.provider_id else ps.member_id end
           from   public.paid_sessions ps
           where  (ps.member_id = auth.uid() or ps.provider_id = auth.uid())
             and  ps.status not in ('ended', 'reported_hold'))
  order  by p.id
  for update;

  -- 1. End anything still running. 'system' is an accepted end_reason (091).
  --    end_session's own participant check passes because the caller IS a
  --    participant — this runs before auth.uid()'s profile is gone.
  foreach v_session_id in array v_locked loop
    perform public.end_session(v_session_id, 'system', null, null, null);
  end loop;

  -- 2. Freeze any purchased balance as an account_close_hold ledger entry and
  --    queue it for admin refund review before the cascade removes the rows.
  select purchased_balance
  into   v_purchased
  from   public.profiles
  where  id = auth.uid();

  if v_purchased > 0 then
    insert into public.token_transactions (
      user_id, kind, status, amount_paise, tokens_delta
    ) values (
      auth.uid(), 'account_close_hold', 'created',
      v_purchased * 100, -v_purchased
    )
    returning id into v_tx_id;

    insert into public.refund_reviews (
      user_id, transaction_id, purchased_tokens, amount_paise
    ) values (
      auth.uid(), v_tx_id, v_purchased, v_purchased * 100
    );
  end if;

  -- 3. The caller's story rows, by hand and before the cascade, so the
  --    deletion takes them in the order every other story path does: a
  --    story, then its views, reactions and comments, then the reports
  --    that name it. The profiles cascade runs its foreign keys in trigger
  --    order, which sets the reports to null (locking them) BEFORE it
  --    reaches stories, views and comments, the reverse of a story delete
  --    (the provider's, or purge_expired_stories): the two deadlocked, and
  --    the deletion was the one aborted (566's 20-23). With the caller's
  --    stories gone first, and their own views, reactions and comments with
  --    them, the cascade finds nothing of the stories left to lock after
  --    the reports.
  --    https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-DEADLOCKS
  delete from public.stories where provider_id = auth.uid();
  delete from public.story_views where viewer_id = auth.uid();
  delete from public.story_reactions where member_id = auth.uid();
  delete from public.story_comments where author_id = auth.uid();

  -- 4. auth.users → profiles → conversations / messages / leases / requests
  --    cascade; paid_sessions and the billing ledgers are anonymised in place.
  --    The refund_reviews row cascades via transaction_id.
  delete from auth.users where id = auth.uid();
end;
$$;

comment on function public.delete_user_account() is
  'Deletes the caller''s account (002, 028, 100, 150). Locks its live sessions '
  'and then every profile it will touch in id order, the order a story report '
  'takes (150); ends any live paid session so none is left active with a NULL '
  'participant, freezes purchased balance for refund review, deletes its own '
  'stories, views, reactions and comments in a story delete''s lock order, '
  'then deletes auth.users and lets the FK rules run: session mechanics '
  'cascade, billing records are anonymised.';
