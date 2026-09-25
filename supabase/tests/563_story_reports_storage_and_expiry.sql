-- pgTAP for migrations 144, 150 and 151: reports keep their evidence, the
-- bucket and its policy hold, and the purge names exactly what should go.
--
-- The harness has no storage schema, so this file builds the smallest honest
-- stand-in for the part the migrations touch: `storage.buckets`, and
-- `storage.objects` with the columns they read, RLS on as it is on Supabase,
-- and Supabase's own protect_delete guard (0055-prevent-direct-deletes), so a
-- purge that deleted storage rows in SQL would fail here as it fails live.
-- Then it runs 144's own install_stories_bucket(), so the bucket row and the
-- policy asserted below are the ones the migration creates, exercised by real
-- INSERTs and SELECTs as `authenticated`. Created inside this transaction and
-- rolled back with it.
--
-- What the harness cannot show: the size limit and the mime list are enforced
-- by the Storage API at upload, not by Postgres, so for those the bucket row
-- is asserted (16, 18b) and the API is trusted to read it. The bytes are
-- removed by the purge-story-media Edge Function through the Storage API; here
-- that removal is stood in for by the owner, and what is asserted is the list
-- the function is given (36b-37d).
--
-- WHAT THIS IS GUARDING:
--
--   * A story or comment report captures the caption, body and media path at
--     report time, so the evidence outlives the story's day and the author's
--     delete (1-9, 12). The provider can report a comment on their own story
--     (7); a member who cannot see a comment cannot report it and so cannot
--     pull its words (8b).
--   * A reporter reads their own reports, and not who they are about: a
--     comment report's subject is the commenter's account id, which the feed
--     withholds, and the resolver's note was never theirs (6b-6d).
--   * The 10/hour limit is shared with submit_report and holds at its edge:
--     the tenth report is filed and the eleventh is not, on both story paths
--     (10a, 10, 15a, 15), and every entry point takes the reporter's lock
--     before it counts, so a burst cannot all see nine (10b).
--   * The operator queue shows what a story report is about (11).
--   * The provider's delete can report first: the words are kept, the
--     comment is erased, and a refused report deletes nothing (13-15).
--   * The bucket is private, 50 MB, the four types, with exactly one policy,
--     upload, and a replay puts a hand-edited bucket back, drafted read policy
--     included (16-18c).
--   * Upload is the listed provider's own folder, a legal name, the stories
--     bucket, and only while stories are on (19-25), and only for a provider
--     create_story would take: one who has not accepted the current policies
--     uploads nothing, and both checks read one definition (24b-24e).
--   * No client reads the bucket, so no client can sign a URL in it (26, 27);
--     the story row story-media-url authorises on is there for a live story a
--     member may see and for nobody blocked (28, 29).
--   * create_story refuses media that was never uploaded or whose content
--     type is not what its name says (30-32).
--   * The purge: a direct DELETE is refused (33); the purge deletes expired
--     rows with everything hanging off them and no storage row at all (34-36);
--     it names exactly the objects to remove, a deleted story's at once and an
--     abandoned upload's after a day, never a live, reported or in-flight one
--     or another bucket's (36b-37); what it hands the Edge Function is claimed
--     first, and a claimed upload can no longer be posted (37a-37a3); a
--     removed object's name is kept for a day after its claim and then
--     forgotten, while a reported one's is kept (37b-37d); and no client can
--     run any of it or read its queue (38-38e).
--   * A story id whose media was released is never posted again, under its
--     own name or another, so a retried create_story cannot point a live row
--     at an object the purge is removing; an old upload posted before any
--     claim is left alone by the next one; and the lock that orders a create
--     against a claim is pinned (37e-37i).
--   * Comment reports lock the story and then the comment, the order a story
--     delete takes them in, so the two cannot deadlock (39h-39j); and every
--     report path locks the profiles its insert checks before either, the
--     order an account deletion takes them in (39k; driven in 566).
--   * Both kinds of report say whose story it was, past the purge (12d, 12e).
--   * An expired story's media is named before the hourly sweep (33b).
--   * No server-only story function is callable by a client under the hosted
--     project's default function grants, is_blocked_pair included (39l-39n).
--   * With stories switched off, posting stops and reporting, removal and
--     blocking a commenter do not (40-43b).
--   * No report path locks a row for a call it will refuse: the budget and
--     what the caller may see come first, and delete_story_comment refuses a
--     stranger before any lock (39o-39q; driven in 566). report_story holds
--     the purge lock shared across its checks and its insert, so a claim
--     cannot hand out the media it is about to name (39k2; driven in 566),
--     and a story whose media was claimed cannot be reported with it (37j).
--   * A resolved report past its retention is purged although an action row
--     names it, freeing the media it held, and one a moderation case keeps
--     stays; the action rows stay too, their references set null, which is
--     also what lets a moderated account be deleted. Nothing else may write
--     them, from a client or from inside another trigger (44-49d).

\set ON_ERROR_STOP on
begin;
select plan(116);

-- ── The storage stand-in ───────────────────────────────────────────────────
create schema storage;
create table storage.buckets (
  id                 text        primary key,
  name               text        not null,
  public             boolean     not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);
create table storage.objects (
  id         uuid        primary key default gen_random_uuid(),
  bucket_id  text        not null,
  name       text        not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  metadata   jsonb
);
alter table storage.objects enable row level security;
create function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
      using errcode = '42501';
  end if;
  return null;
end;
$$;
create trigger protect_objects_delete
  before delete on storage.objects
  for each statement execute function storage.protect_delete();
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;

-- 144's own installer, now that there is a storage schema for it to find.
select public.install_stories_bucket();

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c5630000-0000-4563-8000-000000000001'),  -- member A, comments
  ('c5630000-0000-4563-8000-000000000002'),  -- member B, reports
  ('c5630000-0000-4563-8000-000000000003'),  -- member, blocked with P
  ('c5630000-0000-4563-8000-000000000010'),  -- provider P, listed
  ('c5630000-0000-4563-8000-000000000011'),  -- provider, not listed
  ('c5630000-0000-4563-8000-000000000012'),  -- provider, listed, no policies
  ('c5630000-0000-4563-8000-000000000004'),  -- member D, comments while stories are off
  ('c5630000-0000-4563-8000-000000000005'),  -- member E, reports while stories are off
  ('c5630000-0000-4563-8000-000000000013');  -- provider P3, listed, for the off window

update public.profiles
set display_name = 'quiet_lark', avatar_url = 'clay:bloom', profile_completed_at = now()
where id = 'c5630000-0000-4563-8000-000000000001';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider563-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = case
         when id = 'c5630000-0000-4563-8000-000000000011' then null else now() end
where  id in ('c5630000-0000-4563-8000-000000000010',
              'c5630000-0000-4563-8000-000000000011',
              'c5630000-0000-4563-8000-000000000012',
              'c5630000-0000-4563-8000-000000000013');

select test.accept_current_policies(id)
from public.profiles
where id::text like 'c5630000-%'
  and id <> 'c5630000-0000-4563-8000-000000000012';

insert into public.blocks (blocker_id, blocked_id) values
  ('c5630000-0000-4563-8000-000000000010', 'c5630000-0000-4563-8000-000000000003');

-- a1 is reported and later deleted by P; a2 stays live; a3 has expired;
-- a4 is deleted by P, unreported.
insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms, created_at, expires_at)
values
  ('c5630000-0000-4563-8000-0000000000a1', 'c5630000-0000-4563-8000-000000000010', 'image',
   'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a1.jpg', 'look at this', 7000,
   now() - interval '2 hours', now() + interval '22 hours'),
  ('c5630000-0000-4563-8000-0000000000a2', 'c5630000-0000-4563-8000-000000000010', 'video',
   'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a2.mp4', null, 12000,
   now() - interval '1 hour', now() + interval '23 hours'),
  ('c5630000-0000-4563-8000-0000000000a3', 'c5630000-0000-4563-8000-000000000010', 'image',
   'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a3.png', null, 7000,
   now() - interval '26 hours', now() - interval '2 hours'),
  -- a4 is live, never reported, and deleted by P before the purge.
  ('c5630000-0000-4563-8000-0000000000a4', 'c5630000-0000-4563-8000-000000000010', 'image',
   'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a4.jpg', null, 7000,
   now() - interval '1 hour', now() + interval '23 hours');

-- a5 and a6 are P3's, for the switched-off window at the end: a5 carries
-- D's comments c5 and c6, a6 is deleted by P3 while stories are off.
insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms, created_at, expires_at)
values
  ('c5630000-0000-4563-8000-0000000000a5', 'c5630000-0000-4563-8000-000000000013', 'image',
   'c5630000-0000-4563-8000-000000000013/c5630000-0000-4563-8000-0000000000a5.jpg', 'still here', 7000,
   now() - interval '1 hour', now() + interval '23 hours'),
  ('c5630000-0000-4563-8000-0000000000a6', 'c5630000-0000-4563-8000-000000000013', 'image',
   'c5630000-0000-4563-8000-000000000013/c5630000-0000-4563-8000-0000000000a6.jpg', null, 7000,
   now() - interval '1 hour', now() + interval '23 hours');

-- c1 is reported, then deleted by its author; c2 and c3 are for the
-- provider's report-and-delete.
insert into public.story_comments (id, story_id, author_id, body)
values
  ('c5630000-0000-4563-8000-0000000000c1', 'c5630000-0000-4563-8000-0000000000a1',
   'c5630000-0000-4563-8000-000000000001', 'something awful'),
  ('c5630000-0000-4563-8000-0000000000c2', 'c5630000-0000-4563-8000-0000000000a2',
   'c5630000-0000-4563-8000-000000000001', 'something worse'),
  ('c5630000-0000-4563-8000-0000000000c3', 'c5630000-0000-4563-8000-0000000000a2',
   'c5630000-0000-4563-8000-000000000001', 'and again'),
  ('c5630000-0000-4563-8000-0000000000c5', 'c5630000-0000-4563-8000-0000000000a5',
   'c5630000-0000-4563-8000-000000000004', 'reported while off'),
  ('c5630000-0000-4563-8000-0000000000c6', 'c5630000-0000-4563-8000-0000000000a5',
   'c5630000-0000-4563-8000-000000000004', 'deleted while off');

-- The expired story has an audience, so the purge has cascades to prove.
insert into public.story_views (story_id, viewer_id)
values ('c5630000-0000-4563-8000-0000000000a3', 'c5630000-0000-4563-8000-000000000001');
insert into public.story_reactions (story_id, member_id, emoji)
values ('c5630000-0000-4563-8000-0000000000a3', 'c5630000-0000-4563-8000-000000000001',
        chr(10084) || chr(65039));
insert into public.story_comments (story_id, author_id, body)
values ('c5630000-0000-4563-8000-0000000000a3', 'c5630000-0000-4563-8000-000000000001', 'old news');

-- ── Reporting a story ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';

insert into test.fixture (k, v)
select 'r_story', public.report_story('c5630000-0000-4563-8000-0000000000a1', 'harassment', ' mean ');

select isnt(
  (select v from test.fixture where k = 'r_story'),
  null,
  '1. a member reports a story they can see'
);

reset role;
select is(
  (select subject_user_id || '|' || story_id || '|' || evidence_body || '|'
          || evidence_story_media_path || '|' || detail
   from public.reports where id = (select v from test.fixture where k = 'r_story')),
  'c5630000-0000-4563-8000-000000000010|c5630000-0000-4563-8000-0000000000a1|look at this|'
  || 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a1.jpg|mean',
  '2. the report names the provider and snapshots the caption and media path'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story('c5630000-0000-4563-8000-0000000000a1', 'spam') $$,
  '22023',
  null,
  '3. a provider cannot report their own story'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story('c5630000-0000-4563-8000-0000000000a1', 'spam') $$,
  'P0002',
  null,
  '4. a story the caller cannot see cannot be reported, so its evidence cannot be pulled'
);

-- ── Reporting a comment ────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'r_comment', public.report_story_comment('c5630000-0000-4563-8000-0000000000c1', 'hate_speech');

select isnt(
  (select v from test.fixture where k = 'r_comment'),
  null,
  '5. a member reports another member''s comment'
);

reset role;
select is(
  (select subject_user_id || '|' || story_comment_id || '|' || evidence_body
   from public.reports where id = (select v from test.fixture where k = 'r_comment')),
  'c5630000-0000-4563-8000-000000000001|c5630000-0000-4563-8000-0000000000c1|something awful',
  '6. the comment report names its author and snapshots the words'
);

-- The reporter's own row does not hand that author back: the feed never
-- gives a stranger a commenter's account id (148), and before 150 narrowed
-- the grant, subject_user_id on the reporter's own report did.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select subject_user_id from public.reports $$,
  '42501',
  null,
  '6b. a reporter cannot read who their report is about, a commenter''s account id included'
);
select throws_ok(
  $$ select resolver_note from public.reports $$,
  '42501',
  null,
  '6c. ...nor the resolver''s note, which 005 never meant them to see'
);
select is(
  (select count(*)::int from public.my_reports),
  2,
  '6d. ...and still sees both reports, and their status, through my_reports'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select isnt(
  public.report_story_comment('c5630000-0000-4563-8000-0000000000c1', 'harassment'),
  null,
  '7. the provider reports a comment on their own story'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story_comment('c5630000-0000-4563-8000-0000000000c1', 'spam') $$,
  '22023',
  null,
  '8. nobody reports their own comment'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story_comment('c5630000-0000-4563-8000-0000000000c1', 'spam') $$,
  'P0002',
  null,
  '8b. a member who cannot see a comment cannot report it, so its words cannot be pulled'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000001","role":"authenticated"}';

-- The author deletes the comment; the report still holds the words.
select public.delete_story_comment('c5630000-0000-4563-8000-0000000000c1');
reset role;
select is(
  (select evidence_body from public.reports where id = (select v from test.fixture where k = 'r_comment')),
  'something awful',
  '9. deleting the comment does not delete the evidence'
);

-- Seven more of B's reports in the last hour, filed through the conversation
-- path's table: the limit is one budget across both. With 1 and 5 that is
-- nine, so the edge is the next two.
insert into public.reports (reporter_id, reason, created_at)
select 'c5630000-0000-4563-8000-000000000002', 'spam', now() - interval '10 minutes'
from generate_series(1, 7);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';
select isnt(
  public.report_story('c5630000-0000-4563-8000-0000000000a2', 'spam'),
  null,
  '10a. the tenth report in an hour is filed'
);
select throws_ok(
  $$ select public.report_story_comment('c5630000-0000-4563-8000-0000000000c2', 'spam') $$,
  '54000',
  null,
  '10. the eleventh is refused, counting every kind'
);

-- The count cannot hold under concurrency by itself (READ COMMITTED), so the
-- lock is what makes it a limit. Asserted on the function text because one
-- session cannot race itself: each entry point takes the reporter's lock, and
-- takes it before it counts.
reset role;
select is(
  (select string_agg(
            f::regproc::text || ':'
            || (position('pg_advisory_xact_lock(hashtextextended(''report:'' || v_uid::text, 0))'
                         in pg_get_functiondef(f)) > 0
                and position('pg_advisory_xact_lock' in pg_get_functiondef(f))
                    < position('count(*)' in pg_get_functiondef(f)))::text,
            ',' order by f::regproc::text)
   from unnest(array[
     'public.submit_report(uuid, uuid, public.report_reason, text)'::regprocedure,
     'public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure,
     'public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure
   ]) f),
  'report_story:true,report_story_comment:true,submit_report:true',
  '10b. every report entry point takes the one reporter lock before it counts'
);

reset role;
select is(
  (select story_id || '|' || evidence_story_media_path from public.moderation_queue
   where id = (select v from test.fixture where k = 'r_story')),
  'c5630000-0000-4563-8000-0000000000a1|c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a1.jpg',
  '11. the operator queue shows which story and which object a report is about'
);

-- The provider takes the reported story down.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
delete from public.stories where id = 'c5630000-0000-4563-8000-0000000000a1';

reset role;
select is(
  (select coalesce(story_id::text, 'null') || '|' || evidence_body
   from public.reports where id = (select v from test.fixture where k = 'r_story')),
  'null|look at this',
  '12. the report outlives the story it is about'
);
select is(
  (select evidence_surface || '|' || coalesce(story_comment_id::text, 'null') || '|'
          || evidence_body || '|' || evidence_context
   from public.reports where id = (select v from test.fixture where k = 'r_comment')),
  'story_comment|null|something awful|look at this',
  '12b. a comment report still says it was a comment, with its words and the story caption, once the story is gone'
);
select is(
  (select evidence_story_media_path
   from public.reports where id = (select v from test.fixture where k = 'r_comment')),
  null,
  '12c. a comment report keeps no copy of the provider''s story media'
);
select is(
  (select string_agg(coalesce(evidence_target_id::text, 'null'), ',' order by evidence_surface)
   from public.reports
   where id in ((select v from test.fixture where k = 'r_story'), (select v from test.fixture where k = 'r_comment'))),
  'c5630000-0000-4563-8000-0000000000a1,c5630000-0000-4563-8000-0000000000c1',
  '12d. each report keeps the id it was about after the story is gone, for its retries'
);
select is(
  (select string_agg(coalesce(r.evidence_story_provider_id::text, 'null'), ',' order by f.k)
   from test.fixture f join public.reports r on r.id = f.v
   where f.k in ('r_comment', 'r_story')),
  'c5630000-0000-4563-8000-000000000010,c5630000-0000-4563-8000-000000000010',
  '12d. both kinds of report still say whose story it was once the story is gone'
);
select is(
  (select evidence_story_provider_id from public.moderation_queue
   where id = (select v from test.fixture where k = 'r_comment')),
  'c5630000-0000-4563-8000-000000000010'::uuid,
  '12e. ...and the operator queue shows it'
);

-- ── The provider's report-and-delete ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000001","role":"authenticated"}';
select is(
  public.delete_story_comment('c5630000-0000-4563-8000-0000000000c2', 'spam') ->> 'error',
  'FORBIDDEN',
  '13. the author cannot attach a report to deleting their own comment'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
insert into test.fixture (k, v)
select 'r_delete',
       (public.delete_story_comment('c5630000-0000-4563-8000-0000000000c2', 'harassment', 'again')
        ->> 'report_id')::uuid;

reset role;
select is(
  (select r.subject_user_id || '|' || r.evidence_body || '|' || r.detail || '|'
          || coalesce(c.body, 'erased') || '|' || (c.deleted_at is not null)
   from public.reports r
   join public.story_comments c on c.id = r.story_comment_id
   where r.id = (select v from test.fixture where k = 'r_delete')),
  'c5630000-0000-4563-8000-000000000001|something worse|again|erased|true',
  '14. the provider''s delete files the report first: the words are kept, the comment is gone'
);

-- P's budget at its edge: 7 above, 14 above, and seven more is nine, so the
-- tenth, a plain comment report, is filed; then the budget is spent, the
-- report is refused, and so is the delete it was attached to.
insert into public.reports (reporter_id, reason, created_at)
select 'c5630000-0000-4563-8000-000000000010', 'spam', now() - interval '10 minutes'
from generate_series(1, 7);

set local role authenticated;
select isnt(
  public.report_story_comment('c5630000-0000-4563-8000-0000000000c3', 'spam'),
  null,
  '15a. the provider''s tenth report in an hour is filed'
);
-- The answer is kept and the comment read in a LATER statement. Read in the
-- same one, the feed ran on that statement's snapshot, which cannot see the
-- delete's own write, so a delete that tombstoned and still answered
-- RATE_LIMITED passed (it did, under that mutation).
select set_config(
  'test.delete_c3',
  public.delete_story_comment('c5630000-0000-4563-8000-0000000000c3', 'harassment') ->> 'error',
  true
);
reset role;
select is(
  current_setting('test.delete_c3') || '|'
  || (select coalesce(body, 'erased') || '|' || (deleted_at is null)::text
      from public.story_comments where id = 'c5630000-0000-4563-8000-0000000000c3'),
  'RATE_LIMITED|and again|true',
  '15. a refused report deletes nothing, so the evidence is never lost to it'
);
set local role authenticated;

-- ── The bucket and its policy ──────────────────────────────────────────────
reset role;
select is(
  (select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
   from storage.buckets where id = 'stories'),
  'false|52428800|image/jpeg,image/png,image/webp,video/mp4',
  '16. the stories bucket is private, 50 MB, and takes the four story types only'
);
select is(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname)
   from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'Listed providers upload own stories:INSERT',
  '17. exactly one policy, upload: no SELECT, so no client signs a URL; no UPDATE or DELETE'
);

-- The replay is the ON CONFLICT branch, which a first install never takes.
-- Hand-edit the bucket and put back the draft's read policy first, so the
-- replay has something to undo.
update storage.buckets
set public = true, file_size_limit = 1, allowed_mime_types = array['image/gif']
where id = 'stories';
create policy "Viewers read visible stories"
  on storage.objects for select to authenticated
  using (bucket_id = 'stories');
select lives_ok(
  $$ select public.install_stories_bucket() $$,
  '18. installing the bucket again succeeds, as a replayed migration must'
);
select is(
  (select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',')
   from storage.buckets where id = 'stories'),
  'false|52428800|image/jpeg,image/png,image/webp,video/mp4',
  '18b. ...and puts a hand-edited bucket back: private, 50 MB, the four types'
);
select is(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname)
   from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'Listed providers upload own stories:INSERT',
  '18c. ...and drops the draft''s client read policy'
);

-- ── Upload, through the INSERT policy ──────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, metadata)
     values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b1.mp4',
             'c5630000-0000-4563-8000-000000000010', '{"mimetype":"video/mp4"}') $$,
  '19. a listed provider uploads into their own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000001/c5630000-0000-4563-8000-0000000000b1.mp4') $$,
  '42501',
  null,
  '20. ...not into anyone else''s'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b1.gif') $$,
  '42501',
  null,
  '21. ...not under a name no story could have'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('avatars', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b1.mp4') $$,
  '42501',
  null,
  '22. ...and the stories policy opens no other bucket'
);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000001/c5630000-0000-4563-8000-0000000000b1.jpg') $$,
  '42501',
  null,
  '23. a member cannot use the bucket at all'
);
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000011","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000011/c5630000-0000-4563-8000-0000000000b1.jpg') $$,
  '42501',
  null,
  '24. nor can a provider who is not listed'
);

-- Listed, verified, and has not accepted the current terms: create_story has
-- always refused them, and the bucket took their upload anyway, because its
-- predicate repeated the listing and kill-switch checks by hand and not the
-- policy gate (Greptile P1 on bb32af4).
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000012","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000012/c5630000-0000-4563-8000-0000000000b1.jpg') $$,
  '42501',
  null,
  '24b. nor can a listed provider who has not accepted the current policies'
);
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b1', 'image',
    'c5630000-0000-4563-8000-000000000012/c5630000-0000-4563-8000-0000000000b1.jpg'
  ) ->> 'error',
  'POLICY_REQUIRED',
  '24c. ...whom create_story refuses for the same reason'
);

reset role;
-- One definition, so the two cannot drift again: both call it, and neither
-- repeats any part of it.
select is(
  (select string_agg(
            f::regproc::text || ':'
            || (position('public.story_post_refusal()' in pg_get_functiondef(f)) > 0)::text || '/'
            || (pg_get_functiondef(f) ~ 'provider_is_listed|user_has_accepted_current_policies|stories_enabled|suspended_until')::text,
            ',' order by f::regproc::text)
   from unnest(array[
     'public.create_story(uuid, text, text, text, integer)'::regprocedure,
     'public.story_media_upload_allowed(text)'::regprocedure
   ]) f),
  'create_story:true/false,story_media_upload_allowed:true/false',
  '24d. create_story and the upload policy both ask story_post_refusal, and neither keeps a copy of it'
);
select ok(
  not has_function_privilege('authenticated', 'public.story_post_refusal()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.story_post_refusal()', 'EXECUTE'),
  '24e. story_post_refusal is not a client RPC'
);

reset role;
update admin.config_active
set payload = payload || '{"stories_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b7.mp4') $$,
  '42501',
  null,
  '25. nothing is uploaded while stories are switched off'
);
reset role;
update admin.config_active
set payload = payload - 'stories_enabled'
where domain = 'kill_switches' and environment = 'prod';

-- ── Read: nobody, and the one row the signer checks ────────────────────────
-- Every case the purge below also needs, inserted as the owner.
insert into storage.objects (bucket_id, name, created_at, metadata) values
  -- a live story's media: kept
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a2.mp4',
   now() - interval '1 hour', '{"mimetype":"video/mp4"}'),
  -- the expired story's media: removed
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a3.png',
   now() - interval '26 hours', '{"mimetype":"image/png"}'),
  -- the deleted, REPORTED story's media: kept as evidence
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a1.jpg',
   now() - interval '25 hours', '{"mimetype":"image/jpeg"}'),
  -- a story deleted before the purge, never reported, an hour old: removed
  -- at once, without waiting out 24 hours
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a4.jpg',
   now() - interval '1 hour', '{"mimetype":"image/jpeg"}'),
  -- an abandoned upload: removed
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b8.jpg',
   now() - interval '30 hours', '{"mimetype":"image/jpeg"}'),
  -- an upload still in flight: kept
  ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b9.jpg',
   now() - interval '5 minutes', '{"mimetype":"image/jpeg"}'),
  -- somebody else's bucket: never named
  ('attachments', 'c5630000-0000-4563-8000-0000000000cc/c5630000-0000-4563-8000-0000000000dd.jpg',
   now() - interval '30 hours', '{"mimetype":"image/jpeg"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects),
  0,
  '26. a member can read no object at all, so there is nothing a client could sign'
);
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'stories'),
  0,
  '27. nor can the provider, their own included: story-media-url signs for everyone'
);

-- What story-media-url authorises on instead: the stories row, read with the
-- caller's own JWT. Live and visible gives the path; anything else, nothing.
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000002","role":"authenticated"}';
select is(
  (select string_agg(right(media_path, 10), ',' order by media_path) from public.stories
   where provider_id = 'c5630000-0000-4563-8000-000000000010'),
  '0000a2.mp4,0000a4.jpg',
  '28. a member gets the path of each live story, and none for the expired or deleted ones'
);
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories
   where provider_id = 'c5630000-0000-4563-8000-000000000010'),
  0,
  '29. a member blocked with the provider gets no row, so nothing is signed for them'
);
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';

-- ── create_story needs the object, of the type its name says ───────────────
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b2', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b2.jpg'
  ) ->> 'error',
  'MEDIA_MISSING',
  '30. a story cannot point at media that was never uploaded'
);

-- An mp4 uploaded under a .jpg name: the bucket takes video/mp4 under any name.
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b2.jpg',
        'c5630000-0000-4563-8000-000000000010', '{"mimetype":"video/mp4"}');
set local role authenticated;
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b2', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b2.jpg'
  ) ->> 'error',
  'MEDIA_MISMATCH',
  '31. a video uploaded under an image name cannot become an image story'
);

reset role;
update storage.objects set metadata = '{"mimetype":"image/jpeg"}'
where name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b2.jpg';
set local role authenticated;
select is(
  (public.create_story(
    'c5630000-0000-4563-8000-0000000000b2', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b2.jpg'
  ) ->> 'success')::boolean,
  true,
  '32. ...and a JPEG under the same name is posted'
);

-- ── The purge ──────────────────────────────────────────────────────────────
reset role;
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'attachments' $$,
  '42501',
  null,
  '33. a plain DELETE on storage.objects is refused, as it is live'
);

-- P deletes a4, which was never reported: its name is released at once.
set local role authenticated;
delete from public.stories where id = 'c5630000-0000-4563-8000-0000000000a4';
reset role;

-- Before the hourly sweep: the expired story's row is still there, and its
-- object is named anyway. An expired row used to shield its object until the
-- sweep, up to about 70 minutes past the 24 hours, and deleting the object is
-- the only thing that stops a CDN-cached signed URL (story-media-url).
select is(
  (select string_agg(right(t.object_name, 10), ',' order by t.ordinality) from public.story_objects_to_purge(1000) with ordinality as t)
  || '|' || (select count(*) from public.stories where id = 'c5630000-0000-4563-8000-0000000000a3'),
  '0000b8.jpg,0000a3.png,0000a4.jpg|1',
  '33b. an expired story''s media is named before the sweep reaches its row; a live or reported story''s is not'
);

select is(
  public.purge_expired_stories()::jsonb,
  '{"stories": 1, "forgotten": 0}'::jsonb,
  '34. the purge removes the one expired story'
);

select is(
  (select count(*)::int from public.story_views where story_id = 'c5630000-0000-4563-8000-0000000000a3')
  + (select count(*)::int from public.story_reactions where story_id = 'c5630000-0000-4563-8000-0000000000a3')
  + (select count(*)::int from public.story_comments where story_id = 'c5630000-0000-4563-8000-0000000000a3'),
  0,
  '35. its views, reactions and comments went with it'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'stories'),
  8,
  '36. and it deleted no storage row: in SQL that would orphan the bytes'
);

-- The list purge-story-media removes through the Storage API, oldest first.
select is(
  (select string_agg(right(t.object_name, 10), ',' order by t.ordinality)
   from public.story_objects_to_purge(1000) with ordinality as t),
  '0000b8.jpg,0000a3.png,0000a4.jpg',
  '36b. named: the abandoned upload, the expired story''s, and the deleted story''s at once'
);
select is(
  (select string_agg(right(t.object_name, 10), ',' order by t.ordinality)
   from public.story_objects_to_purge(1) with ordinality as t),
  '0000b8.jpg',
  '36c. a page is the limit asked for, oldest first'
);
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'attachments'
     and name in (select object_name from public.story_objects_to_purge(1000))),
  0,
  '37. another bucket''s objects are never named'
);

-- What the Edge Function actually calls: the same list, claimed. Each name
-- is recorded as released before it is handed out, the abandoned upload's
-- included, which had no story to release it.
select is(
  (select string_agg(right(t.object_name, 10), ',' order by t.ordinality)
   from public.claim_story_objects_to_purge(1000) with ordinality as t),
  '0000b8.jpg,0000a3.png,0000a4.jpg',
  '37a. the claim hands out exactly the list'
);
select is(
  (select string_agg(right(name, 10), ',' order by name) from public.story_media_released),
  '0000a1.jpg,0000a3.png,0000a4.jpg,0000b8.jpg',
  '37a2. ...and records every name it handed out, the abandoned upload''s too'
);

-- The day-old upload was never posted. Posting it now, between the claim and
-- the remove(), is the create that used to land in the gap: it would have
-- succeeded, and the Edge Function would then have deleted a live story's
-- media (Greptile P1 on bb32af4).
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b8', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b8.jpg'
  ) ->> 'error',
  'MEDIA_RELEASED',
  '37a3. an upload the purge has claimed can no longer be posted'
);
reset role;

-- The Storage API's removal, stood in for by the owner: it deletes the rows
-- (and, live, the bytes) of exactly the names it was given.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'stories'
  and name in (select object_name from public.story_objects_to_purge(1000));

-- Not yet forgotten: two purge runs can overlap, and one still holding a
-- claim could otherwise remove a new upload under a name forgotten the
-- moment the other run's remove() landed.
select is(
  public.purge_expired_stories()::jsonb,
  '{"stories": 0, "forgotten": 0}'::jsonb,
  '37b. a removed object''s name is kept for a day after its last claim'
);
update public.story_media_released set released_at = released_at - interval '25 hours';
select is(
  public.purge_expired_stories()::jsonb,
  '{"stories": 0, "forgotten": 3}'::jsonb,
  '37b2. ...and then forgotten, all three whose objects are gone'
);
select is(
  (select string_agg(right(name, 10), ',') from public.story_media_released),
  '0000a1.jpg',
  '37c. ...and the reported story''s kept, whose object the report still holds'
);
select is(
  (select count(*)::int from public.story_objects_to_purge(1000)),
  0,
  '37d. nothing is left to name: live, reported, in-flight and new uploads all stay'
);

-- A report on a story whose media the purge has claimed is refused: the
-- object may be gone from the bucket already, and a report naming it would
-- promise evidence that is not there. (A claim only takes an expired or
-- deleted story's media; the name is planted here on a live one so the
-- check itself is what refuses.)
insert into public.story_media_released (name)
values ('c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a2.mp4');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story('c5630000-0000-4563-8000-0000000000a2', 'spam') $$,
  'P0002',
  null,
  '37j. a story whose media the purge already claimed cannot be reported with that media as evidence'
);
reset role;
delete from public.story_media_released
where name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000a2.mp4';

-- ── A released story id is never posted again ─────────────────────────────
-- The P1 exactly: a story is posted and deleted, and a retry of the create
-- that made it arrives while the purge is removing its media. The object is
-- still there, so before the fix the retry made a new live row on it.
insert into storage.objects (bucket_id, name, owner, metadata)
values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.jpg',
        'c5630000-0000-4563-8000-000000000010', '{"mimetype":"image/jpeg"}');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000010","role":"authenticated"}';
insert into test.fixture (k, v)
select 'b3_first', (public.create_story(
  'c5630000-0000-4563-8000-0000000000b3', 'image',
  'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.jpg'
) ->> 'story_id')::uuid;
delete from public.stories where id = 'c5630000-0000-4563-8000-0000000000b3';
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b3', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.jpg'
  ) ->> 'error',
  'MEDIA_RELEASED',
  '37e. a retried create_story cannot bring a deleted story back onto its media'
);

reset role;
select is(
  (select v::text from test.fixture where k = 'b3_first')
  || '|' || (select count(*)::int from public.stories where id = 'c5630000-0000-4563-8000-0000000000b3')
  || '|' || (select count(*)::int from public.story_objects_to_purge(1000)
             where object_name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.jpg'),
  'c5630000-0000-4563-8000-0000000000b3|0|1',
  '37f. ...so the object the purge names has no story, and removing it takes nothing live'
);

-- The same id under another name: a fresh object, but still the story the
-- provider deleted.
insert into storage.objects (bucket_id, name, owner, metadata)
values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.png',
        'c5630000-0000-4563-8000-000000000010', '{"mimetype":"image/png"}');
set local role authenticated;
select is(
  public.create_story(
    'c5630000-0000-4563-8000-0000000000b3', 'image',
    'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b3.png'
  ) ->> 'error',
  'MEDIA_RELEASED',
  '37g. nor can the deleted story''s id be posted again under another file name'
);

-- An upload over a day old that no claim has reached yet is still a story's
-- to post; and once posted, the next claim leaves it alone.
reset role;
insert into storage.objects (bucket_id, name, owner, created_at, metadata)
values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b4.jpg',
        'c5630000-0000-4563-8000-000000000010', now() - interval '30 hours', '{"mimetype":"image/jpeg"}');
set local role authenticated;
insert into test.fixture (k, v)
select 'b4', (public.create_story(
  'c5630000-0000-4563-8000-0000000000b4', 'image',
  'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b4.jpg'
) ->> 'story_id')::uuid;
reset role;
select is(
  (select v::text from test.fixture where k = 'b4')
  || '|' || (select count(*)::int from public.claim_story_objects_to_purge(1000)
             where object_name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000b4.jpg'),
  'c5630000-0000-4563-8000-0000000000b4|0',
  '37h. an old upload posted before any claim is a live story''s, and the claim does not name it'
);

-- Whichever of a create and a claim commits first, the other must see it,
-- and one session cannot race itself: pin the lock in both definitions. The
-- claim takes it exclusively before it lists and records; create_story takes
-- it shared before it asks whether the name is released and before it writes.
select is(
  (select string_agg(
            f::regproc::text || ':' || (
              position(l in pg_get_functiondef(f)) > 0
              and position(l in pg_get_functiondef(f)) < position(a in pg_get_functiondef(f))
              and position(a in pg_get_functiondef(f)) < position(b in pg_get_functiondef(f)))::text,
            ',' order by f::regproc::text)
   from (values
     ('public.create_story(uuid, text, text, text, integer)'::regprocedure,
      'pg_advisory_xact_lock_shared(hashtextextended(''story_media_purge'', 0))',
      'select 1 from public.story_media_released m',
      'insert into public.stories ('),
     ('public.claim_story_objects_to_purge(integer)'::regprocedure,
      'pg_advisory_xact_lock(hashtextextended(''story_media_purge'', 0))',
      'from public.story_objects_to_purge(p_limit)',
      'insert into public.story_media_released (name)')
   ) as t(f, l, a, b)),
  'claim_story_objects_to_purge:true,create_story:true',
  '37i. a create and a claim take the one purge lock before they decide'
);

set local role authenticated;
select throws_ok(
  $$ select public.purge_expired_stories() $$,
  '42501',
  null,
  '38. no client can run the purge'
);
select throws_ok(
  $$ select * from public.story_objects_to_purge(1000) $$,
  '42501',
  null,
  '38b. nor list what it would remove'
);
select throws_ok(
  $$ select public.dispatch_story_media_purge() $$,
  '42501',
  null,
  '38c. nor call the Edge Function'
);
select throws_ok(
  $$ select count(*) from public.story_media_released $$,
  '42501',
  null,
  '38d. nor read which stories were deleted'
);
select throws_ok(
  $$ select * from public.claim_story_objects_to_purge(1000) $$,
  '42501',
  null,
  '38e. nor claim names for removal'
);

reset role;

-- A report racing the author's delete must carry the text or be refused;
-- one session cannot race itself, so pin the order in the definition. The
-- check that decides is the one UNDER the lock (the unlocked one before it
-- only spares a caller who could not report from taking a lock, 39p).
select ok(
  (select position('for share' in d) > 0
      and position('for share' in d) < position('or v_comment.deleted_at is not null' in d)
      and d ~ 'or v_comment\.deleted_at is not null\s+or not public\.story_comment_is_reportable\(p_comment_id\) then'
      and position('for share' in d) < position('insert into public.reports' in d)
   from (select pg_get_functiondef('public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39f. report_story_comment locks the comment before its last check and before reading it'
);
select ok(
  (select position('for share' in d) > 0
      and position('for share' in d) < position('if not found or not public.story_is_reportable(p_story_id) then' in d)
      and position('for share' in d) < position('insert into public.reports' in d)
   from (select pg_get_functiondef('public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39g. report_story locks the story before its last check and before reading it'
);

-- One lock order for a story and its comments: the story, then the comment,
-- which is the order a story's delete takes them in (the row, then its
-- comments through the cascade). report_story_comment used to lock the
-- comment and then the story, and a report and a delete of the same story
-- could deadlock (Greptile P1 on bb32af4). The FIRST row lock in each
-- definition is the story's, and the comment's comes after it.
select ok(
  (select position('for share' in d) > 0
      and position('for share' in d)
          = position('from public.stories where id = v_story for share' in d)
            + length('from public.stories where id = v_story ')
      and position('for update' in d) = 0
      and position('from public.story_comments where id = p_comment_id for share' in d)
          > position('from public.stories where id = v_story for share' in d)
      and position('from public.story_comments where id = p_comment_id for share' in d)
          < position('or v_comment.deleted_at is not null' in d)
   from (select pg_get_functiondef('public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39h. report_story_comment locks the story, then the comment'
);
select ok(
  (select position('for share' in d) > 0
      and position('for share' in d)
          = position('from public.stories s where s.id = v_story for share' in d)
            + length('from public.stories s where s.id = v_story ')
      and position('for update' in d)
          > position('from public.stories s where s.id = v_story for share' in d)
      and position('public.report_story_comment(' in d) > position('for update' in d)
   from (select pg_get_functiondef('public.delete_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39i. delete_story_comment locks the story, then the comment, before it files a report'
);
select ok(
  (select position('for share of s' in d) > 0
      and position('for share of s' in d) < position('deleted_at is null
  for share' in d)
   from (select pg_get_functiondef('public.react_to_story_comment(uuid, text)'::regprocedure) as d) f),
  '39j0. react_to_story_comment locks the story, then the live comment'
);
-- And those are the only three that lock a comment row, so the order above is
-- the whole of it: a new function locking comments fails here until it is
-- added, and checked, above.
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosrc ~ 'from public\.story_comments[^;]*\mfor (share|update|no key update|key share)\M'),
  'delete_story_comment,react_to_story_comment,report_story_comment',
  '39j. only those three take a row lock on a comment'
);

-- And before any of those row locks, the profiles the report's insert will
-- check. An account deletion locks the profile first and the account's
-- stories and comments after it; a report that took the story first and the
-- profile at its insert deadlocked with it, and lost the evidence when it was
-- the one aborted. Driven two-session in 566; pinned here as the order.
select is(
  (select string_agg(
            f::regproc::text || ':'
            || (position('from public.profiles' in d) > 0
                and position('for key share' in d) > position('from public.profiles' in d)
                and position('for key share' in d) < position(lock_at in d))::text,
            ',' order by f::regproc::text)
   from (values
     ('public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure,
      'from public.stories where id = p_story_id for share'),
     ('public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure,
      'from public.stories where id = v_story for share'),
     ('public.delete_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure,
      'from public.stories s where s.id = v_story for share')
   ) as v(f, lock_at)
   cross join lateral (select pg_get_functiondef(v.f) as d) g),
  'delete_story_comment:true,report_story:true,report_story_comment:true',
  '39k. every story report path locks the profiles it checks before the story'
);

-- report_story takes the media purge's lock, shared, between the profiles and
-- the story, and only then asks whether the purge already claimed the media.
-- A claim (151) that lists the object waits for the report to commit and then
-- sees it; one that committed first is seen. Driven two-session in 566.
select ok(
  (select position('for key share' in d) > 0
      and position('pg_advisory_xact_lock_shared(hashtextextended(''story_media_purge'', 0))' in d)
          > position('for key share' in d)
      and position('from public.stories where id = p_story_id for share' in d)
          > position('pg_advisory_xact_lock_shared(hashtextextended(''story_media_purge'', 0))' in d)
      and position('from public.story_media_released m where m.name = v_story.media_path' in d)
          > position('from public.stories where id = p_story_id for share' in d)
      and position('insert into public.reports' in d)
          > position('from public.story_media_released m where m.name = v_story.media_path' in d)
   from (select pg_get_functiondef('public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39k2. report_story holds the purge lock shared from before it locks the story until it commits'
);

-- And no row lock at all for a call that is going to be refused (150's lock
-- order). The budget: the reporter's lock and the count come before the
-- first row lock on every report path, so a member at the limit looping a
-- report holds nothing a story delete waits on.
select is(
  (select string_agg(
            f::regproc::text || ':'
            || (position('pg_advisory_xact_lock(hashtextextended(''report:'' || v_uid::text, 0))' in d) > 0
                and position('count(*)' in d) > position('pg_advisory_xact_lock(hashtextextended(''report:'' || v_uid::text, 0))' in d)
                and position('for key share' in d) > position('count(*)' in d))::text,
            ',' order by f::regproc::text)
   from unnest(array[
     'public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure,
     'public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure,
     'public.delete_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure
   ]) f
   cross join lateral (select pg_get_functiondef(f) as d) g),
  'delete_story_comment:true,report_story:true,report_story_comment:true',
  '39o. every report path spends its budget before it locks a row'
);
-- What the caller may see, asked unlocked before the rows: a stranger's or a
-- blocked member's report on something they cannot see locks nothing.
select is(
  (select string_agg(
            f::regproc::text || ':'
            || (position(v in d) > 0 and position(v in d) < position('for key share' in d))::text,
            ',' order by f::regproc::text)
   from (values
     ('public.report_story(uuid, public.report_reason, text, uuid)'::regprocedure, 'public.story_is_reportable(p_story_id)'),
     ('public.report_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure, 'public.story_comment_is_reportable(p_comment_id)')
   ) as t(f, v)
   cross join lateral (select pg_get_functiondef(t.f) as d) g),
  'report_story:true,report_story_comment:true',
  '39p. every report path asks whether the caller may see it before it locks a row'
);
-- delete_story_comment answers FORBIDDEN (and NOT_FOUND, and a repeat delete
-- of a tombstone) before any lock. It used to lock the three profiles, the
-- story and the comment first, and five strangers looping it on one comment
-- starved the provider's delete of the story (8 s timeout; driven in 566).
select ok(
  (select position('''FORBIDDEN''' in d) > 0
      and position('''FORBIDDEN''' in d) < position('for key share' in d)
      and position('''NOT_FOUND''' in d) < position('for key share' in d)
      and position('elsif v_deleted is not null then' in d) < position('for key share' in d)
   from (select pg_get_functiondef('public.delete_story_comment(uuid, public.report_reason, text, uuid)'::regprocedure) as d) f),
  '39q. delete_story_comment refuses a stranger, and answers a repeat delete, before it locks anything'
);

-- A fresh deploy has only push_sender_url; the purge must not wait on a
-- second secret nobody knows to set (Greptile P1 on 7a9de76).
select is(
  public.story_media_purge_endpoint('', 'https://abc.supabase.co/functions/v1/send-push'),
  'https://abc.supabase.co/functions/v1/purge-story-media',
  '39. the purge URL is derived from push_sender_url when its own secret is empty'
);
select is(
  public.story_media_purge_endpoint('  https://x.example/functions/v1/purge-story-media ', 'https://abc.supabase.co/functions/v1/send-push'),
  'https://x.example/functions/v1/purge-story-media',
  '39b. an explicit story_media_purge_url still wins'
);
select is(
  public.story_media_purge_endpoint(null, 'https://abc.supabase.co/functions/v1/send-push?x=1'),
  'https://abc.supabase.co/functions/v1/purge-story-media',
  '39c. a query string on the sender URL is not carried over'
);
select ok(
  public.story_media_purge_endpoint('', '') is null
    and public.story_media_purge_endpoint(null, 'http://abc.supabase.co/functions/v1/send-push') is null
    and public.story_media_purge_endpoint(null, 'https://abc.supabase.co/rest/v1/x') is null,
  '39d. nothing usable gives NULL (plain http and non-function URLs refused)'
);
select ok(
  not has_function_privilege('authenticated', 'public.story_media_purge_endpoint(text, text)', 'EXECUTE'),
  '39e. clients cannot call the endpoint helper'
);

-- ── Function privileges as the hosted project grants them ─────────────────
-- Supabase grants EXECUTE on every new function to anon and authenticated by
-- name, and hosted_function_grants.sql gives this harness the same, so a
-- revoke from PUBLIC alone shows up here as it would live.
select ok(
  not has_function_privilege('authenticated', 'public.is_blocked_pair(uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.is_blocked_pair(uuid, uuid)', 'EXECUTE'),
  '39l. no client can ask is_blocked_pair who has blocked whom (143)'
);
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any (array[
       'stories_enabled', 'story_post_refusal', 'install_stories_bucket',
       'story_comment_tombstone_clears_reaction', 'stories_release_media',
       'purge_expired_stories', 'story_objects_to_purge',
       'claim_story_objects_to_purge', 'story_media_purge_endpoint',
       'dispatch_story_media_purge', 'is_blocked_pair', 'story_is_reportable',
       'story_comment_is_reportable'])
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  null,
  '39m. none of the server-only story functions is callable by a client'
);
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any (array[
       'block_story_commenter', 'claim_story_objects_to_purge', 'create_story',
       'delete_story_comment', 'dispatch_story_media_purge', 'install_stories_bucket',
       'is_blocked_pair', 'mark_story_viewed', 'my_story_insights',
       'post_story_comment', 'public_display_name', 'purge_expired_stories',
       'react_to_story_comment', 'report_story', 'report_story_comment',
       'stories_enabled', 'stories_release_media', 'story_comment_is_visible',
       'story_comment_tombstone_clears_reaction', 'story_is_visible',
       'story_media_purge_endpoint', 'story_media_upload_allowed',
       'story_objects_to_purge', 'story_post_refusal', 'story_reaction_counts',
       'story_text_has_control', 'story_text_line_breaks', 'story_text_trim',
       'story_viewers', 'submit_report', 'toggle_story_reaction'])
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  null,
  '39n. and no story function at all is callable signed out'
);

-- The class 143 section 7 closes: functions revoked from PUBLIC only, which
-- the hosted grant left callable. With the grant modelled from the first
-- migration, each of these was callable by a signed-in member, and the first
-- let one approve their own provider application and post stories.
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any (array[
       'approve_provider_application', 'credit_promo_tokens',
       'credit_purchased_recharge', 'credit_user_token', 'deduct_tokens',
       'deduct_user_token', 'first_recharge_discount_bps', 'has_ever_recharged',
       'record_provider_accrual', 'refresh_reply_latencies',
       'refund_unanswered_messages', 'reject_provider_application',
       'request_application_info'])
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  null,
  '39r. no server-only wallet or application function is callable by a client (143)'
);

-- The sweeps, so the next one is caught without anyone listing it. Signed
-- out: nothing revoked from PUBLIC is callable with only the anon key.
select is(
  (select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (
       select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  null,
  '39s. no function revoked from PUBLIC is callable signed out'
);

-- Signed in: every function revoked from PUBLIC that `authenticated` can
-- call is one a client is meant to call. A new server-only function that
-- forgets its revoke from anon and authenticated lands outside this list and
-- fails here; a new client RPC is added to it, on purpose.
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and not exists (
       select 1 from pg_depend d
       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (
       select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where a.grantee = 0 and a.privilege_type = 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname <> all (array[
       'accept_policy', 'accept_session_request', 'announce_chat_open', 'answer_call',
       'block_story_comment_author', 'block_story_commenter', 'block_target_known_to_me',
       'call_minimum_minutes', 'call_tokens_per_minute',
       'check_display_name', 'claim_daily_tokens', 'claim_member_profile',
       'claim_session_lease', 'complete_provider_onboarding', 'confirm_chat_session',
       'create_session_request', 'create_story', 'decline_session_request',
       'delete_message', 'delete_story_comment', 'delete_user_account', 'edit_message',
       'end_call', 'end_session', 'get_active_config', 'get_active_session',
       'get_chat_consent', 'get_home_suggestions', 'get_my_favorites',
       'get_pending_session_request', 'get_provider_ratings',
       'get_session_billing_snapshot', 'get_usage_ledger', 'get_video_switch_quote',
       'heartbeat_call', 'insert_next_opener', 'mark_story_viewed', 'member_handle',
       'message_edit_window', 'mock_recharge', 'my_first_recharge_discount_bps',
       'my_story_insights', 'open_conversation', 'pending_policy_acceptances',
       'post_story_comment', 'provider_is_listed', 'provider_offers_channel',
       'public_display_name', 'react_to_story_comment', 'record_call_quality_samples',
       'record_suggestion_outcome', 'register_push_token', 'report_story',
       'report_story_comment', 'request_media_upgrade', 'respond_media_upgrade',
       'resume_chat_consent', 'seed_conversation_openers', 'send_message',
       'send_message_idempotent', 'set_conversation_name', 'set_member_age_bracket',
       'set_my_pan', 'set_next_call_media_backend', 'set_provider_expertise',
       'shares_conversation_with_me', 'spend_chat_minute', 'start_call',
       'story_comment_is_visible', 'story_is_visible', 'story_media_upload_allowed',
       'story_reaction_counts', 'story_text_has_control', 'story_text_line_breaks',
       'story_text_trim', 'story_viewers', 'submit_provider_application',
       'submit_report', 'submit_review', 'submit_session_review', 'toggle_favorite',
       'toggle_reaction', 'toggle_story_reaction', 'touch_presence',
       'unblock_by_handle', 'unregister_push_token', 'upsert_my_payout_account',
       'user_has_accepted_current_policies'])),
  null,
  '39t. every function revoked from PUBLIC that a signed-in client can call is a client RPC'
);

-- ── Switched off: removal and reporting still work ────────────────────────
-- The switch stops what adds to the surface. What takes things off it or
-- tells an operator about it must never be gated on it: during an abuse wave
-- is exactly when stories get switched off and exactly when reports and
-- deletes are needed. Nothing asserted this, so a gate added to any of them
-- passed every suite.
reset role;
update admin.config_active
set payload = payload || '{"stories_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000005","role":"authenticated"}';
select is(
  (public.post_story_comment(gen_random_uuid(), 'c5630000-0000-4563-8000-0000000000a5', 'hello') ->> 'error'),
  'STORIES_DISABLED',
  '40. with stories off nothing new is posted...'
);
insert into test.fixture (k, v)
select 'off_story', public.report_story('c5630000-0000-4563-8000-0000000000a5', 'spam');
insert into test.fixture (k, v)
select 'off_comment', public.report_story_comment('c5630000-0000-4563-8000-0000000000c5', 'harassment');

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000004","role":"authenticated"}';
select set_config('test.off_author_delete',
  public.delete_story_comment('c5630000-0000-4563-8000-0000000000c5') ->> 'success', true);

set local request.jwt.claims = '{"sub":"c5630000-0000-4563-8000-000000000013","role":"authenticated"}';
insert into test.fixture (k, v)
select 'off_delete',
       (public.delete_story_comment('c5630000-0000-4563-8000-0000000000c6', 'harassment') ->> 'report_id')::uuid;
delete from public.stories where id = 'c5630000-0000-4563-8000-0000000000a6';
-- And the provider blocks the commenter by the comment, which is the other
-- thing an abuse wave needs while posting is off.
select set_config('test.off_block',
  public.block_story_commenter('c5630000-0000-4563-8000-0000000000c5')::text, true);

-- Read in later statements, as the owner, so every write above is seen.
reset role;
select is(
  (select count(*)::int from public.reports
   where id in (select v from test.fixture where k in ('off_story', 'off_comment', 'off_delete'))),
  3,
  '41. ...and yet a story, a comment, and a provider''s report-and-delete are all reported'
);
select is(
  current_setting('test.off_author_delete') || '|'
  || (select string_agg(coalesce(body, 'erased') || ':' || (deleted_at is not null)::text, ',' order by id)
      from public.story_comments
      where id in ('c5630000-0000-4563-8000-0000000000c5', 'c5630000-0000-4563-8000-0000000000c6')),
  'true|erased:true,erased:true',
  '42. the author''s delete and the provider''s both really tombstone'
);
select is(
  (select count(*)::int from public.stories where id = 'c5630000-0000-4563-8000-0000000000a6'),
  0,
  '43. and a provider takes their own story down'
);
select is(
  current_setting('test.off_block') || '|'
  || (select count(*)::int from public.blocks
      where blocker_id = 'c5630000-0000-4563-8000-000000000013'
        and blocked_id = 'c5630000-0000-4563-8000-000000000004'),
  '{"success" : true}|1',
  '43b. and blocks a commenter through their comment'
);

reset role;
update admin.config_active
set payload = payload - 'stories_enabled'
where domain = 'kill_switches' and environment = 'prod';

-- ── A resolved report's retention runs out ────────────────────────────────
-- moderation_actions is append-only (005), and its report_id is `on delete
-- set null`: the purge's delete of a report sets it null through an UPDATE
-- the trigger refused, so purge_expired_reports failed as a whole on the
-- first expired report anyone had dismissed or actioned (both write an
-- action row), and the report-named story media it was meant to free was
-- kept forever. The same set null on subject_user_id refused the deletion of
-- any account that had ever been the subject of an action. 150 lets exactly
-- that referential write through, and nothing else.
insert into auth.users (id) values ('c5630000-0000-4563-8000-000000000020');
insert into public.reports (id, reporter_id, subject_user_id, story_id, reason, status, resolved_at,
                            evidence_surface, evidence_story_media_path)
values
  ('c5630000-0000-4563-8000-0000000000e1', 'c5630000-0000-4563-8000-000000000002',
   'c5630000-0000-4563-8000-000000000010', null, 'spam', 'dismissed', now() - interval '91 days',
   'story', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000e1.jpg'),
  ('c5630000-0000-4563-8000-0000000000e2', 'c5630000-0000-4563-8000-000000000002',
   'c5630000-0000-4563-8000-000000000010', null, 'spam', 'actioned', now() - interval '91 days',
   null, null),
  ('c5630000-0000-4563-8000-0000000000e3', 'c5630000-0000-4563-8000-000000000002',
   'c5630000-0000-4563-8000-000000000020', null, 'spam', 'actioned', now() - interval '1 day',
   null, null);
insert into public.moderation_actions (id, report_id, subject_user_id, action, actor) values
  ('c5630000-0000-4563-8000-0000000000f1', 'c5630000-0000-4563-8000-0000000000e1',
   'c5630000-0000-4563-8000-000000000010', 'none', 'ops:test'),
  ('c5630000-0000-4563-8000-0000000000f3', 'c5630000-0000-4563-8000-0000000000e3',
   'c5630000-0000-4563-8000-000000000020', 'warned', 'ops:test');
-- e2 has a moderation case (031, end_session's report path), which keeps it.
insert into public.moderation_cases (report_id) values ('c5630000-0000-4563-8000-0000000000e2');
insert into storage.objects (bucket_id, name, created_at, metadata)
values ('stories', 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000e1.jpg',
        now() - interval '92 days', '{"mimetype":"image/jpeg"}');

select is(
  (select count(*)::int from public.story_objects_to_purge(1000)
   where object_name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000e1.jpg'),
  0,
  '44. a report''s media is kept while the report is'
);
-- Run inside lives_ok, so a purge that fails (as it did, 42501 or 23503)
-- is a failed test here rather than the end of the file.
select lives_ok(
  $$ select set_config('test.purged', public.purge_expired_reports()::text, true) $$,
  '45a. the purge runs with an expired report that an action names and one that a case keeps'
);
select is(
  current_setting('test.purged', true),
  '1',
  '45. ...removes the one past its retention, and keeps the one with a case'
);
select is(
  (select count(*)::int from public.reports where id = 'c5630000-0000-4563-8000-0000000000e1')
  || '|' || (select count(*)::int from public.reports where id = 'c5630000-0000-4563-8000-0000000000e2')
  || '|' || (select coalesce(report_id::text, 'null') || ':' || action || ':' || actor
             from public.moderation_actions where id = 'c5630000-0000-4563-8000-0000000000f1')
  || '|' || (select count(*)::int from public.story_objects_to_purge(1000)
             where object_name = 'c5630000-0000-4563-8000-000000000010/c5630000-0000-4563-8000-0000000000e1.jpg'),
  '0|1|null:none:ops:test|1',
  '46. ...its audit row stays, pointing at nothing, and the media it held is freed'
);
select lives_ok(
  $$ delete from auth.users where id = 'c5630000-0000-4563-8000-000000000020' $$,
  '47. an account that was the subject of an action can still be deleted'
);
select is(
  (select coalesce(subject_user_id::text, 'null') || ':' || action
   from public.moderation_actions where id = 'c5630000-0000-4563-8000-0000000000f3'),
  'null:warned',
  '48. ...and the action is kept, with its subject set null as the foreign key says'
);
select throws_ok(
  $$ update public.moderation_actions set report_id = null
     where id = 'c5630000-0000-4563-8000-0000000000f3' $$,
  '42501',
  'moderation_actions is append-only',
  '49. nobody else sets a reference null: a direct update is still refused'
);
select throws_ok(
  $$ update public.moderation_actions set note = 'edited', report_id = null
     where report_id = 'c5630000-0000-4563-8000-0000000000e3' $$,
  '42501',
  'moderation_actions is append-only',
  '49b. ...nor edits a row on the way'
);
select throws_ok(
  $$ delete from public.moderation_actions where id = 'c5630000-0000-4563-8000-0000000000f1' $$,
  '42501',
  'moderation_actions is append-only',
  '49c. ...and no row is deleted'
);
-- The depth alone is not the gate: an UPDATE reached from inside some other
-- trigger is also below depth one, and may still only null a reference.
create function test.edit_action()
returns trigger
language plpgsql
as $$
begin
  update public.moderation_actions set note = 'edited', report_id = null
  where report_id = 'c5630000-0000-4563-8000-0000000000e3';
  return null;
end;
$$;
create table test.poke (id integer);
create trigger poke_edits_an_action after insert on test.poke
  for each row execute function test.edit_action();
select throws_ok(
  $$ insert into test.poke values (1) $$,
  '42501',
  'moderation_actions is append-only',
  '49d. ...nor edits one from inside another trigger, where only the foreign key''s own set null passes'
);

select ok(
  (select bool_and(position('<> p_story_id' in d) = 0 and position('<> p_comment_id' in d) = 0)
   from (select pg_get_functiondef(p.oid) as d from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('report_story', 'report_story_comment', 'delete_story_comment')) f),
  '39z. report retries compare story and comment ids null-safely (a purged story is never a match)'
);

select ok(
  position('s.provider_id = auth.uid()' in pg_get_functiondef('public.story_comment_is_reportable(uuid)'::regprocedure)) > 0,
  '39aa. a story''s provider can report a comment on it after blocking its author'
);
select ok(
  (select position('where id = p_story_id and provider_id = v_uid' in d) < position('if v_refusal is not null' in d)
   from (select pg_get_functiondef(p.oid) as d from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = 'create_story') f),
  '39ab. a retry of a story already created answers before any refusal'
);

select * from finish();
rollback;
