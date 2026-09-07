-- pgTAP tests for migration 045
-- (message origin, sequential openers, hidden 30-day retention, purge).
--
-- Proven here:
--   1.  messages.origin column exists.
--   2.  messages.hidden_at + purge_after columns exist.
--   3.  insert_next_opener requires authentication.
--   4.  three approved opener templates are seeded.
--   5.  insert_next_opener step 1 inserts (inserted=true, step=1).
--   6.  step 2 (step=2).
--   7.  step 3 (done=true, step=3).
--   8.  a 4th call is idempotent (inserted=false, done=true) — no duplicates.
--   9.  exactly 3 automated_opener rows, all sent AS the provider.
--   10. those openers are sessionless (session_id is null).
--   11. automation created NO paid_sessions (no activation/billing).
--   12. automation created NO session_requests.
--   13. automation did not touch the member's token balance.
--   14. a member's real send is origin='live'.
--   15. once a live message exists, insert_next_opener is done (no more openers).
--   16. a paid_session exists after the member confirms (real conversation).
--   17. before end, the member can SELECT the session content (5 rows).
--   18. after end_session, the member sees NOTHING (immediate invisibility).
--   19. server-side the rows still exist and are all hidden (< 30 days).
--   20. purge_after = hidden_at + 30 days on every hidden row.
--   21. the sessionless openers were hidden too (pre-request content included).
--   22. purge_expired_hidden_content deletes expired rows, openers included.
--   +   toggle_reaction succeeds on a visible message (override is faithful).
--   +   toggle_reaction returns NOT_FOUND on a HIDDEN message (no leak, no
--       mutation of retained content) — the definer bypass is closed.

\set ON_ERROR_STOP on
begin;
select plan(25);

-- ---------------------------------------------------------------------------
-- Shape assertions (no auth context; runs as the superuser test connection)
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'origin'
  ),
  '1. messages.origin column exists'
);

select ok(
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name in ('hidden_at', 'purge_after')),
  '2. messages.hidden_at and purge_after columns exist'
);

select throws_ok(
  $$ select insert_next_opener(gen_random_uuid()) $$,
  '42501',
  null,
  '3. insert_next_opener requires authentication'
);

select is(
  (select count(*)::int from public.conversation_opener_templates where is_approved),
  3,
  '4. three approved opener templates are seeded'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aa045000-0000-4045-8000-000000000001'),  -- member
  ('aa045000-0000-4045-8000-000000000002'); -- provider

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider045',
       date_of_birth        = (current_date - interval '27 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'aa045000-0000-4045-8000-000000000002';

update public.profiles
set    display_name      = 'Member045',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'aa045000-0000-4045-8000-000000000001';

select test.accept_current_policies('aa045000-0000-4045-8000-000000000001');
select test.accept_current_policies('aa045000-0000-4045-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Member context: sequential opener steps
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values ('conv', public.open_conversation('aa045000-0000-4045-8000-000000000002'));

select ok(
  (with s as (select public.insert_next_opener('aa045000-0000-4045-8000-000000000002') as r)
   select (r->>'inserted')::boolean and (r->>'step') = '1' from s),
  '5. insert_next_opener step 1 inserts one opener'
);

select is(
  (public.insert_next_opener('aa045000-0000-4045-8000-000000000002')->>'step'),
  '2',
  '6. insert_next_opener advances to step 2'
);

select ok(
  (with s as (select public.insert_next_opener('aa045000-0000-4045-8000-000000000002') as r)
   select (r->>'step') = '3' and (r->>'done')::boolean from s),
  '7. insert_next_opener step 3 completes the sequence'
);

select ok(
  (with s as (select public.insert_next_opener('aa045000-0000-4045-8000-000000000002') as r)
   select not (r->>'inserted')::boolean and (r->>'done')::boolean from s),
  '8. a 4th call is idempotent: no duplicate opener'
);

select ok(
  (select count(*) = 3
     and bool_and(sender_id = 'aa045000-0000-4045-8000-000000000002')
     and bool_and(origin = 'automated_opener')
   from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and origin = 'automated_opener'),
  '9. exactly 3 automated openers, all sent as the provider'
);

select ok(
  (select bool_and(session_id is null)
   from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and origin = 'automated_opener'),
  '10. automated openers are sessionless (session_id is null)'
);

select is(
  (select count(*)::int from public.paid_sessions
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  0,
  '11. automation created no paid_sessions'
);

select is(
  (select count(*)::int from public.session_requests
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  0,
  '12. automation created no session_requests'
);

select is(
  (select token_balance from public.profiles
   where id = 'aa045000-0000-4045-8000-000000000001'),
  500,
  '13. automation did not touch the member token balance'
);

-- ---------------------------------------------------------------------------
-- Backdate the openers so they are unambiguously PRE-request content.
-- In a single test transaction now() is constant, so without this the provider
-- auto-accept would attach the openers to the session; production timestamps
-- differ across the separate RPC transactions.
-- ---------------------------------------------------------------------------
set local role postgres;
update public.messages
set    created_at = now() - interval '1 hour'
where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
  and  origin = 'automated_opener';

-- ---------------------------------------------------------------------------
-- A real conversation begins: member sends, provider joins, member confirms.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v::uuid from test.fixture where k = 'conv'),
    'hi there'
  );
end$$;

select is(
  (select origin::text from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and sender_id = 'aa045000-0000-4045-8000-000000000001'
     and body = 'hi there'),
  'live',
  '14. a member send is origin=live'
);

select ok(
  (public.insert_next_opener('aa045000-0000-4045-8000-000000000002')->>'done')::boolean
    and not (public.insert_next_opener('aa045000-0000-4045-8000-000000000002')->>'inserted')::boolean,
  '15. once a live message exists, no more openers are seeded'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v::uuid from test.fixture where k = 'conv'),
    'hello from the provider'
  );
end$$;

set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000001","role":"authenticated"}';

select ok(
  public.confirm_chat_session(
    (select id from public.session_requests
     where conversation_id = (select v::uuid from test.fixture where k = 'conv')
       and channel = 'chat' and status = 'pending')
  ) is not null,
  '16. a paid_session exists after the member confirms'
);

-- ---------------------------------------------------------------------------
-- End the session as the member; content must vanish from the app immediately.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  5,
  '17. before end, the member can read the session content (3 openers + 2 sends)'
);

-- Positive control: the overridden toggle_reaction still works on a VISIBLE
-- message, so the hidden-gate addition did not break normal reactions.
select ok(
  (public.toggle_reaction(
     (select id from public.messages
      where conversation_id = (select v::uuid from test.fixture where k = 'conv')
        and body = 'hello from the provider'),
     '❤️') ->> 'success')::boolean,
  '17b. toggle_reaction succeeds on a visible message'
);

do $$
declare
  v_sid uuid;
begin
  select id into v_sid
  from   public.paid_sessions
  where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
  limit  1;
  perform public.end_session(v_sid, 'manual', null, null, null);
end$$;

select is(
  (select count(*)::int from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  0,
  '18. after end_session, the member sees no messages (hidden immediately)'
);

-- ---------------------------------------------------------------------------
-- Server-side the rows still exist and are retained (< 30 days), hidden.
-- ---------------------------------------------------------------------------
set local role postgres;

select ok(
  (select count(*) = 5 and bool_and(hidden_at is not null)
   from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  '19. hidden rows remain server-side and are all marked hidden'
);

select ok(
  (select bool_and(purge_after = hidden_at + interval '30 days')
   from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and hidden_at is not null),
  '20. purge_after is hidden_at + 30 days on every hidden row'
);

select is(
  (select count(*)::int from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and origin = 'automated_opener'
     and session_id is null
     and hidden_at is not null),
  3,
  '21. sessionless openers were hidden too (pre-request content included)'
);

-- ---------------------------------------------------------------------------
-- The definer bypass is closed: toggle_reaction cannot reach a hidden message.
-- The id is captured HERE, as postgres, precisely because a client-role SELECT
-- would be RLS-filtered and hand back null — which would return NOT_FOUND for
-- the wrong reason. With a real hidden id, only toggle_reaction's explicit
-- hidden_at check (RLS does not apply inside SECURITY DEFINER) can produce the
-- NOT_FOUND, which is what proves the bypass is closed.
-- ---------------------------------------------------------------------------
insert into test.fixture (k, v)
select 'hidden_msg',
       id
from   public.messages
where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
  and  body = 'hello from the provider'
  and  hidden_at is not null;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa045000-0000-4045-8000-000000000001","role":"authenticated"}';

select is(
  public.toggle_reaction(
    (select v::uuid from test.fixture where k = 'hidden_msg'),
    '👍') ->> 'error',
  'NOT_FOUND',
  '21b. toggle_reaction on a hidden message returns NOT_FOUND (no leak, no mutation)'
);

set local role postgres;

-- ---------------------------------------------------------------------------
-- Purge: expire the window, then delete. Openers included.
-- ---------------------------------------------------------------------------
update public.messages
set    purge_after = now() - interval '1 day'
where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
  and  hidden_at is not null;

select public.purge_expired_hidden_content();

select is(
  (select count(*)::int from public.messages
   where conversation_id = (select v::uuid from test.fixture where k = 'conv')),
  0,
  '22. purge permanently deletes expired hidden rows, openers included'
);

-- ---------------------------------------------------------------------------
-- The inbox projection stays metadata-only: no message body ever surfaces.
-- ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_summaries'
      and column_name in ('body', 'last_body')
  ),
  '23. conversation_summaries carries no message body column'
);

select * from finish();
rollback;
