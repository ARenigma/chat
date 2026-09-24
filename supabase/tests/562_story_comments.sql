-- pgTAP for migrations 147 and 148: public comments, no reply path, and the
-- provider's one reaction.
--
-- WHAT THIS IS GUARDING:
--
--   * Comments are PUBLIC with a public name only: member B reads member A's
--     comment under A's chosen username and clay avatar (1-4), the base
--     table, which carries author_id, is not readable at all (5), and the
--     feed's column list, which is the privacy boundary, carries no account
--     id, phone or email (6). An avatar URL is never published, even one
--     shaped like our bucket on a host the commenter owns (8), and a member
--     who never picked a name is their handle (9).
--   * The provider cannot reply: no comment from the story's provider or any
--     other provider (10, 11), and no table write around the RPC (45, 46).
--   * The body: 500 characters, something visible, at most six lines, trimmed
--     without breaking an emoji (12-15), each limit from both sides (12b,
--     14), no control character, while CRLF and emoji are text (13b-13d),
--     behind the policy gate and the suspension (16, 16b).
--   * Blocked pairs neither see nor post: the blocked member sees neither the
--     story nor its comments, not even through an error message, and cannot
--     post (17-20); a comment by someone blocked with the provider is hidden
--     from everyone, the provider included (21, 22); a viewer blocked with a
--     commenter does not see that commenter (23).
--   * Rate limits, each at its exact edge: the fifth comment on a story is
--     accepted (23b) and the sixth is not, and deleting or waiting does not
--     refill it (24-26); the twentieth in an hour is accepted (27a) and the
--     twenty-first is not (27), and older ones do not count (28); the kill
--     switch (29).
--   * Delete: the author and the story's provider only (30, 31, 40, 44), as a
--     tombstone (41, 43).
--   * Comment reactions: the story's provider only, on their own story only
--     (32-34), public (35), one per comment, replaceable and removable with
--     the row really gone (36, 37, 37b), closed set (38), refused while the
--     provider is suspended (38b), and while stories are switched off except
--     taking one back (29b, 29c), hidden with the comment (39, 42).
--   * The provider's tray counts exactly the comments the feed shows: no
--     tombstone, nothing by someone blocked with them (44b).
--   * An expired story takes its comments out of every read (47).

\set ON_ERROR_STOP on
begin;
select plan(59);

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, phone) values
  ('c5620000-0000-4562-8000-000000000001', 'a562@test.local', '+919999956201'),  -- member A
  ('c5620000-0000-4562-8000-000000000002', 'b562@test.local', null),             -- member B
  ('c5620000-0000-4562-8000-000000000003', 'c562@test.local', null),             -- member, blocked with P
  ('c5620000-0000-4562-8000-000000000004', 'd562@test.local', null),             -- member, no name, limits
  ('c5620000-0000-4562-8000-000000000005', 'e562@test.local', null),             -- member, no policies
  ('c5620000-0000-4562-8000-000000000006', 'f562@test.local', null),             -- member, suspended
  ('c5620000-0000-4562-8000-000000000010', 'p562@test.local', null),             -- provider P
  ('c5620000-0000-4562-8000-000000000011', 'q562@test.local', null);             -- provider Q

update public.profiles
set display_name = 'quiet_lark', avatar_url = 'clay:bloom', profile_completed_at = now(),
    phone_e164 = '+919999956201'
where id = 'c5620000-0000-4562-8000-000000000001';

-- A finished member whose avatar_url was PATCHed (070: client-writable) to a
-- lookalike of an avatars-bucket URL on a host they own. A host-blind regex
-- (`^https://[^/]+/storage/v1/object/public/avatars/`) accepts it.
update public.profiles
set display_name = 'bright_fern',
    avatar_url = 'https://tracker.example/storage/v1/object/public/avatars/c5620000-0000-4562-8000-000000000002/p.png',
    profile_completed_at = now()
where id = 'c5620000-0000-4562-8000-000000000002';

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider562-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id in ('c5620000-0000-4562-8000-000000000010',
              'c5620000-0000-4562-8000-000000000011');

select test.accept_current_policies(id)
from public.profiles
where id in ('c5620000-0000-4562-8000-000000000001',
             'c5620000-0000-4562-8000-000000000002',
             'c5620000-0000-4562-8000-000000000003',
             'c5620000-0000-4562-8000-000000000004',
             'c5620000-0000-4562-8000-000000000006',
             'c5620000-0000-4562-8000-000000000010',
             'c5620000-0000-4562-8000-000000000011');

insert into public.blocks (blocker_id, blocked_id) values
  ('c5620000-0000-4562-8000-000000000003', 'c5620000-0000-4562-8000-000000000010');

update public.profiles set suspended_until = now() + interval '1 day'
where id = 'c5620000-0000-4562-8000-000000000006';

insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
values
  ('c5620000-0000-4562-8000-0000000000a1', 'c5620000-0000-4562-8000-000000000010', 'image',
   'c5620000-0000-4562-8000-000000000010/c5620000-0000-4562-8000-0000000000a1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours'),
  ('c5620000-0000-4562-8000-0000000000b1', 'c5620000-0000-4562-8000-000000000011', 'image',
   'c5620000-0000-4562-8000-000000000011/c5620000-0000-4562-8000-0000000000b1.jpg', 7000,
   now() - interval '1 hour', now() + interval '23 hours');

-- ── A comments, B reads it ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
select 'a1', (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', '  hello there  ')
              ->> 'comment_id')::uuid;

select isnt(
  (select v from test.fixture where k = 'a1'),
  null,
  '1. a member comments on a story'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select body from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  'hello there',
  '2. another member reads it, trimmed'
);
select is(
  (select author_display_name || ' / ' || author_avatar_url
   from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  'quiet_lark / clay:bloom',
  '3. ...under the commenter''s chosen name and avatar'
);
select is(
  (select is_own from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  false,
  '4. ...and it is not marked as theirs'
);
select throws_ok(
  $$ select count(*) from public.story_comments $$,
  '42501',
  null,
  '5. the base table, which carries author_id, is not readable by any client'
);

select is(
  (select string_agg(column_name::text, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'story_comment_feed'),
  'id,story_id,body,created_at,author_display_name,author_avatar_url,is_own,creator_reaction',
  '6. the feed publishes a name and an avatar, and no account id, phone or email'
);

insert into test.fixture (k, v)
select 'b1', (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'nice')
              ->> 'comment_id')::uuid;

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';
select is(
  (select is_own from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  true,
  '7. the author sees their own comment marked as theirs'
);
select is(
  (select coalesce(author_avatar_url, '-') from public.story_comment_feed
   where id = (select v from test.fixture where k = 'b1')),
  '-',
  '8. an avatar URL is never published, however much it looks like our bucket'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000004","role":"authenticated"}';
insert into test.fixture (k, v)
select 'd1', (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hi')
              ->> 'comment_id')::uuid;
select is(
  (select author_display_name from public.story_comment_feed
   where id = (select v from test.fixture where k = 'd1')),
  public.member_handle('c5620000-0000-4562-8000-000000000004'),
  '9. a member who never picked a name is shown by their handle'
);

-- ── Who may not comment ────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'thanks!') ->> 'error',
  'FORBIDDEN',
  '10. the provider cannot comment on (reply under) their own story'
);
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000011","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hello') ->> 'error',
  'NOT_FOUND',
  '11. nor can another provider, who cannot even see the story (143)'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', '   ') ->> 'error')
  || '/' ||
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', repeat('x', 501)) ->> 'error'),
  'BAD_REQUEST/BAD_REQUEST',
  '12. a blank comment and a 501-character one are both refused'
);
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1',
                             E'\n\t' || chr(8203) || chr(160) || chr(10240) || E'\n') ->> 'error')
  || '/' ||
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1',
                             'line' || repeat(E'\nline', 6)) ->> 'error'),
  'BAD_REQUEST/BAD_REQUEST',
  '13. so are a comment with nothing visible in it and one of seven lines'
);

-- Six lines is the most, and the edges are trimmed without cutting the
-- U+FE0F that makes the heart an emoji. On Q's story, so a1's counts below
-- are untouched.
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000b1',
                             chr(8203) || 'line' || repeat(E'\nline', 5) || ' ❤️' || E'\n ')
   ->> 'success')::boolean,
  true,
  '14. a six-line comment is accepted...'
);
select is(
  (select body from public.story_comment_feed where story_id = 'c5620000-0000-4562-8000-0000000000b1'),
  'line' || repeat(E'\nline', 5) || ' ❤️',
  '15. ...trimmed at both ends, its emoji intact'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000005","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hello') ->> 'error',
  'POLICY_REQUIRED',
  '16. a member who has not accepted the current policies cannot comment'
);
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000006","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hello') ->> 'error',
  'SUSPENDED',
  '16b. a suspended member cannot comment'
);

-- The other side of the body's limits, and its control rule (143, section 0).
-- As 003 on Q's story: 003 is blocked only with P, has budget to spare, and
-- 15's single-row read of Q's story is already done.
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000003","role":"authenticated"}';
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000b1', repeat('x', 500)) ->> 'success')::boolean,
  true,
  '12b. a comment of exactly 500 characters is accepted'
);
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000b1', chr(127)) ->> 'error')
  || '/' ||
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000b1', chr(155)) ->> 'error'),
  'BAD_REQUEST/BAD_REQUEST',
  '13b. a comment that is only a control character, DEL or a C1 CSI, is refused'
);
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000b1',
    'you are vile' || chr(27) || '[2K' || chr(27) || '[1A' || chr(27) || '[2K  thanks for the lovely photo')
  ->> 'error',
  'BAD_REQUEST',
  '13c. ...and so is one that hides a terminal escape sequence in its words'
);
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000b1',
    'so' || chr(13) || chr(10) || 'lovely ' || chr(10084) || chr(65039) || ' ' || chr(127987) || chr(65039))
   ->> 'success')::boolean,
  true,
  '13d. CRLF, a heart and a flag are text, and accepted'
);

-- ── Blocked pairs ──────────────────────────────────────────────────────────
-- A comment from the blocked member, left from before the block.
reset role;
insert into public.story_comments (id, story_id, author_id, body)
values ('c5620000-0000-4562-8000-0000000000c1', 'c5620000-0000-4562-8000-0000000000a1',
        'c5620000-0000-4562-8000-000000000003', 'from before the block');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.stories where id = 'c5620000-0000-4562-8000-0000000000a1')
  || '/' ||
  (select count(*) from public.story_comment_feed where story_id = 'c5620000-0000-4562-8000-0000000000a1'),
  '0/0',
  '17. a blocked member sees neither the story nor any of its comments'
);

-- Every comment on a1 is one 003 may not see. A filter that raises on the
-- body would put a hidden body in the error if it ran before the view's
-- WHERE; security_barrier makes the WHERE run first, while the leakproof
-- story_id filter is still pushed down.
select is(
  (select count(*)::int from public.story_comment_feed
   where story_id = 'c5620000-0000-4562-8000-0000000000a1' and body::int = 0),
  0,
  '18. a filter that fails on the body never sees a hidden comment''s body'
);
select ok(
  (select 'security_barrier=true' = any(reloptions) from pg_class
   where oid = 'public.story_comment_feed'::regclass),
  '19. ...because the feed is a security_barrier view'
);
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hello?') ->> 'error',
  'NOT_FOUND',
  '20. ...and cannot comment on it'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.story_comment_feed where story_id = 'c5620000-0000-4562-8000-0000000000a1')
  || '/' ||
  public.story_comment_is_visible('c5620000-0000-4562-8000-0000000000c1'),
  '3/false',
  '21. a comment by a member blocked with the provider is hidden from everyone else...'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_comment_feed
   where story_id = 'c5620000-0000-4562-8000-0000000000a1'
     and body = 'from before the block'),
  0,
  '22. ...the provider included, who is never shown words from someone blocked'
);

-- The third clause: a VIEWER blocked with the author. B blocked A (inserted
-- as the owner: 096 wants a conversation, which is not what this suite is
-- about), and then reads P's story. A member, because only members are an
-- audience (143).
reset role;
insert into public.blocks (blocker_id, blocked_id) values
  ('c5620000-0000-4562-8000-000000000002', 'c5620000-0000-4562-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.story_comment_feed where story_id = 'c5620000-0000-4562-8000-0000000000a1')
  || '/' ||
  (select count(*) from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  '2/0',
  '23. a viewer blocked with a commenter sees the story''s other comments but not theirs'
);

reset role;
delete from public.blocks
where blocker_id = 'c5620000-0000-4562-8000-000000000002'
  and blocked_id = 'c5620000-0000-4562-8000-000000000001';
set local role authenticated;

-- ── Rate limits ────────────────────────────────────────────────────────────
-- A has one comment on a1; the second to the fifth must all go in, or a limit
-- tightened to two or three would pass the refusal below unnoticed.
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int
   from (select public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'again ' || g)
                  ->> 'success' as ok
         from generate_series(2, 5) g) posted
   where ok = 'true'),
  4,
  '23b. comments two to five on one story are all accepted'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'sixth') ->> 'error',
  'RATE_LIMITED',
  '24. the sixth comment on one story is refused'
);

-- Any of the four just posted, but never a1, which later assertions react to.
-- Not "the newest": all five share one now(), so created_at cannot order them.
-- Picked as the owner, since no client can read the base table (5).
reset role;
insert into test.fixture (k, v)
select 'a_again', id from public.story_comments
where author_id = 'c5620000-0000-4562-8000-000000000001'
  and id <> (select v from test.fixture where k = 'a1')
order by id limit 1;

set local role authenticated;
select public.delete_story_comment((select v from test.fixture where k = 'a_again'));
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'sixth again') ->> 'error',
  'RATE_LIMITED',
  '25. deleting a comment does not buy another one'
);

-- Hours later, the per-story limit still holds: it is five for the story's
-- day, not five an hour. The story is aged too, so no comment predates it.
reset role;
update public.stories
set created_at = now() - interval '5 hours', expires_at = now() + interval '19 hours'
where id = 'c5620000-0000-4562-8000-0000000000a1';
update public.story_comments set created_at = now() - interval '3 hours'
where author_id = 'c5620000-0000-4562-8000-000000000001'
  and story_id = 'c5620000-0000-4562-8000-0000000000a1';

set local role authenticated;
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hours later') ->> 'error',
  'RATE_LIMITED',
  '26. the per-story limit does not reset with the hour'
);

-- The hourly limit, at its edge. 004 already has d1 from the last hour, so 18
-- more elsewhere make 19: the twentieth goes in, the twenty-first does not.
-- The same comments two hours ago do not count at all.
reset role;
insert into public.story_comments (story_id, author_id, body, created_at)
select 'c5620000-0000-4562-8000-0000000000b1', 'c5620000-0000-4562-8000-000000000004',
       'elsewhere ' || g, now() - interval '30 minutes'
from generate_series(1, 18) g;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000004","role":"authenticated"}';
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'twentieth') ->> 'success')::boolean,
  true,
  '27a. the twentieth comment in an hour is accepted'
);
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'one more') ->> 'error',
  'RATE_LIMITED',
  '27. ...and the twenty-first, on any story, is refused'
);

reset role;
update public.story_comments set created_at = now() - interval '2 hours'
where author_id = 'c5620000-0000-4562-8000-000000000004'
  and story_id = 'c5620000-0000-4562-8000-0000000000b1';

set local role authenticated;
select is(
  (public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'one more') ->> 'success')::boolean,
  true,
  '28. ...and comments older than an hour do not count'
);

-- ── The kill switch ────────────────────────────────────────────────────────
reset role;
update admin.config_active
set payload = payload || '{"stories_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  public.post_story_comment('c5620000-0000-4562-8000-0000000000a1', 'hello') ->> 'error',
  'STORIES_DISABLED',
  '29. no new comment while stories are switched off'
);

-- The provider's reaction obeys the same switch: adding stops, taking back
-- does not. A heart on d1, put there as the owner before the switch matters.
reset role;
insert into public.story_comment_reactions (comment_id, provider_id, emoji)
values ((select v from test.fixture where k = 'd1'), 'c5620000-0000-4562-8000-000000000010', '❤️');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'd1'), '👍') ->> 'error',
  'STORIES_DISABLED',
  '29b. the provider cannot add or change a comment reaction while stories are off'
);
select is(
  (select (r ->> 'success') || '/' || coalesce(r ->> 'emoji', 'null')
   from (select public.react_to_story_comment((select v from test.fixture where k = 'd1'), '❤️') as r) x),
  'true/null',
  '29c. ...but can take one back'
);

reset role;
update admin.config_active
set payload = payload - 'stories_enabled'
where domain = 'kill_switches' and environment = 'prod';

-- ── Who may delete ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  public.delete_story_comment((select v from test.fixture where k = 'a1')) ->> 'error',
  'FORBIDDEN',
  '30. a member cannot delete someone else''s comment'
);
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000011","role":"authenticated"}';
select is(
  public.delete_story_comment((select v from test.fixture where k = 'a1')) ->> 'error',
  'FORBIDDEN',
  '31. nor can a provider whose story it is not'
);

-- ── The provider's reaction to a comment ──────────────────────────────────
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'b1'), '❤️') ->> 'error',
  'FORBIDDEN',
  '32. a member cannot react to a comment'
);
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000011","role":"authenticated"}';
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'a1'), '❤️') ->> 'error',
  'NOT_FOUND',
  '33. nor can a provider on somebody else''s story, which they cannot even see'
);
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'a1'), '❤️') ->> 'emoji',
  '❤️',
  '34. the story''s provider hearts a comment on their own story'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select creator_reaction from public.story_comment_feed where id = (select v from test.fixture where k = 'a1'))
  || '/' ||
  (select count(*) from public.story_comment_reactions where comment_id = (select v from test.fixture where k = 'a1')),
  '❤️/1',
  '35. the heart is public to everyone who can see the comment'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select public.react_to_story_comment((select v from test.fixture where k = 'a1'), '🙏');
reset role;
select is(
  (select string_agg(emoji, ',') from public.story_comment_reactions
   where comment_id = (select v from test.fixture where k = 'a1')),
  '🙏',
  '36. a different emoji replaces it: one reaction per comment'
);

set local role authenticated;
select is(
  (select (r ->> 'success') || '/' || coalesce(r ->> 'emoji', 'null')
   from (select public.react_to_story_comment((select v from test.fixture where k = 'a1'), '🙏') as r) x),
  'true/null',
  '37. the same emoji again removes it'
);
reset role;
select is(
  (select count(*)::int from public.story_comment_reactions
   where comment_id = (select v from test.fixture where k = 'a1')),
  0,
  '37b. ...and the row is gone, not just reported gone'
);
set local role authenticated;
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'a1'), '🔥') ->> 'error',
  'BAD_REQUEST',
  '38. an emoji outside the allowlist is refused'
);

reset role;
update public.profiles set suspended_until = now() + interval '1 day'
where id = 'c5620000-0000-4562-8000-000000000010';
set local role authenticated;
select is(
  public.react_to_story_comment((select v from test.fixture where k = 'a1'), '❤️') ->> 'error',
  'SUSPENDED',
  '38b. a suspended provider cannot react to a comment'
);
reset role;
update public.profiles set suspended_until = null
where id = 'c5620000-0000-4562-8000-000000000010';
set local role authenticated;

select public.react_to_story_comment((select v from test.fixture where k = 'a1'), '❤️');
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_comment_reactions),
  0,
  '39. a blocked member sees no comment reactions either'
);

-- ── Deleting, as a tombstone ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000001","role":"authenticated"}';
select is(
  (public.delete_story_comment((select v from test.fixture where k = 'a1')) ->> 'success')::boolean,
  true,
  '40. the author deletes their own comment'
);

reset role;
select ok(
  (select body is null and deleted_at is not null from public.story_comments
   where id = (select v from test.fixture where k = 'a1')),
  '41. the delete is a tombstone: the words are gone, the row keeps counting'
);
select is(
  (select count(*)::int from public.story_comment_reactions
   where comment_id = (select v from test.fixture where k = 'a1')),
  0,
  '42. the provider''s heart went with it'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_comment_feed where id = (select v from test.fixture where k = 'a1')),
  0,
  '43. a deleted comment is gone from the public feed'
);

set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000010","role":"authenticated"}';
select is(
  (public.delete_story_comment((select v from test.fixture where k = 'b1')) ->> 'success')::boolean,
  true,
  '44. the provider deletes any comment on their own story'
);

-- a1 now holds tombstones (40, 44, 25) and a live comment by someone blocked
-- with P (c1), so a count that skipped either filter would disagree.
select is(
  (select comment_count from public.my_story_insights()
   where story_id = 'c5620000-0000-4562-8000-0000000000a1')
  || '/' ||
  (select count(*) from public.story_comment_feed
   where story_id = 'c5620000-0000-4562-8000-0000000000a1'),
  (select count(*) from public.story_comment_feed
   where story_id = 'c5620000-0000-4562-8000-0000000000a1')
  || '/' ||
  (select count(*) from public.story_comment_feed
   where story_id = 'c5620000-0000-4562-8000-0000000000a1'),
  '44b. the provider''s tray counts exactly the comments the feed shows them'
);

select throws_ok(
  $$ insert into public.story_comments (story_id, author_id, body)
     values ('c5620000-0000-4562-8000-0000000000a1', 'c5620000-0000-4562-8000-000000000010', 'a reply') $$,
  '42501',
  null,
  '45. the provider cannot write a reply into the table around the RPC'
);
select throws_ok(
  $$ update public.story_comments set body = 'edited'
     where id = (select v from test.fixture where k = 'd1') $$,
  '42501',
  null,
  '46. no client edits a comment'
);

-- ── Expiry ─────────────────────────────────────────────────────────────────
reset role;
update public.stories
set created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour'
where id = 'c5620000-0000-4562-8000-0000000000a1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c5620000-0000-4562-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.story_comment_feed where story_id = 'c5620000-0000-4562-8000-0000000000a1'),
  0,
  '47. an expired story''s comments are gone from every read'
);

select * from finish();
rollback;
