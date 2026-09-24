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
--     bucket, and only while stories are on (19-25).
--   * No client reads the bucket, so no client can sign a URL in it (26, 27);
--     the story row story-media-url authorises on is there for a live story a
--     member may see and for nobody blocked (28, 29).
--   * create_story refuses media that was never uploaded or whose content
--     type is not what its name says (30-32).
--   * The purge: a direct DELETE is refused (33); the purge deletes expired
--     rows with everything hanging off them and no storage row at all (34-36);
--     it names exactly the objects to remove, a deleted story's at once and an
--     abandoned upload's after a day, never a live, reported or in-flight one
--     or another bucket's (36b-37); a removed object's name is forgotten while
--     a reported one's is kept (37b-37d); and no client can run any of it or
--     read its queue (38-38d).

\set ON_ERROR_STOP on
begin;
select plan(55);

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
  ('c5630000-0000-4563-8000-000000000011');  -- provider, not listed

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
              'c5630000-0000-4563-8000-000000000011');

select test.accept_current_policies(id)
from public.profiles
where id::text like 'c5630000-%';

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

-- c1 is reported, then deleted by its author; c2 and c3 are for the
-- provider's report-and-delete.
insert into public.story_comments (id, story_id, author_id, body)
values
  ('c5630000-0000-4563-8000-0000000000c1', 'c5630000-0000-4563-8000-0000000000a1',
   'c5630000-0000-4563-8000-000000000001', 'something awful'),
  ('c5630000-0000-4563-8000-0000000000c2', 'c5630000-0000-4563-8000-0000000000a2',
   'c5630000-0000-4563-8000-000000000001', 'something worse'),
  ('c5630000-0000-4563-8000-0000000000c3', 'c5630000-0000-4563-8000-0000000000a2',
   'c5630000-0000-4563-8000-000000000001', 'and again');

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
     'public.report_story(uuid, public.report_reason, text)'::regprocedure,
     'public.report_story_comment(uuid, public.report_reason, text)'::regprocedure
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
select is(
  (public.delete_story_comment('c5630000-0000-4563-8000-0000000000c3', 'harassment') ->> 'error')
  || '|' || (select body from public.story_comment_feed where id = 'c5630000-0000-4563-8000-0000000000c3'),
  'RATE_LIMITED|and again',
  '15. a refused report deletes nothing, so the evidence is never lost to it'
);

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
  (select count(*)::int from public.stories),
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
  (select string_agg(right(object_name, 10), ',')
   from public.story_objects_to_purge(1000)),
  '0000b8.jpg,0000a3.png,0000a4.jpg',
  '36b. named: the abandoned upload, the expired story''s, and the deleted story''s at once'
);
select is(
  (select string_agg(right(object_name, 10), ',')
   from public.story_objects_to_purge(1)),
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

-- The Storage API's removal, stood in for by the owner: it deletes the rows
-- (and, live, the bytes) of exactly the names it was given.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'stories'
  and name in (select object_name from public.story_objects_to_purge(1000));

select is(
  public.purge_expired_stories()::jsonb,
  '{"stories": 0, "forgotten": 2}'::jsonb,
  '37b. the next purge forgets the two released names whose objects are gone'
);
select is(
  (select string_agg(right(name, 10), ',') from public.story_media_released),
  '0000a1.jpg',
  '37c. ...and keeps the reported story''s, whose object the report still holds'
);
select is(
  (select count(*)::int from public.story_objects_to_purge(1000)),
  0,
  '37d. nothing is left to name: live, reported, in-flight and new uploads all stay'
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

select * from finish();
rollback;
