-- pgTAP for the Blocked screen's data source: blocked_people (152).
--
-- 564 proves the view lists a commenter the provider blocked. This suite is
-- about the SCREEN's contract, which is wider than stories: BlockedUsersScreen
-- reads nothing but this view, so every block the caller can make has to
-- appear on it, and the unblock it offers (useUnblockUser in
-- src/api/safety.ts, `delete from blocks where blocked_id = <id>` with no
-- blocker filter) has to lift the caller's block and nobody else's.
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
--   * The client's unblock, which relies on RLS rather than a blocker filter,
--     lifts only the caller's own row when two people blocked the same
--     person (7), and a provider lifts a comment-made block of a member from
--     the list with no conversation between them (8).

\set ON_ERROR_STOP on
begin;
select plan(8);

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
-- policy) is what keeps M3's unblock of Q from lifting M1's.
set local request.jwt.claims = '{"sub":"d5650000-0000-4565-8000-000000000003","role":"authenticated"}';
delete from public.blocks
where blocked_id = 'd5650000-0000-4565-8000-000000000011';
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
delete from public.blocks
where blocked_id = 'd5650000-0000-4565-8000-000000000002';
select is(
  (select string_agg(display_name, ', ') from public.blocked_people),
  'quiet_otter',
  '8. a provider unblocks a member they never chatted with from the list, and only that member leaves it'
);

select * from finish();
rollback;
