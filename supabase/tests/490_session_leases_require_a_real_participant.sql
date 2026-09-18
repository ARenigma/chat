-- pgTAP for migration 118: session_leases can no longer be planted for a
-- session by anyone other than that session's own member/provider, and
-- claim_session_lease's presence count can no longer be fooled by a stray
-- row that slips through anyway.
--
-- 1. a stranger (neither this session's member nor its provider) cannot
--    INSERT a session_leases row for it -- the RLS fix, the actual exploit
--    this migration closes
-- 2. the real member/provider pair can still activate a call exactly as
--    before -- the RLS tightening must not have broken the happy path
-- 3. a stray row for a THIRD user, inserted as postgres (bypassing RLS, as
--    a legacy row or a future bug would), is NOT counted toward "both
--    present" -- claim_session_lease's own narrowed count, defense in depth
-- 4. once the real second participant's lease lands too, the session still
--    activates -- proof (3) didn't also break real two-party activation

\set ON_ERROR_STOP on
begin;
select plan(4);

insert into auth.users (id) values
  ('aa490000-0000-4000-8000-000000000001'),  -- member
  ('bb490000-0000-4000-8000-000000000002'),  -- provider
  ('cc490000-0000-4000-8000-000000000003'); -- stranger

insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values (
  'bb490000-0000-4000-8000-000000000002',
  'Call Provider 490',
  (current_date - interval '26 years')::date,
  array['English']
);
select public.approve_provider_application('bb490000-0000-4000-8000-000000000002');

update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa490000-0000-4000-8000-000000000001';

select test.accept_current_policies('aa490000-0000-4000-8000-000000000001');
select test.accept_current_policies('bb490000-0000-4000-8000-000000000002');
select test.accept_current_policies('cc490000-0000-4000-8000-000000000003');

reset role;
update admin.config_active
set payload = payload || '{"voice_calls_enabled": true, "video_calls_enabled": true}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa490000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread',
  public.open_conversation('bb490000-0000-4000-8000-000000000002')
);

select public.start_call((select v from test.fixture where k = 'thread'), 'voice');

insert into test.fixture (k, v)
select 'call', id
from public.calls
where conversation_id = (select v from test.fixture where k = 'thread')
order by created_at desc
limit 1;

set local request.jwt.claims =
  '{"sub":"bb490000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.answer_call((select v from test.fixture where k = 'call'));

insert into test.fixture (k, v)
select 'session', id
from public.paid_sessions
where call_id = (select v from test.fixture where k = 'call');

-- ---------------------------------------------------------------------------
-- 1. A stranger cannot plant a lease row for this session at all.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc490000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
    values (
      (select v from test.fixture where k = 'session'),
      'cc490000-0000-4000-8000-000000000003',
      'connected', now()
    )$$,
  '42501', null,
  '1. a non-participant cannot insert a session_leases row for this session'
);

-- ---------------------------------------------------------------------------
-- 2. The real pair still activates the call normally.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"bb490000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.claim_session_lease(
  (select v from test.fixture where k = 'session'), 'connected'
);
set local request.jwt.claims =
  '{"sub":"aa490000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'), 'connected'
  ),
  'active',
  '2. the real member/provider pair still activates the call'
);

-- ---------------------------------------------------------------------------
-- 3 + 4. Reset to pending, plant a stranger's row directly as postgres
-- (bypassing RLS, the way a legacy row or a future bug could), and confirm
-- it does NOT count toward "both present" on its own.
-- ---------------------------------------------------------------------------
reset role;
update public.paid_sessions
set status = 'pending_leases', started_at = null, last_activity_at = now(),
    minutes_billed = 0, tokens_debited = 0, next_bill_at = null
where id = (select v from test.fixture where k = 'session');
delete from public.session_leases
where session_id = (select v from test.fixture where k = 'session');

insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
values (
  (select v from test.fixture where k = 'session'),
  'cc490000-0000-4000-8000-000000000003',
  'connected', now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa490000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'), 'connected'
  ),
  'pending_leases',
  '3. the member''s own lease plus a stranger''s planted row does not activate the call'
);

set local request.jwt.claims =
  '{"sub":"bb490000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'), 'connected'
  ),
  'active',
  '4. the real second participant''s own lease still activates it'
);

select * from finish();
rollback;
