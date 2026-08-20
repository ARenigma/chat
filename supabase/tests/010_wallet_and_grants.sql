-- pgTAP for migrations 001 and 002: the wallet, its grants, and the profile
-- bootstrap.
--
-- Scope note: this file used to cover the persona chat model too. Migration 003
-- replaced that model with two-party conversations, so those assertions moved to
-- 020 and the ones about `chats` and `messages.sender` are gone rather than
-- rewritten — they were asserting a shape that no longer exists.

\set ON_ERROR_STOP on
begin;
select plan(29);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'profiles', 'profiles exists');
select col_is_pk('public', 'profiles', 'id', 'profiles is keyed on the auth user id');
select col_not_null('public', 'profiles', 'token_balance', 'token_balance cannot be null');
select col_has_default('public', 'profiles', 'token_balance', 'token_balance has a default');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS enabled on profiles'
);
select has_trigger('auth', 'users', 'on_auth_user_created', 'profile bootstrap trigger installed');

-- ---------------------------------------------------------------------------
-- Least privilege on the wallet. Without the revokes in 002 a client could call
-- deduct_user_token(other_user, -100) and mint tokens.
-- ---------------------------------------------------------------------------
select function_privs_are(
  'public', 'deduct_user_token', ARRAY['uuid', 'integer'], 'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on deduct_user_token'
);
select function_privs_are(
  'public', 'deduct_user_token', ARRAY['uuid', 'integer'], 'anon', ARRAY[]::text[],
  'anon has no privilege on deduct_user_token'
);
select function_privs_are(
  'public', 'credit_user_token', ARRAY['uuid', 'integer'], 'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on credit_user_token'
);
select function_privs_are(
  'public', 'deduct_user_token', ARRAY['uuid', 'integer'], 'service_role', ARRAY['EXECUTE'],
  'service_role may execute deduct_user_token'
);
select function_privs_are(
  'public', 'claim_daily_tokens', ARRAY[]::text[], 'authenticated', ARRAY['EXECUTE'],
  'authenticated may execute claim_daily_tokens'
);
select function_privs_are(
  'public', 'delete_user_account', ARRAY[]::text[], 'authenticated', ARRAY['EXECUTE'],
  'authenticated may execute delete_user_account'
);
select isnt_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'deduct_user_token' and p.prosecdef$$,
  'deduct_user_token is security definer'
);

-- ---------------------------------------------------------------------------
-- Bootstrap and the balance invariant
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

select is(
  (select count(*)::int from public.profiles), 2,
  'handle_new_user provisioned one profile per auth user'
);
select is(
  (select token_balance from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  50, 'bootstrapped profile holds STARTING_BALANCE'
);
select throws_ok(
  $$update public.profiles set token_balance = -1
    where id = '11111111-1111-4111-8111-111111111111'$$,
  '23514', null, 'the check constraint rejects a negative balance'
);

-- ---------------------------------------------------------------------------
-- Wallet behaviour. The value table itself lives in 000_ledger_parity.
-- ---------------------------------------------------------------------------
select is(
  (public.deduct_user_token('11111111-1111-4111-8111-111111111111', 1) ->> 'new_balance')::int,
  49, 'a debit of one leaves 49'
);
select is(
  public.deduct_user_token('33333333-3333-4333-8333-333333333333', 1) ->> 'error',
  'INSUFFICIENT_BALANCE', 'an unknown user is treated as an empty wallet'
);
select is(
  (public.credit_user_token('11111111-1111-4111-8111-111111111111', 1) ->> 'new_balance')::int,
  50, 'a refund of one restores the balance'
);
select is(
  public.credit_user_token('11111111-1111-4111-8111-111111111111', 0) ->> 'error',
  'INVALID_AMOUNT', 'credit refuses a zero amount'
);
select is(
  public.credit_user_token('11111111-1111-4111-8111-111111111111', -100) ->> 'error',
  'INVALID_AMOUNT', 'credit refuses a negative amount, so it cannot mint'
);

-- ---------------------------------------------------------------------------
-- Refill window
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (public.claim_daily_tokens() ->> 'new_balance')::int, 75,
  'the first refill grants DAILY_REFILL_TOKENS on top of 50'
);
select is(
  public.claim_daily_tokens() ->> 'error', 'TOO_SOON',
  'a second refill inside the 24h window is refused'
);
reset role;

-- ---------------------------------------------------------------------------
-- Deletion is one cascade, now reaching conversations rather than chats
-- ---------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  false
);
select lives_ok('select public.delete_user_account()', 'delete_user_account runs for the caller');

select is(
  (select count(*)::int from auth.users where id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion removed the auth user'
);
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion cascaded to the profile'
);
select is(
  (select count(*)::int from public.conversations
    where member_id = '11111111-1111-4111-8111-111111111111'
       or provider_id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion cascaded to conversations from either side'
);
select is((select count(*)::int from public.messages), 0, 'deletion cascaded to messages');
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  1, 'deletion left the other user untouched'
);

select * from finish();
rollback;
