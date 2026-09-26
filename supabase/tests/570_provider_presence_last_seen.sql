-- pgTAP for 155: provider presence, "Online" and "last seen".
--
-- WHAT THIS IS GUARDING:
--
--   * The rail bug: conversation_summaries carries peer_available and
--     peer_is_provider, so the inbox stops reading every provider as not
--     loaded (1-3).
--   * A heartbeat makes a provider online within 75 s, on every surface at
--     once: the directory, the peers view and the inbox (4-7). 76 s later they
--     are not online, but last seen still shows (8-9); 74 s is still online
--     (10).
--   * An explicit offline flips them off at once, inside the 20 s window,
--     because a change of state is always written (11-13).
--   * Availability off is never online, and last seen still shows (14-15).
--   * A member's heartbeat writes nothing (16-17), and a member's last seen is
--     never published, even with a stamp at rest and presence_visible on
--     (18-20).
--   * A blocked pair sees neither, in both directions (21-24), and the block
--     is scoped to the pair: another member still sees the provider (25).
--   * Last seen is rounded down to the minute (26).
--   * The 20 s write limit: a same-state heartbeat under 20 s old is skipped
--     (27), and one over 20 s old is written (28).
--   * Who can write: anon cannot call it (29), touch_presence is closed (30),
--     the heartbeat is a definer with a pinned search_path (31), a null state
--     is refused (32), and a client cannot write either column directly
--     (33-34).
--   * The three views kept their grants and their security_invoker setting
--     through create or replace (35-37).
--
-- now() is the transaction start throughout, so every stamp is exact.

\set ON_ERROR_STOP on
begin;
select plan(37);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- 01 is the member viewing. 02 is a second member. 10-13 are providers:
-- 10 open, 11 closed, 12 blocked BY 01, 13 who blocked 01.
insert into auth.users (id)
select ('d5700000-0000-4570-8000-0000000000' || n)::uuid
from unnest(array['01', '02', '10', '11', '12', '13']) n;

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider570-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now(),
       is_available         = true
where  id::text like 'd5700000-0000-4570-8000-0000000000_%'
  and  right(id::text, 2)::int >= 10;

update public.profiles set is_available = false
where id = 'd5700000-0000-4570-8000-000000000011';

insert into public.conversations (id, member_id, provider_id) values
  ('d5700000-0000-4570-8000-0000000000c0', 'd5700000-0000-4570-8000-000000000001', 'd5700000-0000-4570-8000-000000000010'),
  ('d5700000-0000-4570-8000-0000000000c1', 'd5700000-0000-4570-8000-000000000001', 'd5700000-0000-4570-8000-000000000011'),
  ('d5700000-0000-4570-8000-0000000000c2', 'd5700000-0000-4570-8000-000000000001', 'd5700000-0000-4570-8000-000000000012'),
  ('d5700000-0000-4570-8000-0000000000c3', 'd5700000-0000-4570-8000-000000000001', 'd5700000-0000-4570-8000-000000000013'),
  ('d5700000-0000-4570-8000-0000000000c4', 'd5700000-0000-4570-8000-000000000002', 'd5700000-0000-4570-8000-000000000012');

insert into public.blocks (blocker_id, blocked_id) values
  ('d5700000-0000-4570-8000-000000000001', 'd5700000-0000-4570-8000-000000000012'),
  ('d5700000-0000-4570-8000-000000000013', 'd5700000-0000-4570-8000-000000000001');

-- ── 1-3. The rail bug ──────────────────────────────────────────────────────
select has_column('public', 'conversation_summaries', 'peer_available',
  '1. the inbox carries the provider''s switch again');
select has_column('public', 'conversation_summaries', 'peer_is_provider',
  '2. and whether the peer has one');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[peer_available, peer_is_provider]
   from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  array[true, true],
  '3. so a member sees an open provider as open on the rail and the Chats list'
);
reset role;

-- ── 4-7. A heartbeat makes a provider online ───────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select lives_ok($$ select public.presence_heartbeat() $$,
  '4. a provider heartbeats');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[
     (select online from public.provider_directory
      where id = 'd5700000-0000-4570-8000-000000000010'),
     (select peer_online from public.conversation_peers
      where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
     (select peer_online from public.conversation_summaries
      where conversation_id = 'd5700000-0000-4570-8000-0000000000c0')]),
  array[true, true, true],
  '5. and reads online in the directory, the chat header and the inbox alike'
);
select is(
  (select last_seen_at from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000010'),
  date_trunc('minute', now()),
  '6. with last seen at the heartbeat, to the minute, in the directory'
);
select is(
  (select peer_last_seen_at from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  date_trunc('minute', now()),
  '7. and in the inbox'
);
reset role;

-- ── 8-10. The 75 s window ──────────────────────────────────────────────────
update public.profiles set last_active_at = now() - interval '76 seconds'
where id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[
     (select online from public.provider_directory
      where id = 'd5700000-0000-4570-8000-000000000010'),
     (select peer_online from public.conversation_summaries
      where conversation_id = 'd5700000-0000-4570-8000-0000000000c0')]),
  array[false, false],
  '8. 76 s after the last heartbeat the provider is not online'
);
select is(
  (select peer_last_seen_at from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  date_trunc('minute', now() - interval '76 seconds'),
  '9. but last seen still shows'
);
reset role;

update public.profiles set last_active_at = now() - interval '74 seconds'
where id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select online from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000010'),
  true,
  '10. and 74 s after it they still are'
);
reset role;

-- ── 11-13. An explicit offline ─────────────────────────────────────────────
-- 5 s after a heartbeat: inside the 20 s window, so only the change of state
-- gets it written.
update public.profiles
set    last_active_at = now() - interval '5 seconds', presence_online = true
where  id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select lives_ok($$ select public.presence_heartbeat(false) $$,
  '11. a provider going to the background says so');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[
     (select online from public.provider_directory
      where id = 'd5700000-0000-4570-8000-000000000010'),
     (select peer_online from public.conversation_peers
      where conversation_id = 'd5700000-0000-4570-8000-0000000000c0')]),
  array[false, false],
  '12. and is offline at once, not 75 s later'
);
select is(
  (select last_seen_at from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000010'),
  date_trunc('minute', now()),
  '13. last seen when they left'
);
reset role;

-- ── 14-15. Availability off ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000011","role":"authenticated"}';
select public.presence_heartbeat(true);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[
     (select online from public.provider_directory
      where id = 'd5700000-0000-4570-8000-000000000011'),
     (select peer_online from public.conversation_summaries
      where conversation_id = 'd5700000-0000-4570-8000-0000000000c1')]),
  array[false, false],
  '14. a closed provider in the foreground is never online'
);
select is(
  (select peer_last_seen_at from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c1'),
  date_trunc('minute', now()),
  '15. and their last seen still shows'
);
reset role;

-- ── 16-20. Members ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.presence_heartbeat() $$,
  '16. a member''s heartbeat is not an error');
reset role;
select is(
  (select array[last_active_at is null, presence_online = false]
   from public.profiles where id = 'd5700000-0000-4570-8000-000000000001'),
  array[true, true],
  '17. and writes nothing, so a member leaves no presence trail at rest'
);

-- Even with a stamp at rest (written as the owner) and the old setting on.
update public.profiles
set    last_active_at = now(), presence_online = true, presence_visible = true
where  id = 'd5700000-0000-4570-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select is(
  (select array[peer_online::text, peer_last_seen_at::text, peer_last_active_at::text]
   from public.conversation_peers
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  array['false', null, null],
  '18. a provider never sees a member online or last seen, in the peers view'
);
select is(
  (select array[peer_online::text, peer_last_seen_at::text, peer_last_active_at::text]
   from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  array['false', null, null],
  '19. nor in the inbox'
);
select is(
  (select peer_available from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c0'),
  false,
  '20. and a member peer still has no switch to publish'
);
reset role;

-- ── 21-25. Blocks ──────────────────────────────────────────────────────────
-- Both blocked providers heartbeat, so there is something to withhold.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000012","role":"authenticated"}';
select public.presence_heartbeat();
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000013","role":"authenticated"}';
select public.presence_heartbeat();
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select array[online::text, last_seen_at::text] from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000012'),
  array['false', null],
  '21. a provider I blocked shows me neither online nor last seen in the directory'
);
select is(
  (select array[peer_online::text, peer_last_seen_at::text]
   from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c2'),
  array['false', null],
  '22. nor in our chat'
);
select is(
  (select array[online::text, last_seen_at::text] from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000013'),
  array['false', null],
  '23. a provider who blocked me shows me neither in the directory'
);
select is(
  (select array[peer_online::text, peer_last_seen_at::text]
   from public.conversation_peers
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c3'),
  array['false', null],
  '24. nor in our chat'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000002","role":"authenticated"}';
select is(
  (select array[peer_online::text, (peer_last_seen_at = date_trunc('minute', now()))::text]
   from public.conversation_summaries
   where conversation_id = 'd5700000-0000-4570-8000-0000000000c4'),
  array['true', 'true'],
  '25. while a member with no block sees that provider online'
);
reset role;

-- ── 26. Minute rounding ────────────────────────────────────────────────────
update public.profiles
set    last_active_at = timestamptz '2026-09-27 04:45:37.123456+00'
where  id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000001","role":"authenticated"}';
select is(
  (select last_seen_at from public.provider_directory
   where id = 'd5700000-0000-4570-8000-000000000010'),
  timestamptz '2026-09-27 04:45:00+00',
  '26. last seen is published to the minute, rounded down, never the second'
);
reset role;

-- ── 27-28. The 20 s write limit ────────────────────────────────────────────
update public.profiles
set    last_active_at = now() - interval '10 seconds', presence_online = true
where  id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select public.presence_heartbeat(true);
reset role;
select is(
  (select last_active_at from public.profiles
   where id = 'd5700000-0000-4570-8000-000000000010'),
  now() - interval '10 seconds',
  '27. a same-state heartbeat 10 s after the last one writes nothing'
);

update public.profiles
set    last_active_at = now() - interval '21 seconds'
where  id = 'd5700000-0000-4570-8000-000000000010';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select public.presence_heartbeat(true);
reset role;
select is(
  (select last_active_at from public.profiles
   where id = 'd5700000-0000-4570-8000-000000000010'),
  now(),
  '28. and one 21 s after it is written'
);

-- ── 29-34. Who can write ───────────────────────────────────────────────────
set local role anon;
select throws_ok(
  $$ select public.presence_heartbeat() $$,
  '42501', null,
  '29. anon cannot call the heartbeat'
);
reset role;

select is(
  has_function_privilege('authenticated', 'public.touch_presence()', 'EXECUTE')
    or has_function_privilege('anon', 'public.touch_presence()', 'EXECUTE'),
  false,
  '30. touch_presence is closed to clients, so the heartbeat is the only writer'
);

select is(
  (select prosecdef and proconfig @> array['search_path=public']
   from pg_proc
   where oid = 'public.presence_heartbeat(boolean)'::regprocedure),
  true,
  '31. the heartbeat is a definer with a pinned search_path'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5700000-0000-4570-8000-000000000010","role":"authenticated"}';
select throws_ok(
  $$ select public.presence_heartbeat(null) $$,
  '22004', null,
  '32. a null state is refused rather than read as either'
);
select throws_ok(
  $$ update public.profiles set presence_online = not presence_online
     where id = 'd5700000-0000-4570-8000-000000000010' $$,
  '42501', 'profiles.presence_online is not client-writable',
  '33. a provider cannot set their own online state by writing the column'
);
select throws_ok(
  $$ update public.profiles set last_active_at = now() - interval '1 hour'
     where id = 'd5700000-0000-4570-8000-000000000010' $$,
  '42501', 'profiles.last_active_at is not client-writable',
  '34. nor forge a last seen'
);
reset role;

-- ── 35-37. The views kept their grants and security mode ───────────────────
select is(
  (select array_agg(c.relname::text || ':' ||
            has_table_privilege('authenticated', c.oid, 'SELECT')::text || ':' ||
            has_table_privilege('anon', c.oid, 'SELECT')::text
          order by c.relname)
   from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('conversation_peers', 'conversation_summaries', 'provider_directory')),
  array['conversation_peers:true:false', 'conversation_summaries:true:false',
        'provider_directory:true:false'],
  '35. all three views are readable signed in and not signed out'
);
select is(
  (select array_agg(c.relname::text || ':' || array_to_string(c.reloptions, ',')
          order by c.relname)
   from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('conversation_peers', 'conversation_summaries', 'provider_directory')),
  array['conversation_peers:security_invoker=false',
        'conversation_summaries:security_invoker=true',
        'provider_directory:security_invoker=false'],
  '36. and each kept its security_invoker setting through create or replace'
);
select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'conversation_peers'
     and grantee = 'authenticated' and privilege_type <> 'SELECT'),
  0,
  '37. and authenticated holds nothing on the peers view but SELECT'
);

select * from finish();
rollback;
