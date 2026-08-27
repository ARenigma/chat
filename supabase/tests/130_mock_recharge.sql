-- pgTAP for migration 020: mock_recharge, app_flags, and feature-gate behaviour.
--
-- Assertions proven here:
--   - app_flags table exists with RLS enabled (no client-visible policies).
--   - mock_recharge function exists and authenticated has EXECUTE.
--   - When app_flags.mock_payments is false, mock_recharge returns MOCK_DISABLED.

\set ON_ERROR_STOP on
begin;
select plan(5);

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

select * from finish();
rollback;
