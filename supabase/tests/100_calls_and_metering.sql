-- pgTAP for call signalling on the shared paid-session meter (migration 037).

\set ON_ERROR_STOP on
begin;
select plan(20);

insert into auth.users (id) values
  ('aa100000-0000-4000-8000-000000000001'),
  ('bb100000-0000-4000-8000-000000000002');

-- `languages` required by migration 075 for the approval below to succeed.
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values (
  'aa100000-0000-4000-8000-000000000001',
  'Call Provider',
  (current_date - interval '26 years')::date,
  array['English']
);
select public.approve_provider_application(
  'aa100000-0000-4000-8000-000000000001'
);

update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'bb100000-0000-4000-8000-000000000002';

insert into public.policy_acceptances (user_id, policy_kind, version_id)
select u.id, pv.kind, pv.id
from (
  values
    ('aa100000-0000-4000-8000-000000000001'::uuid),
    ('bb100000-0000-4000-8000-000000000002'::uuid)
) u(id)
cross join lateral (
  select distinct on (kind) id, kind
  from public.policy_versions
  where effective_at <= now()
  order by kind, version desc
) pv;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread',
  public.open_conversation('aa100000-0000-4000-8000-000000000001')
);

-- The two admin controls are independent and start_call, not the client, is
-- the authoritative boundary.
reset role;
update admin.config_active
set payload = (payload - 'calls_enabled')
  || '{"voice_calls_enabled": false, "video_calls_enabled": true}'::jsonb
where domain = 'kill_switches' and environment = 'prod';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.start_call(
    (select v from test.fixture where k = 'thread'),
    'voice'
  )->>'error',
  'VOICE_CALLS_DISABLED',
  'voice control stops voice calls while video remains enabled'
);

reset role;
update admin.config_active
set payload = (payload - 'calls_enabled')
  || '{"voice_calls_enabled": true, "video_calls_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.start_call(
    (select v from test.fixture where k = 'thread'),
    'video'
  )->>'error',
  'VIDEO_CALLS_DISABLED',
  'video control stops video calls while voice remains enabled'
);

reset role;
update admin.config_active
set payload = (payload - 'calls_enabled')
  || '{"voice_calls_enabled": true, "video_calls_enabled": true}'::jsonb
where domain = 'kill_switches' and environment = 'prod';
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (public.start_call(
    (select v from test.fixture where k = 'thread'),
    'voice'
  )->>'success')::boolean,
  true,
  'member can start a voice call'
);

insert into test.fixture (k, v)
select
  'call',
  id
from public.calls
where conversation_id = (select v from test.fixture where k = 'thread')
order by created_at desc
limit 1;

select is(
  (select status::text from public.calls
   where id = (select v from test.fixture where k = 'call')),
  'ringing',
  'call starts as ringing'
);

select is(
  (select count(*)::integer from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'thread')
     and channel = 'audio'
     and status = 'pending'),
  1,
  'ringing call owns one pending audio session request'
);

select is(
  (select token_balance from public.profiles
   where id = 'bb100000-0000-4000-8000-000000000002'),
  500,
  'ringing does not debit the member'
);

select is(
  public.answer_call((select v from test.fixture where k = 'call'))->>'error',
  'FORBIDDEN',
  'caller cannot answer their own call'
);

set local request.jwt.claims =
  '{"sub":"aa100000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (public.answer_call(
    (select v from test.fixture where k = 'call')
  )->>'success')::boolean,
  true,
  'callee accepts the call'
);

insert into test.fixture (k, v)
select 'session', id
from public.paid_sessions
where call_id = (select v from test.fixture where k = 'call');

select is(
  (select status::text from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  'pending_leases',
  'acceptance waits for both connected media leases'
);

-- Read the member's balance as superuser: the provider's auth context cannot
-- see another user's profile row through RLS.
reset role;
select is(
  (select token_balance from public.profiles
   where id = 'bb100000-0000-4000-8000-000000000002'),
  500,
  'acceptance alone does not debit the member'
);
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa100000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'),
    'connected'
  ),
  'pending_leases',
  'one connected lease does not activate billing'
);

set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'),
    'connected'
  ),
  'active',
  'second connected lease activates the paid session'
);

select is(
  (select minutes_billed from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  1,
  'activation bills exactly one started minute'
);

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = (select v from test.fixture where k = 'session')
     and kind = 'usage_debit'),
  1,
  'activation writes exactly one usage debit'
);

select is(
  (public.heartbeat_call(
    (select v from test.fixture where k = 'call')
  )->>'success')::boolean,
  true,
  'legacy call heartbeat remains a non-billing liveness response'
);

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = (select v from test.fixture where k = 'session')
     and kind = 'usage_debit'),
  1,
  'call heartbeat cannot create a second charge'
);

reset role;
update public.paid_sessions
set next_bill_at = now() - interval '1 second'
where id = (select v from test.fixture where k = 'session');
select public.meter_active_sessions();

select is(
  (select minutes_billed from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  2,
  'session meter bills the next started minute once'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.end_call((select v from test.fixture where k = 'call'));

select is(
  (select status::text from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  'ended',
  'ending the call ends the paid session'
);

-- provider_earnings_ledger is not visible to the member under RLS; read as
-- superuser so the accrual count is authoritative.
reset role;
select is(
  (select minutes_billed from public.provider_earnings_ledger
   where session_id = (select v from test.fixture where k = 'session')),
  2,
  'provider accrual uses actual started-minute debit count'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb100000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.start_call(
  (select v from test.fixture where k = 'thread'),
  'video'
);
reset role;
update public.calls
set created_at = now() - interval '31 seconds'
where status = 'ringing';
select public.meter_active_calls();

select is(
  (select status::text from public.calls
   where medium = 'video'
   order by created_at desc
   limit 1),
  'missed',
  'ring timeout is 30 seconds and does not use the legacy meter'
);

select * from finish();
rollback;
