-- pgTAP for migrations 143-144: who may post a story, and who may see one.
--
-- WHAT THIS IS GUARDING, rather than "the happy path works":
--
--   * That posting is the DIRECTORY's to grant. A member, an unlisted provider
--     and a suspended one are each refused by the server, whatever the client
--     draws (1, 2, 29). A listed provider still needs the policy gate (3).
--   * That the row cannot be forged around the RPC: no INSERT or UPDATE grant
--     at all (17, 18), and the path must be the provider's own folder with an
--     extension that agrees with the type (9, 10). A retry is not a second
--     story (8).
--   * That the owner's two numbers hold server-side: 30 live stories (20-22,
--     with expired ones not counted) and 30 seconds of video (11, 12), and
--     that an image is held 1-15 seconds (12b, 12c).
--   * That a caption is short and visible: 200 characters (13, 13b),
--     blank-looking is no caption rather than an empty bar (14, 15), and at
--     most four lines (16, 16b). Every limit is asserted from BOTH sides, so a
--     CHECK narrowed or widened by mistake fails here.
--   * That a caption carries no control character: DEL alone and an ESC
--     sequence inside ordinary words are refused, while tab, CRLF, emoji and
--     Devanagari are text (16c-16f).
--   * That the kill switch stops posting (19), and that 143 published it ON
--     in both environments next to the call controls, so the admin console
--     opens on the real state and a publish carries it forward (33).
--   * That visibility is one rule, the owner's "any member": a member sees a
--     listed provider's live stories (23); another provider, listed or an
--     applicant, sees none of them (24, 24b); a blocked pair, an expired
--     story, an unlisted provider's story and a signed-out caller see nothing
--     (23, 25, 26, 28, 30); the provider sees their own live ones (27).
--   * That the provider, and only the provider, takes a story down (31, 32).

\set ON_ERROR_STOP on
begin;
select plan(42);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c5600000-0000-4560-8000-000000000001'),  -- member
  ('c5600000-0000-4560-8000-000000000002'),  -- provider, listed
  ('c5600000-0000-4560-8000-000000000003'),  -- provider, unlisted (unverified)
  ('c5600000-0000-4560-8000-000000000004'),  -- provider, listed, for the cap
  ('c5600000-0000-4560-8000-000000000005'),  -- member, blocked with 002
  ('c5600000-0000-4560-8000-000000000006'),  -- provider, listed, no policies
  ('c5600000-0000-4560-8000-000000000007');  -- provider, listed, for the accepted edges

update public.profiles
set display_name = 'quiet_lark', avatar_url = 'clay:bloom', profile_completed_at = now()
where id = 'c5600000-0000-4560-8000-000000000001';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider560-' || right(id::text, 1),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = case
         when id = 'c5600000-0000-4560-8000-000000000003' then null else now() end
where  id in ('c5600000-0000-4560-8000-000000000002',
              'c5600000-0000-4560-8000-000000000003',
              'c5600000-0000-4560-8000-000000000004',
              'c5600000-0000-4560-8000-000000000006',
              'c5600000-0000-4560-8000-000000000007');

select test.accept_current_policies(id)
from public.profiles
where id in ('c5600000-0000-4560-8000-000000000001',
             'c5600000-0000-4560-8000-000000000002',
             'c5600000-0000-4560-8000-000000000003',
             'c5600000-0000-4560-8000-000000000004',
             'c5600000-0000-4560-8000-000000000005',
             'c5600000-0000-4560-8000-000000000007');

-- Blocks are inserted as the owner: the 096 policy wants a prior conversation,
-- which is not what this suite is about.
insert into public.blocks (blocker_id, blocked_id) values
  ('c5600000-0000-4560-8000-000000000002', 'c5600000-0000-4560-8000-000000000005');

-- ── Who may post ───────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000001","role":"authenticated"}';

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000001a1', 'image',
    'c5600000-0000-4560-8000-000000000001/c5600000-0000-4560-8000-0000000001a1.jpg'
  ) ->> 'error',
  'NOT_LISTED',
  '1. a member cannot post a story'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000003","role":"authenticated"}';
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000003a1', 'image',
    'c5600000-0000-4560-8000-000000000003/c5600000-0000-4560-8000-0000000003a1.jpg'
  ) ->> 'error',
  'NOT_LISTED',
  '2. a provider who is not listed cannot post a story'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000006","role":"authenticated"}';
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000006a1', 'image',
    'c5600000-0000-4560-8000-000000000006/c5600000-0000-4560-8000-0000000006a1.jpg'
  ) ->> 'error',
  'POLICY_REQUIRED',
  '3. a listed provider who has not accepted the current policies cannot post'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000002","role":"authenticated"}';
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a1', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a1.jpg',
    '  first light  '
  ) ->> 'success')::boolean,
  true,
  '4. a listed provider posts an image story'
);

reset role;
select is(
  (select duration_ms from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1'),
  7000,
  '5. an image with no duration holds for the 7s default'
);
select is(
  (select expires_at - created_at from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1'),
  interval '24 hours',
  '6. a story lasts exactly a day'
);
select is(
  (select caption from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1'),
  'first light',
  '7. the caption is stored trimmed'
);

-- The retry's result is kept and counted in a later statement: a statement's
-- snapshot never sees what a function it calls wrote, so a count sharing the
-- SELECT with the call would pass whether or not a duplicate was made.
set local role authenticated;
create temp table retry560 as
select public.create_story(
  'c5600000-0000-4560-8000-0000000002a1', 'image',
  'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a1.jpg'
) as result;
select is(
  (select result ->> 'story_id' from retry560)
  || '/' || (select count(*) from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  'c5600000-0000-4560-8000-0000000002a1/1',
  '8. a retry with the same id is the same story, not a second one'
);

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000001/c5600000-0000-4560-8000-0000000002a9.jpg'
  ) ->> 'error',
  'BAD_REQUEST',
  '9. media outside the provider''s own folder is refused'
);

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'video',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg', null, 5000
  ) ->> 'error',
  'BAD_REQUEST',
  '10. a video whose file is not .mp4 is refused'
);

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'video',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.mp4', null, 30001
  ) ->> 'error',
  'BAD_REQUEST',
  '11. a video over 30 seconds is refused'
);

select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a2', 'video',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a2.mp4', null, 30000
  ) ->> 'success')::boolean,
  true,
  '12. a 30 second video is accepted'
);

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg',
    repeat('x', 201)
  ) ->> 'error',
  'BAD_REQUEST',
  '13. a caption over 200 characters is refused'
);

-- Newline, tab, zero-width space, no-break space, Hangul filler: nothing a
-- viewer would see. chr() rather than literals, which review cannot see either.
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a4', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a4.jpg',
    E'\n\t' || chr(8203) || chr(160) || chr(12644) || E'\n'
  ) ->> 'success')::boolean,
  true,
  '14. a caption with nothing visible in it does not stop the story...'
);
reset role;
select is(
  (select caption from public.stories where id = 'c5600000-0000-4560-8000-0000000002a4'),
  null::text,
  '15. ...it is stored as no caption at all'
);
set local role authenticated;
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg',
    'one' || repeat(E'\nmore', 4)
  ) ->> 'error',
  'BAD_REQUEST',
  '16. a caption of more than four lines is refused'
);

-- The refused edges, as 002: an image held just over 15 seconds, and just
-- under one.
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg', null, 15001
  ) ->> 'error')
  || '/' ||
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg', null, 999
  ) ->> 'error'),
  'BAD_REQUEST/BAD_REQUEST',
  '12c. an image held over 15 seconds, or under one, is refused'
);

-- Control characters (143, section 0). DEL passes story_text_trim as
-- visible, so without the CHECK it was a caption of nothing; ESC [2K ESC [1A
-- erases the line above in a terminal, which is where a report of it is read.
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg',
    chr(127)
  ) ->> 'error')
  || '/' ||
  (public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg',
    chr(155)
  ) ->> 'error'),
  'BAD_REQUEST/BAD_REQUEST',
  '16c. a caption that is only a control character, C0 or C1, is refused'
);
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg',
    'you are vile' || chr(27) || '[2K' || chr(27) || '[1A' || chr(27) || '[2K  lovely photo'
  ) ->> 'error',
  'BAD_REQUEST',
  '16d. ...and so is an escape sequence hidden inside ordinary words'
);

select throws_ok(
  $$ insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
     values ('c5600000-0000-4560-8000-0000000002a8', 'c5600000-0000-4560-8000-000000000002', 'image',
             'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a8.jpg',
             7000, now(), now() + interval '24 hours') $$,
  '42501',
  null,
  '17. a client cannot insert a story around create_story'
);

select throws_ok(
  $$ update public.stories set expires_at = now() + interval '10 days'
     where id = 'c5600000-0000-4560-8000-0000000002a1' $$,
  '42501',
  null,
  '18. a client cannot extend a story by updating it'
);

-- ── The accepted edges ─────────────────────────────────────────────────────
-- As 007, so 002's story count, which the visibility block below asserts, is
-- untouched. Each limit is asserted from the refused side above; these are the
-- other side, so a narrowed CHECK fails as surely as a widened one.
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000007","role":"authenticated"}';
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000007a1', 'image',
    'c5600000-0000-4560-8000-000000000007/c5600000-0000-4560-8000-0000000007a1.jpg',
    repeat('x', 200)
  ) ->> 'success')::boolean,
  true,
  '13b. a caption of exactly 200 characters is accepted'
);
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000007a2', 'image',
    'c5600000-0000-4560-8000-000000000007/c5600000-0000-4560-8000-0000000007a2.jpg',
    'one' || repeat(E'\nmore', 3)
  ) ->> 'success')::boolean,
  true,
  '16b. a caption of exactly four lines is accepted'
);
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000007a3', 'image',
    'c5600000-0000-4560-8000-000000000007/c5600000-0000-4560-8000-0000000007a3.jpg', null, 15000
  ) ->> 'success')::boolean,
  true,
  '12b. an image held for exactly 15 seconds is accepted'
);
-- Tab, CRLF, a heart with its U+FE0F, and Devanagari: all text, none of it a
-- control, so the control rule cannot be what refuses a real caption.
select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000007a4', 'image',
    'c5600000-0000-4560-8000-000000000007/c5600000-0000-4560-8000-0000000007a4.jpg',
    'first' || chr(9) || 'light' || chr(13) || chr(10) || 'नमस्ते ' || chr(10084) || chr(65039)
  ) ->> 'success')::boolean,
  true,
  '16e. tab, CRLF, an emoji and Devanagari are text, and accepted'
);
reset role;
select is(
  (select caption from public.stories where id = 'c5600000-0000-4560-8000-0000000007a4'),
  'first' || chr(9) || 'light' || chr(13) || chr(10) || 'नमस्ते ' || chr(10084) || chr(65039),
  '16f. ...and stored exactly as written'
);

-- ── The kill switch ────────────────────────────────────────────────────────
reset role;
-- Numbered last because it was added last; it has to run here, before 19
-- rewrites the payload, to read what the migration left.
select is(
  (select string_agg(
            environment || ':' || coalesce(payload ->> 'stories_enabled', 'absent')
              || ':' || (payload ? 'video_calls_enabled')::text,
            ',' order by environment)
   from admin.config_active
   where domain = 'kill_switches'),
  'prod:true:true,staging:true:true',
  '33. stories_enabled is published ON in both environments, beside the call controls it did not drop'
);

update admin.config_active
set payload = payload || '{"stories_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000002a9', 'image',
    'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a9.jpg'
  ) ->> 'error',
  'STORIES_DISABLED',
  '19. nothing is posted while kill_switches.stories_enabled is off'
);

reset role;
update admin.config_active
set payload = payload - 'stories_enabled'
where domain = 'kill_switches' and environment = 'prod';

-- ── The cap: 30 live stories, expired ones not counted ─────────────────────
insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
select g.id, 'c5600000-0000-4560-8000-000000000004', 'image',
       'c5600000-0000-4560-8000-000000000004/' || g.id || '.jpg', 7000,
       now() - interval '1 hour', now() + interval '23 hours'
from (select gen_random_uuid() as id from generate_series(1, 29)) g;

insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
select g.id, 'c5600000-0000-4560-8000-000000000004', 'image',
       'c5600000-0000-4560-8000-000000000004/' || g.id || '.jpg', 7000,
       now() - interval '30 hours', now() - interval '6 hours'
from (select gen_random_uuid() as id from generate_series(1, 5)) g;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000004","role":"authenticated"}';

select is(
  (public.create_story(
    'c5600000-0000-4560-8000-0000000004a1', 'image',
    'c5600000-0000-4560-8000-000000000004/c5600000-0000-4560-8000-0000000004a1.jpg'
  ) ->> 'success')::boolean,
  true,
  '20. the 30th live story is accepted although 34 rows exist (5 expired)'
);

select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000004a2', 'image',
    'c5600000-0000-4560-8000-000000000004/c5600000-0000-4560-8000-0000000004a2.jpg'
  ) ->> 'error',
  'LIMIT_REACHED',
  '21. the 31st live story is refused'
);

select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000004'),
  30,
  '22. the provider sees their 30 live stories and none of the expired ones'
);

-- ── Who may see ────────────────────────────────────────────────────────────
-- An expired story of 002's, and a story by the unlisted 003, both by hand.
reset role;
insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
values
  ('c5600000-0000-4560-8000-0000000002a3', 'c5600000-0000-4560-8000-000000000002', 'image',
   'c5600000-0000-4560-8000-000000000002/c5600000-0000-4560-8000-0000000002a3.jpg', 7000,
   now() - interval '25 hours', now() - interval '1 hour'),
  ('c5600000-0000-4560-8000-0000000003a2', 'c5600000-0000-4560-8000-000000000003', 'image',
   'c5600000-0000-4560-8000-000000000003/c5600000-0000-4560-8000-0000000003a2.jpg', 7000,
   now(), now() + interval '24 hours');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  3,
  '23. a member sees a listed provider''s three live stories, and not the expired one'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  0,
  '24. another provider sees none of them: the audience is members'
);
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  0,
  '24b. nor does an applicant who is not listed yet'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000005","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  0,
  '25. a member blocked with the provider sees none of their stories'
);

select ok(
  not public.story_is_visible('c5600000-0000-4560-8000-0000000002a1'),
  '26. ...and the predicate every other path uses agrees'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000002'),
  3,
  '27. the provider sees their own live stories, and their expired one is gone for them too'
);

set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.stories where provider_id = 'c5600000-0000-4560-8000-000000000003'),
  0,
  '28. a story by a provider who is not listed is invisible to members'
);

-- A provider suspended after posting drops out of the directory, and so do
-- their stories; they cannot post either.
reset role;
update public.profiles set suspended_until = now() + interval '1 day'
where id = 'c5600000-0000-4560-8000-000000000004';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000004","role":"authenticated"}';
select is(
  public.create_story(
    'c5600000-0000-4560-8000-0000000004a3', 'image',
    'c5600000-0000-4560-8000-000000000004/c5600000-0000-4560-8000-0000000004a3.jpg'
  ) ->> 'error',
  'SUSPENDED',
  '29. a suspended provider cannot post'
);

reset role;
set local role anon;
select throws_ok(
  $$ select count(*) from public.stories $$,
  '42501',
  null,
  '30. a signed-out caller cannot read stories at all'
);

-- ── Taking a story down ────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000001","role":"authenticated"}';
delete from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1';

reset role;
select is(
  (select count(*)::int from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1'),
  1,
  '31. a member cannot delete a provider''s story'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5600000-0000-4560-8000-000000000002","role":"authenticated"}';
delete from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1';

reset role;
select is(
  (select count(*)::int from public.stories where id = 'c5600000-0000-4560-8000-0000000002a1'),
  0,
  '32. the provider deletes their own story'
);

select * from finish();
rollback;
