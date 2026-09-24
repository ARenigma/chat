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
--     still carries (13); it publishes a name and a clay avatar and no phone
--     or email (14); a member's list shows the provider they blocked (15) and
--     never who blocked them (15, 16).
--   * The block is an ordinary block: the provider can lift it through 005's
--     owner policy, with no conversation (17), and it leaves their list (18).
--     No signed-out caller can run the function or read the list (19, 20).

\set ON_ERROR_STOP on
begin;
select plan(20);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
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
   'c5640000-0000-4564-8000-000000000002', 'from B');

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
  'from B,from C',
  '7. every comment by the blocked author is gone for other viewers (D''s too, for D''s own block)'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where id = 'c5640000-0000-4564-8000-0000000000a1'),
  0,
  '8. the blocked author no longer sees the story'
);
select is(
  public.post_story_comment('c5640000-0000-4564-8000-0000000000a1', 'still here') ->> 'error',
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
-- P has blocked A, C and D, none of whom P ever chatted with. Ordered by id
-- (A 001, C 003, D 004) rather than by name, so the collation cannot move it.
select is(
  (select string_agg(display_name || ' / ' || coalesce(avatar_url, '-'), ', '
                     order by blocked_id)
   from public.blocked_people),
  'loud_heron / clay:bloom, Member c564 / -, Member c564 / -',
  '13. the provider''s block list names every commenter they blocked, by their public name'
);

select is(
  (select string_agg(column_name::text, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'blocked_people'),
  'blocked_id,display_name,avatar_url,blocked_at',
  '14. the list publishes a name and an avatar, and no phone or email'
);

-- D blocked P (the fixture) and P blocked D (12): D sees only their own.
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000004","role":"authenticated"}';
select is(
  (select string_agg(display_name, ', ') from public.blocked_people),
  'Provider564-10',
  '15. a member''s list shows the provider they blocked, and not that the provider blocked them back'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.blocked_people),
  0,
  '16. being blocked puts nothing on your own list'
);

-- ── Undoing it ─────────────────────────────────────────────────────────────
-- The client's own unblock (useUnblockUser): a DELETE on blocks under 005's
-- owner policy, which 096 left alone, so no conversation is needed.
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
delete from public.blocks
where blocked_id = 'c5640000-0000-4564-8000-000000000001';
set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where id = 'c5640000-0000-4564-8000-0000000000a1'),
  1,
  '17. the provider can lift it like any block, and the story is visible again'
);

set local request.jwt.claims = '{"sub":"c5640000-0000-4564-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from public.blocked_people
   where blocked_id = 'c5640000-0000-4564-8000-000000000001'),
  0,
  '18. and the unblocked commenter leaves the provider''s list'
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

select * from finish();
rollback;
