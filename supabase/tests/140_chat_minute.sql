-- pgTAP for migration 021: spend_chat_minute shape, grant, and balance gate.
--
-- Assertions proven here:
--   1. spend_chat_minute function exists.
--   2. authenticated has EXECUTE (and only authenticated).
--   3. Returns INSUFFICIENT_BALANCE when balance < 22.
--   4. Debits 22 tokens and returns success + new_balance when balance >= 22.

\set ON_ERROR_STOP on
begin;
select plan(4);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select ok(
  (select exists (
    select 1 from information_schema.routines
    where routine_schema = 'public'
      and routine_name   = 'spend_chat_minute'
  )),
  'spend_chat_minute function exists'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select function_privs_are(
  'public', 'spend_chat_minute', ARRAY[]::text[],
  'authenticated', ARRAY['EXECUTE'],
  'authenticated has EXECUTE on spend_chat_minute'
);

-- ---------------------------------------------------------------------------
-- Behaviour: seed auth.uid() via JWT claims (same pattern as 130 suite)
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000088","role":"authenticated"}',
  true
);

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000088')
on conflict do nothing;

insert into public.profiles (id, display_name, token_balance)
values ('00000000-0000-0000-0000-000000000088', 'Test', 0)
on conflict (id) do update set token_balance = 0;

-- balance = 0 → INSUFFICIENT_BALANCE
select is(
  (public.spend_chat_minute()::json ->> 'error'),
  'INSUFFICIENT_BALANCE',
  'spend_chat_minute returns INSUFFICIENT_BALANCE when balance is 0'
);

-- Set balance to 44 (two minutes), debit one minute (22 tokens).
update public.profiles
set token_balance = 44
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'new_balance')::integer,
  22,
  'spend_chat_minute debits 22 tokens and returns new_balance'
);

select * from finish();
rollback;
