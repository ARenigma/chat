-- pgTAP for migration 003: roles, admission, two-party conversations.
--
-- The assertions that matter most are the negative ones. A two-party chat has a
-- failure mode a one-owner model does not: a second member talking to the same
-- provider must not be able to read the first member's thread. Several tests
-- below exist purely to prove that, plus that a client cannot promote itself to
-- provider, which is the whole basis of ADR-0002's role switch being safe.

\set ON_ERROR_STOP on
begin;
select plan(43);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'conversations', 'conversations exists');
select has_table('public', 'provider_applications', 'provider_applications exists');
select hasnt_table('public', 'chats', 'the persona-era chats table is gone');
select has_column('public', 'profiles', 'role', 'profiles carries a role');
select has_column('public', 'messages', 'sender_id', 'messages name a real sender');
select hasnt_column('public', 'messages', 'sender', 'the sender string is gone');
select has_column('public', 'messages', 'read_at', 'messages track read state');
select col_default_is('public', 'profiles', 'role', 'member', 'a new profile is a member');

select ok(
  (select count(*) = 2 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename in ('messages', 'conversations')),
  'messages and conversations are published to realtime'
);
select is(
  (select relreplident from pg_class where oid = 'public.messages'::regclass)::text,
  'f', 'messages use full replica identity so realtime payloads are renderable'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one provider, two unrelated members
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member one
  ('cccccccc-0000-4000-8000-000000000003');  -- member two

select is((select count(*)::int from public.profiles), 3, 'a profile per auth user');
select is(
  (select count(*)::int from public.profiles where role = 'member'), 3,
  'everyone starts as a member'
);

-- Admission is service-role only.
select function_privs_are(
  'public', 'approve_provider_application', ARRAY['uuid', 'text'],
  'authenticated', ARRAY[]::text[],
  'authenticated cannot approve provider applications'
);
select function_privs_are(
  'public', 'send_message', ARRAY['uuid', 'text'], 'authenticated', ARRAY['EXECUTE'],
  'authenticated may send a message'
);

-- ---------------------------------------------------------------------------
-- A client cannot promote itself. This is the load-bearing assertion for
-- ADR-0002: the role switch is only safe because the role is not client-writable.
-- ---------------------------------------------------------------------------
insert into public.provider_applications (user_id)
values ('aaaaaaaa-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set role = 'provider'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'a member cannot promote itself to provider'
);
select throws_ok(
  $$update public.profiles set token_balance = 9999
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'a member cannot top up its own balance'
);
select throws_ok(
  $$update public.profiles set identity_verified_at = now()
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'a member cannot mark itself identity-verified'
);
select lives_ok(
  $$update public.profiles set display_name = 'Mia'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'but it can edit its own display name'
);
reset role;

select is(
  (select role from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001')::text,
  'member', 'the role really did not change'
);

-- ---------------------------------------------------------------------------
-- Admission through the reviewed path
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001', 'ok')$$,
  'service role can approve an application'
);
select is(
  (select role from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001')::text,
  'provider', 'approval set the role'
);
select isnt(
  (select identity_verified_at from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  null, 'approval implies a verification timestamp'
);
select is(
  (select status from public.provider_applications
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'approved', 'the application carries an audit trail'
);
select throws_ok(
  $$select public.approve_provider_application('cccccccc-0000-4000-8000-000000000003')$$,
  'P0002', null, 'approving without an application fails loudly'
);

-- ---------------------------------------------------------------------------
-- Opening a conversation
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'),
  public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'),
  'open_conversation is idempotent per pair'
);
select throws_ok(
  $$select public.open_conversation('bbbbbbbb-0000-4000-8000-000000000002')$$,
  '22023', null, 'cannot open a conversation with yourself'
);
select throws_ok(
  $$select public.open_conversation('cccccccc-0000-4000-8000-000000000003')$$,
  '22023', null, 'cannot open a conversation with a non-provider'
);

-- ---------------------------------------------------------------------------
-- The send path: the member pays, the provider does not
-- ---------------------------------------------------------------------------
select is(
  (public.send_message(
    public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'),
    'you up?') ->> 'new_balance')::int,
  49, 'a member send costs exactly one token'
);
select is(
  public.send_message(
    public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'), '   ') ->> 'error',
  'BAD_REQUEST', 'a blank message is rejected before any debit'
);
select is((select count(*)::int from public.messages), 1, 'only the real message landed');
reset role;

insert into test.fixture (k, v)
select 'thread', id from public.conversations limit 1;

-- The provider replying is free.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(
  (public.send_message((select v from test.fixture where k = 'thread'), 'barely awake')
    ->> 'new_balance') is null,
  'a provider reply debits nobody'
);
select is((select count(*)::int from public.messages), 2, 'the reply landed');
reset role;

select is(
  (select token_balance from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  49, 'the member paid once in total'
);
select is(
  (select token_balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  50, 'the provider paid nothing'
);

-- ---------------------------------------------------------------------------
-- Isolation: a second member must not see the first member's thread
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';

select is((select count(*)::int from public.conversations), 0,
  'an unrelated member sees no conversations');
select is((select count(*)::int from public.messages), 0,
  'an unrelated member sees no messages');
select is(
  public.send_message((select v from test.fixture where k = 'thread'), 'let me in') ->> 'error',
  'FORBIDDEN', 'and cannot post into a thread it is not part of, even with the id'
);
select ok(
  (select count(*) from public.profiles where role = 'provider') = 1,
  'but it can discover admitted providers'
);
reset role;

-- Both real participants can see the thread.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.messages), 2, 'the member sees both turns');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.messages), 2, 'the provider sees both turns');

-- ---------------------------------------------------------------------------
-- Read receipts: a recipient may mark read, a sender may not
-- ---------------------------------------------------------------------------
select lives_ok(
  $$update public.messages set read_at = now()
    where sender_id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  'the recipient can mark the other party''s message read'
);
select is(
  (select count(*)::int from public.messages
    where sender_id = 'bbbbbbbb-0000-4000-8000-000000000002' and read_at is not null),
  1, 'and it stuck'
);
select is(
  (select count(*)::int from public.messages
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001' and read_at is not null),
  0, 'a sender cannot mark its own message read'
);
reset role;

select * from finish();
rollback;
