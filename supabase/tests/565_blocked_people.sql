-- pgTAP for the Blocked screen's data source: blocked_people (152).
--
-- 564 proves the view lists a commenter the provider blocked. This suite is
-- about the SCREEN's contract, which is wider than stories: BlockedUsersScreen
-- reads nothing but this view, so every block the caller can make has to
-- appear on it, and the unblock it offers (useUnblockUser in
-- src/api/safety.ts, `unblock_by_handle(<handle>)`) has to lift the caller's
-- block and nobody else's.
--
-- WHAT THIS IS GUARDING:
--
--   * A provider's list holds the members they blocked, by public name,
--     whether the block came from a chat (096) or from a story comment
--     (block_story_commenter). The chat case was invisible before too: the
--     old screen resolved names through the provider directory, which has no
--     members (1).
--   * Nothing private rides along: no phone number or email in any value, and
--     an avatar that is a URL is withheld, only a clay pick is shown (2, 3).
--   * Each caller sees their own blocks and no one else's: not the blocks
--     made against them, not a third party's, and not by filtering the view
--     for somebody else's blocked id (4-6).
--   * The client's unblock, by the handle the list shows, lifts only the
--     caller's own row: another member's handle for the same person lifts
--     nothing (7), and a provider lifts a comment-made block of a member from
--     the list with no conversation between them (8).
--   * An installed build's own statements still work on the blocks they
--     could make: its block set, `from('blocks').select('*')`, and its
--     unblock, a delete by blocked_id (13, 14). 152 first revoked the column
--     they read, and both answered "permission denied".
--   * The list names a chat peer's account, which the caller already has from
--     the conversation and the block set hides threads by, and never a
--     commenter's (12).
--   * A name is shown only in a name's shape, as on the other story
--     surfaces (9).
--   * The WHERE is the access control, so the view is a security barrier
--     (10), and a caller's own filter that raises cannot be run on another
--     user's row and put their blocked id into the error (11). The probe
--     forces a sequential scan: with the default plan the WHERE rides the
--     blocks_pkey index condition and nothing leaks even without the
--     barrier, which is how dropping it passed every suite.

\set ON_ERROR_STOP on
begin;
select plan(14);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id, phone, email) values
  ('d5650000-0000-4565-8000-000000000001', '919800000565', 'm1-565@test.local'),  -- M1, chatted with P and Q
  ('d5650000-0000-4565-8000-000000000002', '919800000566', 'm2-565@test.local'),  -- M2, only ever commented
  ('d5650000-0000-4565-8000-000000000003', null, null),                           -- M3, chatted with Q
  ('d5650000-0000-4565-8000-000000000004', null, null),                           -- M4, a bystander
  ('d5650000-0000-4565-8000-000000000010', null, null),                           -- provider P
  ('d5650000-0000-4565-8000-000000000011', null, null);                           -- provider Q

-- M1 finished setup with a clay pick. M2 never did, and left a phone-shaped
-- name and a URL avatar behind: neither may surface.
update public.profiles
set display_name = 'quiet_otter', avatar_url = 'clay:fern', profile_completed_at = now()
where id = 'd5650000-0000-4565-8000-000000000001';

update public.profiles
set display_name = '+919800000566', avatar_url = 'https://example.test/m2.jpg'
where id = 'd5650000-0000-4565-8000-000000000002';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider565-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id in ('d5650000-0000-4565-8000-000000000010',
              'd5650000-0000-4565-8000-000000000011');

select test.accept_current_policies(id)
from public.profiles
where id::text like 'd5650000-%';

insert into public.conversations (id, member_id, provider_id) values
  ('d5650000-0000-4565-8000-0000000000b1', 'd5650000-0000-4565-8000-000000000001',
   'd5650000-0000-4565-8000-000000000010'),
  ('d5650000-0000-4565-8000-0000000000b2', 'd5650000-0000-4565-8000-000000000001',
   'd5650000-0000-4565-8000-000000000011'),
  ('d5650000-0000-4565-8000-0000000000b3', 'd5650000-0000-4565-8000-000000000003',
   'd5650000-0000-4565-8000-000000000011');

insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
values
  ('d5650000-0000-4565-8000-0000000000a1', 'd5650000-0000-4565-8000-000000000010', 'image',
   'd5650000-0000-4565-8000-000000000010/d5650000-0000-4565-8000-0000000000a1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours');

insert into public.story_comments (id, story_id, author_id, body) values
  ('d5650000-0000-4565-8000-0000000000c1', 'd5650000-0000-4565-8000-0000000000a1',
   'd5650000-0000-4565-8000-000000000002', 'from M2');

-- Every block through the path a client really has, as its owner.
set local role authenticated;

-- P blocks M1 from their chat (096), and M2 from the comment (152).
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000010","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id) values
  ('d5650000-0000-4565-8000-000000000010', 'd5650000-0000-4565-8000-000000000001');
select public.block_story_commenter('d5650000-0000-4565-8000-0000000000c1');

-- M1 and M3 both block Q, each from their own chat.
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000001","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id) values
  ('d5650000-0000-4565-8000-000000000001', 'd5650000-0000-4565-8000-000000000011');
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000003","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id) values
  ('d5650000-0000-4565-8000-000000000003', 'd5650000-0000-4565-8000-000000000011');

-- ── Every block is listed, by public name ──────────────────────────────────
-- Ordered by id (M1 001, M2 002) rather than by name, so collation cannot
-- move it.
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000010","role":"authenticated"}';
select is(
  (select string_agg(display_name || ' / ' || coalesce(avatar_url, '-'), ', '
                     order by blocked_id)
   from public.blocked_people),
  'quiet_otter / clay:fern, Member d565 / -',
  '1. a provider''s list names the member blocked from a chat and the one blocked from a comment'
);

select is(
  (select count(*)::int from public.blocked_people bp
   where row_to_json(bp)::text ~ '(9800000565|9800000566|@test\.local)'),
  0,
  '2. no value on the list is a phone number or an email, even one left in a display name'
);

select is(
  (select count(*)::int from public.blocked_people
   where avatar_url is not null and avatar_url not like 'clay:%'),
  0,
  '3. an avatar that is a URL is withheld; only a clay pick is shown'
);

-- ── Only the caller's own ──────────────────────────────────────────────────
-- M1 is blocked by P and has blocked Q: only Q is theirs.
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(display_name, ', ') from public.blocked_people),
  'Provider565-11',
  '4. a member''s list holds the provider they blocked, not the provider who blocked them'
);

set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.blocked_people),
  0,
  '5. a bystander''s list is empty while four blocks exist around them'
);

select is(
  (select count(*)::int from public.blocked_people
   where blocked_id in ('d5650000-0000-4565-8000-000000000001',
                        'd5650000-0000-4565-8000-000000000011')),
  0,
  '6. ...and filtering the view by somebody else''s blocked id finds nothing'
);

-- ── Unblocking from the list ───────────────────────────────────────────────
-- useUnblockUser's exact statement, which names no blocker: RLS (005's owner
-- policy) is what keeps M3 from lifting M1's block of Q, even with the handle
-- of M1's row in hand, and M3's own handle lifts M3's.
reset role;
select set_config('test.m1_handle',
  (select handle::text from public.blocks
   where blocker_id = 'd5650000-0000-4565-8000-000000000001'
     and blocked_id = 'd5650000-0000-4565-8000-000000000011'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000003","role":"authenticated"}';
select public.unblock_by_handle(current_setting('test.m1_handle')::uuid);
select public.unblock_by_handle(
  (select handle from public.blocked_people
   where blocked_id = 'd5650000-0000-4565-8000-000000000011'));
reset role;
select is(
  (select string_agg(right(blocker_id::text, 2), ',' order by blocker_id)
   from public.blocks
   where blocked_id = 'd5650000-0000-4565-8000-000000000011'),
  '01',
  '7. unblocking lifts the caller''s own block only; another member''s block of the same provider stays'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000010","role":"authenticated"}';
-- M1 is P's chat peer (b1), so the list names M1's account; M2 only ever
-- commented, so M2's row has a handle and no account id.
select is(
  (select string_agg(coalesce(blocked_id::text, 'null') || ' ' || display_name, ', '
                     order by blocked_id)
   from public.blocked_people),
  'd5650000-0000-4565-8000-000000000001 quiet_otter, null Member d565',
  '12. the list names a chat peer''s account, never a commenter''s'
);
select public.unblock_by_handle(
  (select handle from public.blocked_people where blocked_id is null));
select is(
  (select string_agg(display_name, ', ') from public.blocked_people),
  'quiet_otter',
  '8. a provider unblocks a member they never chatted with from the list, and only that member leaves it'
);

-- A finished member whose display_name was PATCHed to a contact line and a
-- wall of newlines (148's public_display_name): the list shows the handle.
reset role;
update public.profiles
set display_name = 'call 98xxxxxxxx' || repeat(E'\n', 200), profile_completed_at = now()
where id = 'd5650000-0000-4565-8000-000000000004';
insert into public.blocks (blocker_id, blocked_id) values
  ('d5650000-0000-4565-8000-000000000010', 'd5650000-0000-4565-8000-000000000004');
set local role authenticated;
-- M4 never chatted with P either, so the row is found as the one with no id.
select is(
  (select display_name from public.blocked_people where blocked_id is null),
  'Member d565',
  '9. a display name that is not a name is listed as the handle, as on every story surface'
);

reset role;
select is(
  (select array_to_string(reloptions, ',') from pg_class where oid = 'public.blocked_people'::regclass),
  'security_invoker=false,security_barrier=true',
  '10. the view is a definer view behind a security barrier'
);

-- M4 has blocked nobody, so no row of M4's own ever reaches the filter.
-- Without the barrier the planner pushes the cast below the view's WHERE on
-- a sequential scan, and it raised "invalid input syntax for type integer"
-- quoting another user's blocked_id.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000004","role":"authenticated"}';
set local enable_indexscan = off;
set local enable_bitmapscan = off;
select lives_ok(
  $$ select count(*) from public.blocked_people where (blocked_id::text)::int > 0 $$,
  '11. a filter that raises never sees another user''s row, even on a sequential scan'
);
reset enable_indexscan;
reset enable_bitmapscan;

-- ── What an installed build still does ─────────────────────────────────────
-- M1 blocked Q from their chat (7 left it): the block set a build before 152
-- reads, and the unblock it sends.
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(blocked_id::text, ',') from public.blocks),
  'd5650000-0000-4565-8000-000000000011',
  '13. an installed build''s select * from blocks still reads its own chat block'
);
delete from public.blocks where blocked_id = 'd5650000-0000-4565-8000-000000000011';
reset role;
select is(
  (select count(*)::int from public.blocks
   where blocker_id = 'd5650000-0000-4565-8000-000000000001'),
  0,
  '14. and its unblock, a delete by blocked_id, still lifts it'
);

select * from finish();
rollback;
