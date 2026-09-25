-- pgTAP for 150: a story report is filed once however often it is sent, it
-- reaches a viewer the provider blocked afterwards, and it keeps the name the
-- reported thing was published under.
--
-- WHAT THIS IS GUARDING:
--
--   * A retry is the report already filed. A report whose response was lost
--     used to be filed again by the retry, a second row and a second unit of
--     the hourly budget; the report-and-delete's retry found its own
--     tombstone and answered NOT_FOUND, so the client could not tell a report
--     existed. Each entry point takes a client-minted report id (1-6), and the
--     same id from another account, or for another story, is refused (3, 4).
--   * A block cannot silence a viewer who objected. 152 gives the provider a
--     one-call block against any commenter, and both report paths asked
--     story_is_visible, which excludes a blocked pair: the member who viewed
--     the story and said so in a comment was the one member who could no
--     longer report it. Now having viewed the unexpired story is enough, the
--     media path is kept as for any story report (7-9); a blocked member who
--     never viewed it is refused as before (10).
--   * The name the audience saw is evidence. display_name is client-writable,
--     so a comment under an abusive name with a harmless body read as
--     harmless once its author renamed (11-13).
--   * Child safety is read first, whichever name it was filed under. The app
--     files 'child_safety' (026's taxonomy); the queue ordered by
--     'minor_safety' alone, which no build files any more, and put a child
--     safety report behind every older spam report (14).

\set ON_ERROR_STOP on
begin;
select plan(14);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c5670000-0000-4567-8000-000000000001'),  -- member R, reports
  ('c5670000-0000-4567-8000-000000000002'),  -- member M, viewed and commented, then blocked
  ('c5670000-0000-4567-8000-000000000003'),  -- member B, blocked before ever viewing
  ('c5670000-0000-4567-8000-000000000004'),  -- member W, comments under a chosen name
  ('c5670000-0000-4567-8000-000000000010'),  -- provider P
  ('c5670000-0000-4567-8000-000000000011');  -- provider Q, a second story

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Pandit Five Six Seven ' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id in ('c5670000-0000-4567-8000-000000000010',
              'c5670000-0000-4567-8000-000000000011');

update public.profiles
set display_name = 'call_me_567', profile_completed_at = now()
where id = 'c5670000-0000-4567-8000-000000000004';

select test.accept_current_policies(id) from public.profiles where id::text like 'c5670000-%';

insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms,
                            created_at, expires_at)
values
  ('c5670000-0000-4567-8000-0000000000a1', 'c5670000-0000-4567-8000-000000000010', 'image',
   'c5670000-0000-4567-8000-000000000010/c5670000-0000-4567-8000-0000000000a1.jpg',
   'story 567', 7000, now() - interval '1 hour', now() + interval '23 hours'),
  ('c5670000-0000-4567-8000-0000000000a2', 'c5670000-0000-4567-8000-000000000011', 'image',
   'c5670000-0000-4567-8000-000000000011/c5670000-0000-4567-8000-0000000000a2.jpg',
   'another story', 7000, now() - interval '1 hour', now() + interval '23 hours');

insert into public.story_comments (id, story_id, author_id, body) values
  ('c5670000-0000-4567-8000-0000000000c1', 'c5670000-0000-4567-8000-0000000000a1',
   'c5670000-0000-4567-8000-000000000004', 'looks nice'),
  ('c5670000-0000-4567-8000-0000000000c2', 'c5670000-0000-4567-8000-0000000000a1',
   'c5670000-0000-4567-8000-000000000002', 'reporting this'),
  ('c5670000-0000-4567-8000-0000000000c3', 'c5670000-0000-4567-8000-0000000000a1',
   'c5670000-0000-4567-8000-000000000004', 'reported and deleted');

-- M viewed the story before objecting (and commenting is viewing, 147).
insert into public.story_views (story_id, viewer_id) values
  ('c5670000-0000-4567-8000-0000000000a1', 'c5670000-0000-4567-8000-000000000002');

-- B was blocked by P from a chat, before the story; inserted as the owner.
insert into public.blocks (blocker_id, blocked_id) values
  ('c5670000-0000-4567-8000-000000000010', 'c5670000-0000-4567-8000-000000000003');

set local role authenticated;

-- ── A retry is the report already filed ────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000001","role":"authenticated"}';
select is(
  public.report_story('c5670000-0000-4567-8000-0000000000a1', 'spam', null,
                      'c5670000-0000-4567-8000-0000000000d1')::text
  || '|' ||
  public.report_story('c5670000-0000-4567-8000-0000000000a1', 'spam', null,
                      'c5670000-0000-4567-8000-0000000000d1')::text,
  'c5670000-0000-4567-8000-0000000000d1|c5670000-0000-4567-8000-0000000000d1',
  '1. a story report sent twice answers the same id both times'
);
select is(
  public.report_story_comment('c5670000-0000-4567-8000-0000000000c1', 'harassment', null,
                              'c5670000-0000-4567-8000-0000000000d2')::text
  || '|' ||
  public.report_story_comment('c5670000-0000-4567-8000-0000000000c1', 'harassment', null,
                              'c5670000-0000-4567-8000-0000000000d2')::text,
  'c5670000-0000-4567-8000-0000000000d2|c5670000-0000-4567-8000-0000000000d2',
  '2. so does a comment report'
);
select throws_ok(
  $$ select public.report_story('c5670000-0000-4567-8000-0000000000a2', 'spam', null,
                                'c5670000-0000-4567-8000-0000000000d1') $$,
  '22023',
  'report id already used',
  '3. the same id for another story is refused'
);

set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story('c5670000-0000-4567-8000-0000000000a1', 'spam', null,
                                'c5670000-0000-4567-8000-0000000000d1') $$,
  '22023',
  'report id already used',
  '4. and so is another account''s id, which says nothing about whose it is'
);

-- The provider's report-and-delete, retried after its answer was lost.
set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000010","role":"authenticated"}';
select is(
  (public.delete_story_comment('c5670000-0000-4567-8000-0000000000c3', 'harassment', null,
                               'c5670000-0000-4567-8000-0000000000d3')::jsonb)
  || jsonb_build_object('retry',
       public.delete_story_comment('c5670000-0000-4567-8000-0000000000c3', 'harassment', null,
                                   'c5670000-0000-4567-8000-0000000000d3')::jsonb),
  '{"success": true, "report_id": "c5670000-0000-4567-8000-0000000000d3",
    "retry": {"success": true, "report_id": "c5670000-0000-4567-8000-0000000000d3"}}'::jsonb,
  '5. a report-and-delete retried after the tombstone is its original success, not NOT_FOUND'
);

reset role;
select is(
  (select string_agg(right(reporter_id::text, 2) || ':' || count_of::text, ',' order by reporter_id)
   from (select reporter_id, count(*) as count_of from public.reports
         where reporter_id::text like 'c5670000-%'
           and created_at > now() - interval '1 hour'
         group by reporter_id) t),
  '01:2,10:1',
  '6. one row, and one unit of the hourly budget, per report however often it was sent'
);

-- ── A block cannot silence a viewer who objected ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000010","role":"authenticated"}';
select public.block_story_commenter('c5670000-0000-4567-8000-0000000000c2');

set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where id = 'c5670000-0000-4567-8000-0000000000a1'),
  0,
  '7. the blocked viewer no longer sees the story'
);
select is(
  public.report_story('c5670000-0000-4567-8000-0000000000a1', 'sexual_content', null,
                      'c5670000-0000-4567-8000-0000000000d4')::text,
  'c5670000-0000-4567-8000-0000000000d4',
  '8. ...and can still report it, having viewed it before the block'
);
select lives_ok(
  $$ select public.report_story_comment('c5670000-0000-4567-8000-0000000000c1', 'spam', null,
                                        'c5670000-0000-4567-8000-0000000000d5') $$,
  '9. ...and a comment on it'
);

set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.report_story('c5670000-0000-4567-8000-0000000000a1', 'spam') $$,
  'P0002',
  'no such story',
  '10. a blocked member who never viewed the story still cannot reach it'
);

-- ── The name the audience saw ──────────────────────────────────────────────
reset role;
select is(
  (select evidence_story_media_path || '|' || evidence_author_name from public.reports
   where id = 'c5670000-0000-4567-8000-0000000000d4'),
  'c5670000-0000-4567-8000-000000000010/c5670000-0000-4567-8000-0000000000a1.jpg|Pandit Five Six Seven 10',
  '11. the blocked viewer''s report keeps the media and the provider''s name, as any story report does'
);

-- W renames after being reported. PATCHed as W would, through the table.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5670000-0000-4567-8000-000000000004","role":"authenticated"}';
update public.profiles set display_name = 'harmless_567' where id = 'c5670000-0000-4567-8000-000000000004';
reset role;
select is(
  (select string_agg(evidence_author_name, ',' order by id) from public.reports
   where id in ('c5670000-0000-4567-8000-0000000000d2', 'c5670000-0000-4567-8000-0000000000d3',
                'c5670000-0000-4567-8000-0000000000d5'))
  || '|' || (select display_name from public.profiles where id = 'c5670000-0000-4567-8000-000000000004'),
  'call_me_567,call_me_567,call_me_567|harmless_567',
  '12. a comment report keeps the name the comment was published under, past a rename'
);
select is(
  (select evidence_author_name from public.moderation_queue
   where id = 'c5670000-0000-4567-8000-0000000000d2'),
  'call_me_567',
  '13. and the operator''s queue shows it'
);

-- Three open reports, oldest first: spam, then harassment, then child
-- safety. Only this suite's rows are read, so the fixture's other reports
-- cannot move them.
insert into public.reports (id, reporter_id, reason, created_at) values
  ('c5670000-0000-4567-8000-0000000000e1', 'c5670000-0000-4567-8000-000000000001', 'spam',
   now() - interval '3 hours'),
  ('c5670000-0000-4567-8000-0000000000e2', 'c5670000-0000-4567-8000-000000000001', 'harassment',
   now() - interval '2 hours'),
  ('c5670000-0000-4567-8000-0000000000e3', 'c5670000-0000-4567-8000-000000000001', 'child_safety',
   now() - interval '1 hour');
select is(
  (select string_agg(q.reason::text, ',' order by q.n)
   from (select reason, id, row_number() over () as n from public.moderation_queue) q
   where q.id in ('c5670000-0000-4567-8000-0000000000e1', 'c5670000-0000-4567-8000-0000000000e2',
                  'c5670000-0000-4567-8000-0000000000e3')),
  'child_safety,spam,harassment',
  '14. the operator''s queue puts a child_safety report ahead of older spam and harassment'
);

select * from finish();
rollback;
