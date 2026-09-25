-- pgTAP for migration 152: the story's provider blocks a stranger who
-- comments, which 096 alone would refuse.
--
-- WHAT THIS IS GUARDING:
--
--   * The gap is real: the provider cannot insert the block themselves,
--     because 096 wants a prior conversation (1).
--   * Only the story's own provider may use the comment to block: not a
--     member, not another provider, and not on a comment that does not exist
--     (2-4).
--   * The answer says nothing about the author, and says the same thing
--     whether or not a block already existed, in either direction (5, 10, 12).
--   * Once blocked, 147's rules do the rest: the author's comments are gone
--     for everyone, the author can neither see the story nor post (6-9).
--   * A comment the provider already deleted still works as the handle (11).
--   * The block can be FOUND to be undone: blocked_people lists it with the
--     commenter's public name, which no other surface the provider can read
--     still carries (13); it publishes a handle, a name and a clay avatar and
--     no phone or email (14); a member's list shows the provider they
--     blocked (15) and never who blocked them (15, 16).
--   * And never the commenter's account id: not from the block row, not from
--     the list, and not by deleting a block by id (13a, 13b, 17a). Block,
--     read blocked_id, unblock used to hand any provider the id 147 and 148
--     withhold, on demand and with no trace. Without a column revoke: the
--     row is filtered by the SELECT policy, so the table read an installed
--     build makes still works (13c).
--   * A member's block of a provider with no conversation, from the discovery
--     card before 096, keeps the provider's id on the list, which is what
--     hides the provider's card on Home (15b).
--   * The block is an ordinary block: the provider lifts it by its handle
--     through unblock_by_handle, with no conversation (17), and it leaves
--     their list (18).
--   * A member viewer blocks a commenter too, which 096 alone never allowed
--     (two members share no conversation): by a comment they can see, with
--     the same silence about the author, and never by their own comment or
--     one they cannot see (21-26). share_conversation answers about any two
--     accounts and is no longer a client's (27).
--     No signed-out caller can run the functions or read the list (19, 20,
--     28, 29).
--   * It still works once the story has expired (18b): the comment is the
--     handle, and a provider looking back at who harassed them yesterday
--     must not find the tool gone with the story. Nothing asserted it, so an
--     expires_at filter in its lookup passed every suite. (The kill switch
--     is 563's, in its switched-off window.)

\set ON_ERROR_STOP on
begin;
select plan(36);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c5640000-0000-4564-8000-000000000005'),  -- member E, comments, blocked by viewer B
  ('c5640000-0000-4564-8000-000000000001'),  -- member A, a stranger who comments
  ('c5640000-0000-4564-8000-000000000002'),  -- member B, reads
  ('c5640000-0000-4564-8000-000000000003'),  -- member C, comment deleted first
  ('c5640000-0000-4564-8000-000000000004'),  -- member D, has blocked P already
  ('c5640000-0000-4564-8000-000000000010'),  -- provider P, the story's
  ('c5640000-0000-4564-8000-000000000011');  -- provider Q

-- A has a chosen name and a clay pick; C and D never finished setup.
update public.profiles
set display_name = 'loud_heron', avatar_url = 'clay:bloom', profile_completed_at = now()
where id = 'c5640000-0000-4564-8000-000000000001';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider564-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id in ('c5640000-0000-4564-8000-000000000010',
              'c5640000-0000-4564-8000-000000000011');

select test.accept_current_policies(id)
from public.profiles
where id::text like 'c5640000-%';

-- D blocked P after a chat; inserted as the owner, since 096 is not the point.
insert into public.blocks (blocker_id, blocked_id) values
  ('c5640000-0000-4564-8000-000000000004', 'c5640000-0000-4564-8000-000000000010');

insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
values
  ('c5640000-0000-4564-8000-0000000000a1', 'c5640000-0000-4564-8000-000000000010', 'image',
   'c5640000-0000-4564-8000-000000000010/c5640000-0000-4564-8000-0000000000a1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours');

insert into public.story_comments (id, story_id, author_id, body) values
  ('c5640000-0000-4564-8000-0000000000c1', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000001', 'first'),
  ('c5640000-0000-4564-8000-0000000000c2', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000001', 'second'),
  ('c5640000-0000-4564-8000-0000000000c3', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000003', 'from C'),
  ('c5640000-0000-4564-8000-0000000000c4', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000004', 'from D, before blocking P'),
  ('c5640000-0000-4564-8000-0000000000c5', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000002', 'from B'),
  ('c5640000-0000-4564-8000-0000000000c6', 'c5640000-0000-4564-8000-0000000000a1',
   'c5640000-0000-4564-8000-000000000005', 'from E');

-- ── The gap ────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('c5640000-0000-4564-8000-000000000010', 'c5640000-0000-4564-8000-000000000001') $$,
  '42501',
  null,
  '1. without a conversation, 096 refuses the provider''s own block of a commenter'
);

-- ── Who may use a comment to block ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000002","role":"authenticated"}';
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c1') ->> 'error',
  'FORBIDDEN',
  '2. a member cannot block another member through their comment'
);
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000011","role":"authenticated"}';
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c1') ->> 'error',
  'FORBIDDEN',
  '3. nor can a provider whose story it is not'
);
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000ff') ->> 'error',
  'NOT_FOUND',
  '4. a comment that does not exist blocks nobody'
);

-- ── The block ──────────────────────────────────────────────────────────────
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c1')::jsonb,
  '{"success": true}'::jsonb,
  '5. the story''s provider blocks a stranger by their comment, and learns nothing about them'
);

reset role;
select is(
  (select count(*)::int from public.blocks
   where blocker_id = 'c5640000-0000-4564-8000-000000000010'
     and blocked_id = 'c5640000-0000-4564-8000-000000000001'),
  1,
  '6. it is an ordinary row in blocks, the provider''s own'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000002","role":"authenticated"}';
select is(
  (select string_agg(body, ',' order by body) from public.story_comment_feed
   where story_id = 'c5640000-0000-4564-8000-0000000000a1'),
  'from B,from C,from E',
  '7. every comment by the blocked author is gone for other viewers (D''s too, for D''s own block)'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where id = 'c5640000-0000-4564-8000-0000000000a1'),
  0,
  '8. the blocked author no longer sees the story'
);
select is(
  public.post_story_comment(gen_random_uuid(), 'c5640000-0000-4564-8000-0000000000a1', 'still here') ->> 'error',
  'NOT_FOUND',
  '9. ...and cannot comment on it'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c2')::jsonb,
  '{"success": true}'::jsonb,
  '10. blocking again through another of their comments is the same answer'
);

-- C's comment is deleted first, then used to block C.
select public.delete_story_comment('c5640000-0000-4564-8000-0000000000c3');
select public.block_story_commenter('c5640000-0000-4564-8000-0000000000c3');
reset role;
select is(
  (select count(*)::int from public.blocks
   where blocker_id = 'c5640000-0000-4564-8000-000000000010'
     and blocked_id = 'c5640000-0000-4564-8000-000000000003'),
  1,
  '11. a comment the provider already deleted still blocks its author'
);

-- D had already blocked P; the answer does not say so.
set local role authenticated;
select is(
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c4')::jsonb,
  '{"success": true}'::jsonb,
  '12. the answer is the same when the author had already blocked the provider'
);

-- ── Finding it again ────────────────────────────────────────────────────────
-- P has blocked A, C and D, none of whom P ever chatted with. Ordered by
-- byte value, so the collation cannot move it (no row has an id to order by).
select is(
  (select string_agg(display_name || ' / ' || coalesce(avatar_url, '-'), ', '
                     order by (display_name || ' / ' || coalesce(avatar_url, '-')) collate "C")
   from public.blocked_people),
  'Member c564 / -, Member c564 / -, loud_heron / clay:bloom',
  '13. the provider''s block list names every commenter they blocked, by their public name'
);

-- The harvest: block, read the row's blocked_id, unblock. The row is the
-- provider's own, and 005 used to let them read all of it.
select is(
  (select count(*)::int from public.blocks),
  0,
  '13a. the block rows do not hand the provider the commenters'' account ids: none of them is the provider''s to read'
);
select lives_ok(
  $$ select * from public.blocks $$,
  '13c. and the table read an installed build makes, select *, still works'
);
select is(
  (select count(*)::int || '|' || count(blocked_id)::int
   from public.blocked_people bp
   where row_to_json(bp)::text !~ 'c5640000-0000-4564-8000-00000000000[134]'),
  '3|0',
  '13b. nor does the list: every row is there, by handle, and none carries a commenter''s id'
);

select is(
  (select string_agg(column_name::text, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'blocked_people'),
  'handle,blocked_id,display_name,avatar_url,blocked_at',
  '14. the list publishes a handle, a name and an avatar, and no phone or email'
);

-- D blocked P (the fixture) and P blocked D (12): D sees only their own.
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000004","role":"authenticated"}';
select is(
  (select string_agg(display_name, ', ') from public.blocked_people),
  'Provider564-10',
  '15. a member''s list shows the provider they blocked, and not that the provider blocked them back'
);
-- D blocked P with no conversation (the fixture): the discovery card's block
-- before 096. The provider's id is the directory's anyway, and without it the
-- block set cannot hide the card.
select is(
  (select string_agg(coalesce(blocked_id::text, 'null'), ', ') from public.blocked_people)
  || ' | ' || (select string_agg(blocked_id::text, ', ') from public.blocks),
  'c5640000-0000-4564-8000-000000000010 | c5640000-0000-4564-8000-000000000010',
  '15b. a member''s block of a provider they never chatted with keeps the provider''s id, on the list and the row'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.blocked_people),
  0,
  '16. being blocked puts nothing on your own list'
);

-- ── Undoing it ─────────────────────────────────────────────────────────────
-- By an account id it is refused: that WHERE reads blocked_id, which is the
-- same question as reading it (a delete that removed a row would confirm it).
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
delete from public.blocks where blocked_id = 'c5640000-0000-4564-8000-000000000001';
reset role;
select is(
  (select count(*)::int from public.blocks
   where blocker_id = 'c5640000-0000-4564-8000-000000000010'
     and blocked_id = 'c5640000-0000-4564-8000-000000000001'),
  1,
  '17a. an unblock by account id lifts nothing, so it cannot confirm a guess either'
);

-- The client's own unblock (useUnblockUser): unblock_by_handle, by the
-- handle the list shows, so no conversation is needed.
set local role authenticated;
select is(
  public.unblock_by_handle(
    (select handle from public.blocked_people where display_name = 'loud_heron'))::jsonb,
  '{"success": true}'::jsonb,
  '17b. the provider unblocks by the handle'
);
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where id = 'c5640000-0000-4564-8000-0000000000a1'),
  1,
  '17. the provider can lift it like any block, and the story is visible again'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from public.blocked_people where display_name = 'loud_heron'),
  0,
  '18. and the unblocked commenter leaves the provider''s list'
);

-- ── A viewer blocks a commenter ────────────────────────────────────────────
-- B, a member, reads E's comment; they share no conversation, and never can.
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ insert into public.blocks (blocker_id, blocked_id)
     values ('c5640000-0000-4564-8000-000000000002', 'c5640000-0000-4564-8000-000000000005') $$,
  '42501',
  null,
  '21. a member cannot block another member by inserting the row: there is no conversation'
);
select is(
  public.block_story_comment_author('c5640000-0000-4564-8000-0000000000c6')::jsonb,
  '{"success": true}'::jsonb,
  '22. a member viewer blocks a commenter by the comment, and learns nothing about them'
);
select is(
  public.block_story_comment_author('c5640000-0000-4564-8000-0000000000c6') ->> 'error',
  'NOT_FOUND',
  '23. the comment is gone for them now, so a second try is the answer for any comment they cannot see'
);
select is(
  (select string_agg(body, ',' order by body) from public.story_comment_feed
   where story_id = 'c5640000-0000-4564-8000-0000000000a1')
  || ' | ' || (select string_agg(display_name || ' ' || coalesce(blocked_id::text, 'null'), ', ')
               from public.blocked_people)
  || ' | ' || (select count(*)::int from public.blocks),
  'first,from B,second | Member c564 null | 0',
  '24. the author''s comments are gone for the viewer, the block is on their list by name, and no row or id names the author'
);
select is(
  public.block_story_comment_author('c5640000-0000-4564-8000-0000000000c5') ->> 'error',
  'FORBIDDEN',
  '25. nobody blocks themselves through their own comment'
);
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000003","role":"authenticated"}';
select is(
  public.block_story_comment_author('c5640000-0000-4564-8000-0000000000c6') ->> 'error',
  'NOT_FOUND',
  '26. a comment the caller cannot see blocks nobody (C, blocked by the provider, cannot see the story)'
);
select throws_ok(
  $$ select public.share_conversation('c5640000-0000-4564-8000-000000000002',
                                      'c5640000-0000-4564-8000-000000000010') $$,
  '42501',
  null,
  '27. share_conversation, which answers about any two accounts, is not a client''s to call'
);
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';

-- The story's day is over (both ends moved, so story_lasts_a_day holds).
reset role;
update public.stories
set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
where id = 'c5640000-0000-4564-8000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select set_config('test.expired_block',
  public.block_story_commenter('c5640000-0000-4564-8000-0000000000c5')::text, true);
reset role;
select is(
  current_setting('test.expired_block') || '|'
  || (select count(*)::int from public.blocks
      where blocker_id = 'c5640000-0000-4564-8000-000000000010'
        and blocked_id = 'c5640000-0000-4564-8000-000000000002'),
  '{"success" : true}|1',
  '18b. a comment on a story that has expired still blocks its author'
);

reset role;
set local role anon;
select throws_ok(
  $$ select public.block_story_commenter('c5640000-0000-4564-8000-0000000000c1') $$,
  '42501',
  null,
  '19. no signed-out caller can run it'
);
select throws_ok(
  $$ select * from public.blocked_people $$,
  '42501',
  null,
  '20. nor read anyone''s block list'
);
select throws_ok(
  $$ select public.block_story_comment_author('c5640000-0000-4564-8000-0000000000c6') $$,
  '42501',
  null,
  '28. nor block a commenter as a viewer'
);
select throws_ok(
  $$ select public.unblock_by_handle(gen_random_uuid()) $$,
  '42501',
  null,
  '29. nor unblock'
);

select * from finish();
rollback;
