-- pgTAP for spend_chat_minute: drain-to-zero semantics (migrations 021 + 022).
--
-- Assertions proven here:
--   1. spend_chat_minute function exists.
--   2. authenticated has EXECUTE (and only authenticated).
--   3. Returns OUT_OF_TOKENS (not INSUFFICIENT_BALANCE) when balance is 0.
--   4. Returns success=true at balance 10 (< 22): sub-minute remainder is granted.
--   5. Returns new_balance=0 at balance 10: remainder is drained, not stranded.
--   6. Returns last=true at balance 10: caller serves minute, ends on next charge.
--   7. Returns success=true at balance 44.
--   8. Returns new_balance=22 at balance 44: full debit, one minute left.
--   9. Returns last=false at balance 44: more balance remains.

\set ON_ERROR_STOP on
begin;
select plan(9);

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

-- balance = 0 → OUT_OF_TOKENS (migration 022 no longer returns INSUFFICIENT_BALANCE)
select is(
  (public.spend_chat_minute()::json ->> 'error'),
  'OUT_OF_TOKENS',
  'spend_chat_minute returns OUT_OF_TOKENS when balance is 0'
);

-- ---------------------------------------------------------------------------
-- Sub-minute remainder (balance 10 < 22): drain to 0, grant last minute.
-- Balance is reset before each field check so each assertion is independent.
-- ---------------------------------------------------------------------------

update public.profiles
set token_balance = 10
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'success')::boolean,
  true,
  'balance 10 < 22: success=true (sub-minute remainder is granted)'
);

update public.profiles
set token_balance = 10
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'new_balance')::integer,
  0,
  'balance 10 < 22: drains to exactly 0, does not strand remainder'
);

update public.profiles
set token_balance = 10
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'last')::boolean,
  true,
  'balance 10 < 22: last=true (session ends on the next OUT_OF_TOKENS)'
);

-- ---------------------------------------------------------------------------
-- Full-minute charge (balance 44 = 2 minutes): debit 22, balance 22.
-- ---------------------------------------------------------------------------

update public.profiles
set token_balance = 44
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'success')::boolean,
  true,
  'balance 44: success=true'
);

update public.profiles
set token_balance = 44
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'new_balance')::integer,
  22,
  'balance 44: debits 22 tokens, new_balance=22'
);

update public.profiles
set token_balance = 44
where id = '00000000-0000-0000-0000-000000000088';

select is(
  (public.spend_chat_minute()::json ->> 'last')::boolean,
  false,
  'balance 44: last=false (one full minute still remains)'
);

select * from finish();
rollback;
