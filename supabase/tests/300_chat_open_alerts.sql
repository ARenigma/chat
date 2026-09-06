-- pgTAP for migration 068: "someone opened your chat", both ways.
--
-- 1. thread meta carries a timestamp per direction, and no content
-- 2. a stranger cannot announce into someone else's conversation
-- 3. a peer who is HERE is not fetched
-- 4. a member with no minute means nobody is pinged, whoever opened
-- 5. ...and that holds when the PROVIDER is the one who opened
-- 6. no alert while a session is live
-- 7. with the sender unconfigured it is a quiet no-op, and says so rather than
--    claiming a push — the banner is built from this answer
-- 8. an unknown conversation is not_found, not a crash

\set ON_ERROR_STOP on
begin;
select plan(8);

select ok(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'conversation_thread_meta'
     and column_name in ('member_alerted_at', 'provider_alerted_at')) = 2
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_thread_meta'
      and column_name in ('last_body', 'last_message_text')
  ),
  '1. a timestamp per direction, and still no content'
);

insert into auth.users (id) values
  ('cc068000-0000-4068-8000-000000000001'),  -- member
  ('cc068000-0000-4068-8000-000000000002'),  -- provider
  ('cc068000-0000-4068-8000-000000000003'); -- a stranger

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider068',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true,
       presence             = 'away'
where  id = 'cc068000-0000-4068-8000-000000000002';

update public.profiles
set    display_name      = 'Member068',
       promo_balance     = 500,
       purchased_balance = 0,
       presence          = 'away'
where  id = 'cc068000-0000-4068-8000-000000000001';

select test.accept_current_policies('cc068000-0000-4068-8000-000000000001');
select test.accept_current_policies('cc068000-0000-4068-8000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000001","role":"authenticated"}';
insert into test.fixture (k, v)
values ('conv068', public.open_conversation('cc068000-0000-4068-8000-000000000002'));

set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000003","role":"authenticated"}';
select is(
  public.announce_chat_open((select v from test.fixture where k = 'conv068')) ->> 'reason',
  'forbidden',
  '2. a stranger cannot announce into someone else''s conversation'
);

-- 3. the provider is HERE: nobody needs fetching
reset role;
update public.profiles set presence = 'here'
where id = 'cc068000-0000-4068-8000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000001","role":"authenticated"}';
select is(
  public.announce_chat_open((select v from test.fixture where k = 'conv068')) ->> 'reason',
  'peer_present',
  '3. a peer who is here is not fetched'
);

-- 4. the member has no minute
reset role;
update public.profiles set presence = 'away'
where id = 'cc068000-0000-4068-8000-000000000002';
update public.profiles set promo_balance = 0, purchased_balance = 0
where id = 'cc068000-0000-4068-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000001","role":"authenticated"}';
select is(
  public.announce_chat_open((select v from test.fixture where k = 'conv068')) ->> 'reason',
  'no_balance',
  '4. no minute means nobody is pinged'
);

-- 5. ...and the rule is about the MEMBER's wallet even when the provider opened
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000002","role":"authenticated"}';
select is(
  public.announce_chat_open((select v from test.fixture where k = 'conv068')) ->> 'reason',
  'no_balance',
  '5. which holds when the provider is the one who opened'
);

-- 6. a live session outranks everything
reset role;
update public.profiles set promo_balance = 500
where id = 'cc068000-0000-4068-8000-000000000001';
insert into public.paid_sessions (
  conversation_id, channel, member_id, provider_id, status,
  rate_tokens_per_min, accepted_at
) values (
  (select v from test.fixture where k = 'conv068'), 'chat',
  'cc068000-0000-4068-8000-000000000001', 'cc068000-0000-4068-8000-000000000002',
  'active', 22, now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000001","role":"authenticated"}';
select is(
  public.announce_chat_open((select v from test.fixture where k = 'conv068')) ->> 'reason',
  'in_session',
  '6. no alert while a session is live'
);

-- 7. with the session gone and the sender unconfigured: a quiet, HONEST no-op
reset role;
update public.paid_sessions set status = 'ended', ended_at = now()
where conversation_id = (select v from test.fixture where k = 'conv068');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc068000-0000-4068-8000-000000000001","role":"authenticated"}';
select ok(
  (
    with r as (
      select public.announce_chat_open((select v from test.fixture where k = 'conv068')) as j
    )
    select (j ->> 'reason') = 'not_configured' and (j ->> 'alerted')::boolean = false
    from r
  ),
  '7. unconfigured is a no-op that says so, never a claimed push'
);

select is(
  public.announce_chat_open('00000000-dead-beef-dead-000000000099'::uuid) ->> 'reason',
  'not_found',
  '8. an unknown conversation is not_found, not a crash'
);

select * from finish();
rollback;
