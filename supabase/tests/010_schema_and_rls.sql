-- pgTAP: schema shape, row level security, grants, cascade deletion.
--
-- Run by `npm run test:db` against a throwaway container after harness.sql and
-- every migration. Emits TAP; the runner parses it and fails on the first
-- `not ok`.
--
-- pgTAP is used rather than hand-rolled assertions because `policies_are` and
-- `function_privs_are` compare against the catalog, so a policy silently dropped
-- by a future migration fails here rather than passing on a technicality.

\set ON_ERROR_STOP on
begin;
select plan(54);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'chats', 'chats exists');
select has_table('public', 'messages', 'messages exists');

select col_is_pk('public', 'profiles', 'id', 'profiles is keyed on the auth user id');
select col_not_null('public', 'profiles', 'token_balance', 'token_balance cannot be null');
select col_not_null('public', 'messages', 'content', 'message content cannot be null');
select col_has_default('public', 'profiles', 'token_balance', 'token_balance has a default');

select has_index('public', 'messages', 'messages_chat_created_idx', 'transcript index exists');
select has_index('public', 'chats', 'chats_user_persona_idx', 'chat lookup index exists');

-- ---------------------------------------------------------------------------
-- RLS is on, and the policies are the ones we wrote
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS enabled on profiles'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.chats'::regclass),
  'RLS enabled on chats'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.messages'::regclass),
  'RLS enabled on messages'
);

select policies_are('public', 'profiles', ARRAY['User owns profile'], 'profiles has exactly one policy');
select policies_are('public', 'chats', ARRAY['User owns chats'], 'chats has exactly one policy');
select policies_are('public', 'messages', ARRAY['User owns messages'], 'messages has exactly one policy');

-- ---------------------------------------------------------------------------
-- Least privilege on the wallet. Without the revokes in 002, a client could
-- call deduct_user_token(other_user, -100) and mint tokens.
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
-- Bootstrap trigger
-- ---------------------------------------------------------------------------
select has_trigger('auth', 'users', 'on_auth_user_created', 'profile bootstrap trigger installed');
select has_trigger('public', 'messages', 'on_message_inserted', 'chat freshness trigger installed');

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
-- Wallet behaviour (the value table itself lives in 000_ledger_parity)
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
-- get_or_create_chat, as the owner
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  public.get_or_create_chat('nova'), public.get_or_create_chat('nova'),
  'get_or_create_chat is idempotent per persona'
);
select isnt(
  public.get_or_create_chat('nova'), public.get_or_create_chat('sage'),
  'each persona gets its own chat'
);

insert into public.messages (chat_id, sender, content)
select id, 'user', 'hello' from public.chats where persona_id = 'nova';

select is((select count(*)::int from public.messages), 1, 'owner can write to their own chat');
select is((select count(*)::int from public.chats), 2, 'owner sees both of their chats');
select is((select count(*)::int from public.profiles), 1, 'owner sees exactly one profile');

reset role;
insert into test.fixture (k, v)
select 'nova_chat', id from public.chats where persona_id = 'nova';

-- ---------------------------------------------------------------------------
-- RLS from a different user, including a leaked chat id
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.messages), 0, 'a different user sees no messages');
select is((select count(*)::int from public.chats), 0, 'a different user sees no chats');
select is((select count(*)::int from public.profiles), 1, 'a different user sees only their own profile');
select is(
  (select count(*)::int from public.chats where id = (select v from test.fixture where k = 'nova_chat')),
  0, 'RLS hides another user''s chat even by primary key'
);
select throws_ok(
  $$insert into public.messages (chat_id, sender, content)
    values ((select v from test.fixture where k = 'nova_chat'), 'user', 'intrusion')$$,
  '42501', null, 'RLS blocks writing into another user''s chat with a leaked id'
);
-- An RLS-filtered UPDATE does not raise; it silently matches zero rows. Proving
-- that requires reading the victim's balance back as a role that can see it.
select lives_ok(
  $$update public.profiles set token_balance = 9999
    where id = '11111111-1111-4111-8111-111111111111'$$,
  'topping up another user''s balance raises nothing'
);

reset role;

select is(
  (select token_balance from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  50, 'and changed nothing: the victim''s balance is untouched'
);

-- ---------------------------------------------------------------------------
-- Freshness, refill, deletion
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.messages (chat_id, sender, content)
    values ((select v from test.fixture where k = 'nova_chat'), 'assistant', 'hi there')$$,
  'assistant turns persist'
);
-- `now()` is the *transaction* timestamp, and this whole file is one
-- transaction, so created_at and updated_at are necessarily equal here however
-- well the trigger works. Backdate the row first, then assert the trigger wrote
-- the current transaction timestamp — which is what it actually promises.
update public.chats set updated_at = now() - interval '1 day'
where id = (select v from test.fixture where k = 'nova_chat');

insert into public.messages (chat_id, sender, content)
values ((select v from test.fixture where k = 'nova_chat'), 'assistant', 'and again');

select is(
  (select updated_at from public.chats where id = (select v from test.fixture where k = 'nova_chat')),
  now(),
  'touch_chat refreshed updated_at on message insert'
);

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

select lives_ok('select public.delete_user_account()', 'delete_user_account runs for the caller');

reset role;

select is(
  (select count(*)::int from auth.users where id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion removed the auth user'
);
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion cascaded to the profile'
);
select is(
  (select count(*)::int from public.chats where user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'deletion cascaded to chats'
);
select is((select count(*)::int from public.messages), 0, 'deletion cascaded to messages');
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  1, 'deletion left the other user untouched'
);

select * from finish();
rollback;
