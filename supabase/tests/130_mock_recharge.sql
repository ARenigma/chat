-- pgTAP for migration 020 (mock_recharge, app_flags, feature-gate behaviour)
-- and migration 117 (the per-user rate limit added on top of it).
--
-- Assertions proven here:
--   - app_flags table exists with RLS enabled (no client-visible policies).
--   - mock_recharge function exists and authenticated has EXECUTE.
--   - When app_flags.mock_payments is false, mock_recharge returns MOCK_DISABLED.
--   - With the flag on, three calls in 24h succeed and credit the balance;
--     the fourth returns RATE_LIMITED and credits nothing further. This is
--     the actual mitigation for the double-gate's single point of failure:
--     the server flag being on, for any reason, no longer means unlimited
--     free balance for whoever calls the RPC.

\set ON_ERROR_STOP on
begin;
select plan(10);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'app_flags', 'app_flags exists');

select ok(
  (select exists (
    select 1 from information_schema.routines
    where routine_schema = 'public'
      and routine_name   = 'mock_recharge'
  )),
  'mock_recharge function exists'
);

-- RLS must be enabled; no policies means the table is invisible to clients.
select ok(
  (select relrowsecurity
   from   pg_class
   join   pg_namespace on pg_class.relnamespace = pg_namespace.oid
   where  pg_namespace.nspname = 'public'
     and  pg_class.relname     = 'app_flags'),
  'app_flags has RLS enabled'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select function_privs_are(
  'public', 'mock_recharge', ARRAY['integer', 'integer'],
  'authenticated', ARRAY['EXECUTE'],
  'authenticated has EXECUTE on mock_recharge'
);

-- ---------------------------------------------------------------------------
-- Behaviour: flag off → MOCK_DISABLED (no profile required; check is first)
-- ---------------------------------------------------------------------------
-- Seed the JWT claim so auth.uid() returns a deterministic uuid.  The postgres
-- superuser that runs these tests bypasses grant checks, so no role switch is
-- needed to call the function; auth.uid() reads from request.jwt.claims.
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}',
  true
);

select is(
  (public.mock_recharge(10000, 100)::json ->> 'error'),
  'MOCK_DISABLED',
  'mock_recharge returns MOCK_DISABLED when mock_payments flag is false'
);

-- ---------------------------------------------------------------------------
-- Behaviour: flag on -> capped at 3 calls per user per 24h (migration 117)
-- ---------------------------------------------------------------------------
reset role;
update public.app_flags set enabled = true where key = 'mock_payments';

insert into auth.users (id) values
  ('aa130000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aa130000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (public.mock_recharge(10000, 100)::json ->> 'success')::boolean,
  true,
  'call 1 of 3 succeeds once the flag is on'
);
select is(
  (public.mock_recharge(10000, 100)::json ->> 'success')::boolean,
  true,
  'call 2 of 3 succeeds'
);
select is(
  (public.mock_recharge(10000, 100)::json ->> 'success')::boolean,
  true,
  'call 3 of 3 succeeds'
);
select is(
  (public.mock_recharge(10000, 100)::json ->> 'error'),
  'RATE_LIMITED',
  'the 4th call in the same 24h is refused, whatever the server flag says'
);

reset role;
select is(
  (select purchased_balance from public.profiles
   where id = 'aa130000-0000-4000-8000-000000000001'),
  300,
  'exactly 3 credits landed -- the 4th call moved no money'
);

select * from finish();
rollback;
