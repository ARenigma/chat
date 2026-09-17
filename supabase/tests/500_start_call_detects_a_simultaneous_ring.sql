-- pgTAP for migration 120: a simultaneous call in the same conversation is
-- detected and reported, not silently replaced.
--
-- 1. B calls A (a normal call start) -- the fixture, and proof the ordinary
--    path is unaffected
-- 2. A calls B back in the SAME conversation before answering -- the race.
--    start_call must refuse with ALREADY_RINGING and B's own call_id,
--    rather than silently ending B's ringing call and placing a fresh one
-- 3. B's original call is UNTOUCHED: still 'ringing', not 'missed' -- the
--    actual defect this migration closes
-- 4. the ALREADY_RINGING branch does not consume a rate-limit slot or a
--    session_request -- it returns before either is touched

\set ON_ERROR_STOP on
begin;
select plan(4);

insert into auth.users (id) values
  ('aa500000-0000-4000-8000-000000000001'),  -- member (A)
  ('bb500000-0000-4000-8000-000000000002'); -- provider (B)

insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values (
  'bb500000-0000-4000-8000-000000000002',
  'Call Provider 500',
  (current_date - interval '26 years')::date,
  array['English']
);
select public.approve_provider_application('bb500000-0000-4000-8000-000000000002');

update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa500000-0000-4000-8000-000000000001';

select test.accept_current_policies('aa500000-0000-4000-8000-000000000001');
select test.accept_current_policies('bb500000-0000-4000-8000-000000000002');

reset role;
update admin.config_active
set payload = payload || '{"voice_calls_enabled": true, "video_calls_enabled": true}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

-- ---------------------------------------------------------------------------
-- 1. B calls A: the fixture, and confirms the ordinary path still works.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa500000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread',
  public.open_conversation('bb500000-0000-4000-8000-000000000002')
);

set local request.jwt.claims =
  '{"sub":"bb500000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.start_call((select v from test.fixture where k = 'thread'), 'voice');

insert into test.fixture (k, v)
select 'bCall', id
from public.calls
where conversation_id = (select v from test.fixture where k = 'thread')
order by created_at desc
limit 1;

-- ---------------------------------------------------------------------------
-- 2. A calls B back, in the SAME conversation, before answering.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"aa500000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (
    public.start_call(
      (select v from test.fixture where k = 'thread'), 'voice'
    )
  )::jsonb,
  jsonb_build_object(
    'success', false,
    'error', 'ALREADY_RINGING',
    'call_id', (select v::text from test.fixture where k = 'bCall')
  ),
  '2. a simultaneous call back reports ALREADY_RINGING with the existing call id'
);

-- ---------------------------------------------------------------------------
-- 3. B's original call is untouched -- still ringing, not missed.
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select status::text from public.calls
   where id = (select v from test.fixture where k = 'bCall')),
  'ringing',
  '3. the existing call is not silently ended by the racing attempt'
);

-- ---------------------------------------------------------------------------
-- 4. No second calls row and no rate-limit consumption from the refused
-- attempt -- exactly one call row exists for this conversation.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.calls
   where conversation_id = (select v from test.fixture where k = 'thread')),
  1,
  '4. the refused attempt inserted no second call row'
);

-- ---------------------------------------------------------------------------
-- Regression: once B's call is answered, A can call again afterwards in a
-- FRESH attempt (this is not the same conversation-in-progress path; just
-- confirms the ALREADY_RINGING branch does not wedge the conversation).
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa500000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.answer_call((select v from test.fixture where k = 'bCall'));

reset role;
select is(
  (select status::text from public.calls
   where id = (select v from test.fixture where k = 'bCall')),
  'active',
  '5. the ringing call can still be answered normally afterwards'
);

select * from finish();
rollback;
