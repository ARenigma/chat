-- pgTAP for migration 062: seconds_remaining on get_active_session.
--
-- 1.  get_active_session exposes minutes_billed, next_bill_at, seconds_remaining
-- 2.  before activation (pending_leases) seconds_remaining is null
-- 3.  the second lease activates the session (fixture guard)
-- 4.  the member sees (next_bill_at - now) + floor(balance / rate) * 60 exactly
-- 5.  the provider sees null — the figure is the member's wallet in disguise
-- 6.  the number does not move when the cron catches up on a lagged minute
-- 7.  a lapsed minute on a spent balance reads 0, never negative
--
-- now() is the transaction start time throughout, so every arithmetic
-- expectation below is exact rather than "within a few seconds".

\set ON_ERROR_STOP on
begin;
select plan(7);

-- ---------------------------------------------------------------------------
-- Fixtures: member + provider, policies accepted, a chat request the provider
-- auto-accepts by replying (the 037 handshake), then both leases claimed.
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('cc062000-0000-4062-8000-000000000001'),  -- member
  ('cc062000-0000-4062-8000-000000000002'); -- provider

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider062',
       date_of_birth        = (current_date - interval '25 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc062000-0000-4062-8000-000000000002';

update public.profiles
set    display_name      = 'Member062',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc062000-0000-4062-8000-000000000001';

select test.accept_current_policies('cc062000-0000-4062-8000-000000000001');
select test.accept_current_policies('cc062000-0000-4062-8000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values ('conv062', public.open_conversation('cc062000-0000-4062-8000-000000000002'));

do $$
begin
  perform public.send_message(
    (select v from test.fixture where k = 'conv062'),
    'hello from member'
  );
end$$;

set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v from test.fixture where k = 'conv062'),
    'reply from provider'
  );
end$$;

insert into test.fixture (k, v)
select 'sess062', id
from   public.paid_sessions
where  conversation_id = (select v from test.fixture where k = 'conv062');

-- ---------------------------------------------------------------------------
-- 1 + 2. Shape, and null before billing starts
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

select ok(
  (
    select (s ? 'seconds_remaining') and (s ? 'minutes_billed') and (s ? 'next_bill_at')
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  '1. get_active_session exposes minutes_billed, next_bill_at and seconds_remaining'
);

select ok(
  (
    select (s->>'status') = 'pending_leases' and (s->>'seconds_remaining') is null
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  '2. seconds_remaining is null while the session is pending_leases'
);

-- ---------------------------------------------------------------------------
-- 3. Activate: member lease, then provider lease
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.claim_session_lease(
    (select v from test.fixture where k = 'sess062'),
    'foreground'
  );
end$$;

set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000002","role":"authenticated"}';

select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'sess062'),
    'foreground'
  ),
  'active',
  '3. the second lease activates the paid session'
);

-- ---------------------------------------------------------------------------
-- 4. Member: exact arithmetic. At activation next_bill_at = now() + 1 min and
--    minute 1 is prepaid, so the member is owed 60 s plus every whole minute
--    the remaining balance buys.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

select is(
  (
    select (s->>'seconds_remaining')::integer
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  (
    select 60 + (p.token_balance / ps.rate_tokens_per_min) * 60
    from   public.profiles p, public.paid_sessions ps
    where  p.id  = 'cc062000-0000-4062-8000-000000000001'
      and  ps.id = (select v from test.fixture where k = 'sess062')
  ),
  '4. member sees (next_bill_at - now) + floor(balance / rate) * 60'
);

-- ---------------------------------------------------------------------------
-- 5. Provider: null
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000002","role":"authenticated"}';

select ok(
  (
    select (s->>'status') = 'active' and (s->>'seconds_remaining') is null
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  '5. provider sees the session but not seconds_remaining'
);

-- ---------------------------------------------------------------------------
-- 6. Cron-lag invariance. Put next_bill_at 20 s in the past (the cron has not
--    ticked yet), read the member's figure, run the meter, read it again.
--    The deduction moves one minute from the balance term to the clock term;
--    the sum must not move.
-- ---------------------------------------------------------------------------
reset role;

update public.paid_sessions
set    next_bill_at = now() - interval '20 seconds'
where  id = (select v from test.fixture where k = 'sess062');

create temp table t062 (before_s integer);
-- Written and read under `set local role authenticated` below.
grant select, insert on t062 to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

insert into t062
select (s->>'seconds_remaining')::integer
from   public.get_active_session((select v from test.fixture where k = 'conv062')) s;

reset role;
select public.meter_active_sessions();

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

select is(
  (
    select (s->>'seconds_remaining')::integer
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  (select before_s from t062),
  '6. seconds_remaining is unchanged when the cron catches up on a lagged minute'
);

-- ---------------------------------------------------------------------------
-- 7. Spent balance, lapsed minute: 0, not negative
-- ---------------------------------------------------------------------------
reset role;

update public.profiles
set    promo_balance = 0, purchased_balance = 0
where  id = 'cc062000-0000-4062-8000-000000000001';

update public.paid_sessions
set    next_bill_at = now() - interval '10 seconds'
where  id = (select v from test.fixture where k = 'sess062');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc062000-0000-4062-8000-000000000001","role":"authenticated"}';

select is(
  (
    select (s->>'seconds_remaining')::integer
    from   public.get_active_session((select v from test.fixture where k = 'conv062')) s
  ),
  0,
  '7. a lapsed minute on a spent balance reads 0, never negative'
);

select * from finish();
rollback;
