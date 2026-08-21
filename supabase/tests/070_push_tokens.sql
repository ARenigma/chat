-- pgTAP for migration 008: push tokens.
--
-- A device token is a capability, not a preference: whoever holds it can put a
-- notification on that lock screen. So the assertions here are about who can
-- read and write them, and one about what a notification is allowed to contain.

\set ON_ERROR_STOP on
begin;
select plan(11);

select has_table('public', 'push_tokens', 'push_tokens exists');
select has_column('public', 'messages', 'notified_at', 'messages record when they were pushed');

insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Registration names the caller, never the client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.register_push_token(repeat('t', 40), 'android')$$,
  'a signed-in device registers its token'
);
select throws_ok(
  $$select public.register_push_token('short', 'android')$$,
  '22023', null,
  'and a value too short to be a token is refused'
);
select throws_ok(
  $$select public.register_push_token(repeat('t', 40), 'windows')$$,
  '22023', null,
  'as is an unknown platform'
);
-- The client cannot enumerate tokens, not even its own: there is no SELECT policy.
select is(
  (select count(*)::int from public.push_tokens), 0,
  'a client cannot read the token table at all'
);
reset role;

select is(
  (select user_id from public.push_tokens where token = repeat('t', 40)),
  'aaaaaaaa-0000-4000-8000-000000000001',
  'the row belongs to the caller, who never sent a user id'
);

-- ---------------------------------------------------------------------------
-- The case that matters: a second account on the same phone
-- ---------------------------------------------------------------------------
-- FCM reissues one token per app install, so a shared or resold device
-- re-registers the *same* token under a new account. Leaving it pointed at the
-- previous user would push one person's messages to another person's phone.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.register_push_token(repeat('t', 40), 'android')$$,
  'the next account on the same device re-registers the same token'
);
reset role;
select is(
  (select user_id from public.push_tokens where token = repeat('t', 40)),
  'bbbbbbbb-0000-4000-8000-000000000002',
  'and the token follows the new owner rather than the old one'
);
select is(
  (select count(*)::int from public.push_tokens), 1,
  'without accumulating a row per reinstall'
);

-- ---------------------------------------------------------------------------
-- The sender's surface is off limits to clients
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.mark_notified(array['aaaaaaaa-0000-4000-8000-000000000001'::uuid])$$,
  '42501', null,
  'a client cannot mark messages notified'
);
reset role;

select * from finish();
rollback;
