-- pgTAP for migrations 145, 146 and 149: who has seen a story, who reacted,
-- and who is allowed to know.
--
-- WHAT THIS IS GUARDING:
--
--   * That a view is idempotent and says nothing about stories the caller
--     cannot see: blocked and expired both answer NOT_FOUND (1-6).
--   * That seen-state is private: a member reads their own view and reaction
--     rows, never anyone else's (7, 8, 21).
--   * That a reaction is one per member per story, from the closed set,
--     replaceable and removable (9-13, with the row really gone, 13b), members
--     only (14, 15), and that reacting counts as a view (12).
--   * That the kill switch stops adding a reaction but never taking one back
--     (18, 19, 19b).
--   * The owner's split: every viewer sees COUNTS (20), the aggregate cannot
--     carry an identity (22), and only the story's provider sees WHO (23-25).
--     The counts follow the story's visibility: anyone asking about an
--     expired story, and a blocked member, get none (28b, 28c).
--   * That only members watch: another provider cannot record a view (24b),
--     so every viewer is a member and the list carries a clay avatar or
--     nothing, never a URL a viewer chose and no photo key (25-27).
--   * That a block made after the fact removes that person from the counts,
--     the viewer list and the provider's tray alike (28-30), and that the tray
--     is the caller's own live stories and nobody else's (31, 31b).

\set ON_ERROR_STOP on
begin;
select plan(39);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c5610000-0000-4561-8000-000000000001'),  -- member, finished setup
  ('c5610000-0000-4561-8000-000000000002'),  -- member, never finished setup
  ('c5610000-0000-4561-8000-000000000003'),  -- member, blocked with the provider
  ('c5610000-0000-4561-8000-000000000004'),  -- member, suspended
  ('c5610000-0000-4561-8000-000000000010'),  -- provider, listed, posts
  ('c5610000-0000-4561-8000-000000000011');  -- another listed provider

update public.profiles
set display_name = 'quiet_lark', avatar_url = 'clay:bloom', profile_completed_at = now()
where id = 'c5610000-0000-4561-8000-000000000001';

-- A member who never finished setup, whose avatar_url was PATCHed (070: it is
-- client-writable) to a lookalike of an avatars-bucket URL on somebody else's
-- host: exactly the shape a host-blind regex accepts.
update public.profiles
set avatar_url = 'https://tracker.example/storage/v1/object/public/avatars/c5610000-0000-4561-8000-000000000002/1.jpg'
where id = 'c5610000-0000-4561-8000-000000000002';

update public.profiles set suspended_until = now() + interval '1 day'
where id = 'c5610000-0000-4561-8000-000000000004';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider561-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id in ('c5610000-0000-4561-8000-000000000010',
              'c5610000-0000-4561-8000-000000000011');

insert into public.blocks (blocker_id, blocked_id) values
  ('c5610000-0000-4561-8000-000000000003', 'c5610000-0000-4561-8000-000000000010');

-- One live story and one expired one, by hand: 560 owns create_story.
insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
values
  ('c5610000-0000-4561-8000-0000000000a1', 'c5610000-0000-4561-8000-000000000010', 'image',
   'c5610000-0000-4561-8000-000000000010/c5610000-0000-4561-8000-0000000000a1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours'),
  ('c5610000-0000-4561-8000-0000000000a2', 'c5610000-0000-4561-8000-000000000010', 'image',
   'c5610000-0000-4561-8000-000000000010/c5610000-0000-4561-8000-0000000000a2.jpg', 7000,
   now() - interval '25 hours', now() - interval '1 hour'),
  -- Another provider's live story with an audience, so "the tray is mine
  -- only" (31) has something else to leave out.
  ('c5610000-0000-4561-8000-0000000000b1', 'c5610000-0000-4561-8000-000000000011', 'image',
   'c5610000-0000-4561-8000-000000000011/c5610000-0000-4561-8000-0000000000b1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours');

insert into public.story_views (story_id, viewer_id) values
  ('c5610000-0000-4561-8000-0000000000b1', 'c5610000-0000-4561-8000-000000000004');

-- A reaction left on the expired story, so its count is not empty by default
-- and "none for an expired story" (28b) is the visibility rule at work.
insert into public.story_reactions (story_id, member_id, emoji) values
  ('c5610000-0000-4561-8000-0000000000a2', 'c5610000-0000-4561-8000-000000000002', '👍');

-- ── Views ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000001","role":"authenticated"}';

select is(
  (public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a1') ->> 'first_view')::boolean,
  true,
  '1. the first view is recorded'
);
select is(
  (public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a1') ->> 'first_view')::boolean,
  false,
  '2. marking again is a no-op, not an error'
);

reset role;
select is(
  (select count(*)::int from public.story_views where story_id = 'c5610000-0000-4561-8000-0000000000a1'),
  1,
  '3. ...and there is still exactly one row'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000010","role":"authenticated"}';
select is(
  (public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a1') ->> 'success')::boolean,
  true,
  '4. the provider opening their own story succeeds...'
);
reset role;
select is(
  (select count(*)::int from public.story_views
   where viewer_id = 'c5610000-0000-4561-8000-000000000010'),
  0,
  '5. ...but is not counted as a viewer of it'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000003","role":"authenticated"}';
select is(
  public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a1') ->> 'error'
  || '/' ||
  (public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a2') ->> 'error'),
  'NOT_FOUND/NOT_FOUND',
  '6. a blocked member and an expired story get the same NOT_FOUND'
);

set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_views),
  1,
  '7. a member reads their own view'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_views),
  0,
  '8. ...and nobody else''s'
);

-- ── Reactions ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000001","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '🔥') ->> 'error',
  'BAD_REQUEST',
  '9. an emoji outside the allowlist is refused'
);
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️') ->> 'emoji',
  '❤️',
  '10. a member reacts with a heart'
);
select public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '😂');
select is(
  (select string_agg(emoji, ',') from public.story_reactions
   where story_id = 'c5610000-0000-4561-8000-0000000000a1'),
  '😂',
  '11. a different emoji replaces it: still one reaction per member'
);

-- 002 reacts without ever calling mark_story_viewed. Checked in a second
-- statement: a statement's snapshot does not see what a function it calls
-- wrote, so the count cannot share a SELECT with the call.
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000002","role":"authenticated"}';
select public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '😂');
select is(
  (select count(*)::int from public.story_views),
  1,
  '12. reacting is seeing: it records a view too'
);

set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000001","role":"authenticated"}';
select is(
  (select (r ->> 'success') || '/' || coalesce(r ->> 'emoji', 'null')
   from (select public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '😂') as r) x),
  'true/null',
  '13. the same emoji again takes the reaction back'
);
-- In its own statement: the call's delete is not visible to the SELECT that
-- made it, and a removal that deleted nothing returned the same json.
select is(
  (select count(*)::int from public.story_reactions
   where story_id = 'c5610000-0000-4561-8000-0000000000a1'
     and member_id = 'c5610000-0000-4561-8000-000000000001'),
  0,
  '13b. ...and the row is gone, not just reported gone'
);
select public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️');

set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000010","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️') ->> 'error',
  'FORBIDDEN',
  '14. the provider cannot react to their own story'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000011","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️') ->> 'error',
  'NOT_FOUND',
  '15. nor can another provider, who is not an audience and cannot even see it'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000003","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️') ->> 'error',
  'NOT_FOUND',
  '16. a blocked member cannot react to a story they cannot see'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000004","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '❤️') ->> 'error',
  'SUSPENDED',
  '17. a suspended member cannot react'
);

-- The kill switch stops adding, never removing.
reset role;
update admin.config_active
set payload = payload || '{"stories_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000002","role":"authenticated"}';
select is(
  public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '👍') ->> 'error',
  'STORIES_DISABLED',
  '18. a new reaction is refused while stories are switched off'
);
select is(
  (public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '😂') ->> 'success')::boolean,
  true,
  '19. ...but taking one back still works'
);
select is(
  (select count(*)::int from public.story_reactions
   where story_id = 'c5610000-0000-4561-8000-0000000000a1'
     and member_id = 'c5610000-0000-4561-8000-000000000002'),
  0,
  '19b. ...and really removes the row while switched off'
);

reset role;
update admin.config_active
set payload = payload - 'stories_enabled'
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
select public.toggle_story_reaction('c5610000-0000-4561-8000-0000000000a1', '😂');

-- ── Counts for everyone, identities for the provider ──────────────────────
select is(
  (select string_agg(emoji || ':' || reaction_count, ',' order by emoji)
   from public.story_reaction_counts('c5610000-0000-4561-8000-0000000000a1')),
  '❤️:1,😂:1',
  '20. any viewer sees the count per emoji'
);
select is(
  (select count(*)::int from public.story_reactions
   where member_id = 'c5610000-0000-4561-8000-000000000001'),
  0,
  '21. ...but cannot read another member''s reaction row'
);
select is(
  pg_get_function_result('public.story_reaction_counts(uuid)'::regprocedure),
  'TABLE(emoji text, reaction_count integer)',
  '22. the aggregate has no column that could carry an identity'
);
select throws_ok(
  $$ select * from public.story_viewers('c5610000-0000-4561-8000-0000000000a1') $$,
  '42501',
  'FORBIDDEN',
  '23. a member cannot read who viewed or reacted'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000011","role":"authenticated"}';
select throws_ok(
  $$ select * from public.story_viewers('c5610000-0000-4561-8000-0000000000a1') $$,
  '42501',
  'FORBIDDEN',
  '24. nor can another provider'
);

-- Another provider cannot watch: the audience is members (143).
select is(
  public.mark_story_viewed('c5610000-0000-4561-8000-0000000000a1') ->> 'error',
  'NOT_FOUND',
  '24b. another provider cannot watch the story, so never appears among its viewers'
);

set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000010","role":"authenticated"}';
select is(
  (select string_agg(display_name || ':' || coalesce(reaction, '-') || ':' || coalesce(avatar_url, '-'),
                     ',' order by viewer_id)
   from public.story_viewers('c5610000-0000-4561-8000-0000000000a1')),
  'quiet_lark:❤️:clay:bloom,'
  || public.member_handle('c5610000-0000-4561-8000-000000000002') || ':😂:-',
  '25. the provider sees each viewer by public name, with what they reacted'
);
select is(
  (select count(*)::int from public.story_viewers('c5610000-0000-4561-8000-0000000000a1')
   where avatar_url like 'http%'),
  0,
  '26. no viewer''s avatar comes back as a URL: a lookalike host is dropped'
);
select is(
  pg_get_function_result('public.story_viewers(uuid)'::regprocedure),
  'TABLE(viewer_id uuid, display_name text, avatar_url text, viewed_at timestamp with time zone, reaction text)',
  '27. the viewer list has a clay avatar at most: no URL, and no photo key a provider viewer needed'
);

-- A block made after the fact: 001 blocks the provider.
reset role;
insert into public.blocks (blocker_id, blocked_id) values
  ('c5610000-0000-4561-8000-000000000001', 'c5610000-0000-4561-8000-000000000010');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000002","role":"authenticated"}';
select is(
  (select string_agg(emoji || ':' || reaction_count, ',' order by emoji)
   from public.story_reaction_counts('c5610000-0000-4561-8000-0000000000a1')),
  '😂:1',
  '28. a reactor now blocked with the provider drops out of the public count'
);
select is(
  (select count(*)::int from public.story_reaction_counts('c5610000-0000-4561-8000-0000000000a2')),
  0,
  '28b. an expired story has no public counts, though it still has a reaction'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_reaction_counts('c5610000-0000-4561-8000-0000000000a1')),
  0,
  '28c. a member blocked with the provider gets no counts for a story they cannot see'
);

set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_viewers('c5610000-0000-4561-8000-0000000000a1')),
  1,
  '29. ...and out of the provider''s viewer list'
);
select is(
  (select view_count || '/' || reaction_count || '/' || comment_count
   from public.my_story_insights()
   where story_id = 'c5610000-0000-4561-8000-0000000000a1'),
  '1/1/0',
  '30. the provider''s tray counts agree with the lists they open'
);
select is(
  (select string_agg(story_id::text, ',') from public.my_story_insights()),
  'c5610000-0000-4561-8000-0000000000a1',
  '31. the tray lists the caller''s own live stories only: not the expired one, not another provider''s'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_story_insights()),
  0,
  '31b. a member has no tray, and reads no provider''s counts through it'
);
set local request.jwt.claims = '{"sub":"c5610000-0000-4561-8000-000000000010","role":"authenticated"}';
select throws_ok(
  $$ select * from public.story_viewers('c5610000-0000-4561-8000-0000000000a2') $$,
  '42501',
  'FORBIDDEN',
  '32. an expired story has no viewer list, even for its provider'
);

select throws_ok(
  $$ insert into public.story_reactions (story_id, member_id, emoji)
     values ('c5610000-0000-4561-8000-0000000000a1', 'c5610000-0000-4561-8000-000000000010', '❤️') $$,
  '42501',
  null,
  '33. no client writes a reaction around toggle_story_reaction'
);

select * from finish();
rollback;
