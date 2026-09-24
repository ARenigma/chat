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
  add column if not exists evidence_story_media_path text;

comment on column public.reports.story_id is
  'The reported story, or the story a reported comment was on (150). Set null '
  'when the story expires or is deleted; the evidence columns keep what it was.';
comment on column public.reports.story_comment_id is
  'The reported story comment (150). Set null when purged.';
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
-- transaction, so delete_story_comment, which calls report_story_comment
-- (section 3), does not deadlock on itself.
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
-- 1. Reporting a story
-- ---------------------------------------------------------------------------
-- Raises rather than returning json, matching submit_report (005/011): the
-- client's report sheet already handles that function's shape, and one report
-- surface should fail one way.
create or replace function public.report_story(
  p_story_id uuid,
  p_reason   public.report_reason,
  p_detail   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_story  public.stories%rowtype;
  v_recent integer;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- Only what the reporter can actually see, so a report cannot be used to
  -- pull the caption and media path of a story they were never shown.
  if not public.story_is_visible(p_story_id) then
    raise exception 'no such story' using errcode = 'no_data_found';
  end if;

  select * into v_story from public.stories where id = p_story_id;

  if v_story.provider_id = v_uid then
    raise exception 'cannot report your own story' using errcode = '22023';
  end if;

  -- Before the count, so parallel reports cannot all see nine (section 0).
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  insert into public.reports (
    reporter_id, subject_user_id, story_id, reason, detail,
    evidence_body, evidence_story_media_path, evidence_at
  )
  values (
    v_uid, v_story.provider_id, v_story.id, p_reason, nullif(btrim(p_detail), ''),
    v_story.caption, v_story.media_path, v_story.created_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_story(uuid, public.report_reason, text) is
  'Report a story the caller can see (not their own). Snapshots the caption '
  'and media path as evidence. Shares submit_report''s 10/hour limit.';

revoke all on function public.report_story(uuid, public.report_reason, text) from public, anon;
grant execute on function public.report_story(uuid, public.report_reason, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reporting a comment
-- ---------------------------------------------------------------------------
-- Anyone who can see the comment, which includes the story's provider, and
-- never its author.
create or replace function public.report_story_comment(
  p_comment_id uuid,
  p_reason     public.report_reason,
  p_detail     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_comment public.story_comments%rowtype;
  v_recent  integer;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if not public.story_comment_is_visible(p_comment_id) then
    raise exception 'no such comment' using errcode = 'no_data_found';
  end if;

  select * into v_comment from public.story_comments where id = p_comment_id;

  if v_comment.author_id = v_uid then
    raise exception 'cannot report your own comment' using errcode = '22023';
  end if;

  -- Before the count, so parallel reports cannot all see nine (section 0).
  perform pg_advisory_xact_lock(hashtextextended('report:' || v_uid::text, 0));

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  insert into public.reports (
    reporter_id, subject_user_id, story_id, story_comment_id, reason, detail,
    evidence_body, evidence_at
  )
  values (
    v_uid, v_comment.author_id, v_comment.story_id, v_comment.id, p_reason,
    nullif(btrim(p_detail), ''), v_comment.body, v_comment.created_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_story_comment(uuid, public.report_reason, text) is
  'Report a story comment the caller can see (not their own); the story''s '
  'provider included. Snapshots the body. Shares submit_report''s 10/hour limit.';

revoke all on function public.report_story_comment(uuid, public.report_reason, text) from public, anon;
grant execute on function public.report_story_comment(uuid, public.report_reason, text) to authenticated;

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
drop function if exists public.delete_story_comment(uuid);

create or replace function public.delete_story_comment(
  p_comment_id    uuid,
  p_report_reason public.report_reason default null,
  p_report_detail text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_author   uuid;
  v_provider uuid;
  v_deleted  timestamptz;
  v_report   uuid;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select c.author_id, s.provider_id, c.deleted_at
    into v_author, v_provider, v_deleted
  from public.story_comments c
  join public.stories s on s.id = c.story_id
  where c.id = p_comment_id
  for update of c;

  if v_author is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_author and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  if p_report_reason is not null then
    -- Only the story's provider reports-and-deletes. The author has nothing to
    -- report about their own words, which report_story_comment refuses too.
    if v_uid <> v_provider then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
    end if;
    -- Already a tombstone: the words are gone, there is nothing to snapshot.
    if v_deleted is not null then
      return json_build_object('success', false, 'error', 'NOT_FOUND');
    end if;

    -- report_story_comment raises, as submit_report does; translated here so
    -- this function keeps its json shape. The block is a subtransaction, so a
    -- refused report leaves nothing behind and the delete below never runs.
    begin
      v_report := public.report_story_comment(p_comment_id, p_report_reason, p_report_detail);
    exception
      when no_data_found then
        return json_build_object('success', false, 'error', 'NOT_FOUND');
      when program_limit_exceeded then
        return json_build_object('success', false, 'error', 'RATE_LIMITED');
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

comment on function public.delete_story_comment(uuid, public.report_reason, text) is
  'Tombstone a story comment: its author or the story''s provider only. With a '
  'report reason (the provider only), files the report first, in the same '
  'transaction, and deletes nothing if the report is refused. Idempotent; '
  'never gated on the kill switch, blocks or expiry.';

revoke all on function public.delete_story_comment(uuid, public.report_reason, text) from public, anon;
grant execute on function public.delete_story_comment(uuid, public.report_reason, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The operator's queue shows what a story report is about
-- ---------------------------------------------------------------------------
-- `create or replace`, appending three columns after 011's twelve, which is
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
    r.evidence_story_media_path
  from public.reports r
  left join public.profiles p on p.id = r.subject_user_id
  where r.status = 'open'
  order by
    (r.reason = 'minor_safety') desc,
    (r.reason = 'self_harm') desc,
    r.created_at asc;

revoke all on public.moderation_queue from anon, authenticated;
