-- pgTAP for migration 069: the usage ledger.
--
-- 1. a member sees the session and what THEY spent
-- 2. ...named by the provider's stage name
-- 3. the provider sees the same session and their OWN share, not the gross
-- 4. ...and the member is never named, only handled
-- 5. a session that was never billed is not a line
-- 6. a stranger sees nothing
-- 7. newest first
-- 8. anonymous is refused

\set ON_ERROR_STOP on
begin;
select plan(8);

insert into auth.users (id) values
  ('cc069000-0000-4069-8000-000000000001'),
  ('cc069000-0000-4069-8000-000000000002'),
  ('cc069000-0000-4069-8000-000000000003');

update public.profiles
set    role = 'provider', display_name = 'Provider069',
       languages = array['English'],
       date_of_birth = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'cc069000-0000-4069-8000-000000000002';
update public.profiles set display_name = 'Member069', promo_balance = 500
where  id = 'cc069000-0000-4069-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc069000-0000-4069-8000-000000000001","role":"authenticated"}';
select test.accept_current_policies('cc069000-0000-4069-8000-000000000001');
insert into test.fixture (k, v)
values ('conv069', public.open_conversation('cc069000-0000-4069-8000-000000000002'));

reset role;
with s as (
  insert into public.paid_sessions (
    conversation_id, channel, member_id, provider_id, status,
    rate_tokens_per_min, accepted_at, started_at, ended_at,
    minutes_billed, tokens_debited
  ) values (
    (select v from test.fixture where k = 'conv069'), 'chat',
    'cc069000-0000-4069-8000-000000000001', 'cc069000-0000-4069-8000-000000000002',
    'ended', 22, now() - interval '2 hours', now() - interval '2 hours',
    now() - interval '1 hour', 10, 220
  ) returning id
)
insert into test.fixture (k, v) select 'sess069', id from s;

-- A session that never billed a minute.
with s as (
  insert into public.paid_sessions (
    conversation_id, channel, member_id, provider_id, status,
    rate_tokens_per_min, accepted_at, minutes_billed, tokens_debited
  ) values (
    (select v from test.fixture where k = 'conv069'), 'chat',
    'cc069000-0000-4069-8000-000000000001', 'cc069000-0000-4069-8000-000000000002',
    'ended', 22, now() - interval '3 hours', 0, 0
  ) returning id
)
insert into test.fixture (k, v) select 'sess069b', id from s;

-- A newer one, so ordering is observable.
with s as (
  insert into public.paid_sessions (
    conversation_id, channel, member_id, provider_id, status,
    rate_tokens_per_min, accepted_at, started_at, ended_at,
    minutes_billed, tokens_debited
  ) values (
    (select v from test.fixture where k = 'conv069'), 'audio',
    'cc069000-0000-4069-8000-000000000001', 'cc069000-0000-4069-8000-000000000002',
    'ended', 22, now() - interval '10 minutes', now() - interval '10 minutes',
    now(), 3, 66
  ) returning id
)
insert into test.fixture (k, v) select 'sess069c', id from s;

insert into public.provider_earnings_ledger (
  provider_id, session_id, minutes_billed, rate_per_min,
  gross_tokens, provider_tokens, hold_until, status
) values (
  'cc069000-0000-4069-8000-000000000002',
  (select v from test.fixture where k = 'sess069'),
  10, 22, 220, 132, now() + interval '7 days', 'pending'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc069000-0000-4069-8000-000000000001","role":"authenticated"}';

select ok(
  (
    with r as (select public.get_usage_ledger() as j)
    select (select (e ->> 'tokens')::int from jsonb_array_elements(j) e
            where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069')) = 220
    from r
  ),
  '1. a member sees what they spent'
);

select ok(
  (
    with r as (select public.get_usage_ledger() as j)
    select (select e ->> 'peer_name' from jsonb_array_elements(j) e
            where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069')) = 'Provider069'
    from r
  ),
  '2. named by the provider''s stage name'
);

set local request.jwt.claims =
  '{"sub":"cc069000-0000-4069-8000-000000000002","role":"authenticated"}';

select ok(
  (
    with r as (select public.get_usage_ledger() as j)
    select (select (e ->> 'tokens')::int from jsonb_array_elements(j) e
            where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069')) = 132
    from r
  ),
  '3. the provider sees their own share, not the gross'
);

select ok(
  (
    with r as (select public.get_usage_ledger() as j)
    select (select e ->> 'peer_name' from jsonb_array_elements(j) e
            where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069'))
           like 'Member %'
       and (select e ->> 'peer_name' from jsonb_array_elements(j) e
            where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069'))
           <> 'Member069'
    from r
  ),
  '4. and the member is handled, never named'
);

select ok(
  (
    with r as (select public.get_usage_ledger() as j)
    select not exists (
      select 1 from jsonb_array_elements(j) e
      where (e ->> 'session_id') = (select v::text from test.fixture where k = 'sess069b')
    )
    from r
  ),
  '5. a session that never billed a minute is not a line'
);

set local request.jwt.claims =
  '{"sub":"cc069000-0000-4069-8000-000000000003","role":"authenticated"}';
select is(
  jsonb_array_length(public.get_usage_ledger()),
  0,
  '6. a stranger sees nothing'
);

set local request.jwt.claims =
  '{"sub":"cc069000-0000-4069-8000-000000000001","role":"authenticated"}';
select is(
  public.get_usage_ledger() -> 0 ->> 'session_id',
  (select v::text from test.fixture where k = 'sess069c'),
  '7. newest first'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.get_usage_ledger()$$,
  '42501', null,
  '8. anonymous is refused'
);

select * from finish();
rollback;
