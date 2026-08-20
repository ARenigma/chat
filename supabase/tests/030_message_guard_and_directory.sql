-- pgTAP for migration 004.
--
-- Both fixes here close holes that 003's own tests passed straight over, so the
-- assertions are written as the attack rather than as the shape:
--
--   1. a recipient rewriting the message that was sent to them
--   2. a member reading provider wallets out of `profiles` under cover of the
--      "providers are discoverable" policy
--
-- The directory assertions are behavioural on purpose. Introspecting the view's
-- `security_invoker` reloption would prove the switch is set; querying the base
-- table as a member proves the property the switch exists for.

\set ON_ERROR_STOP on
begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_trigger(
  'public', 'messages', 'guard_message_columns',
  'messages carry a column guard, not just an update policy'
);
select ok(
  (select count(*) = 0 from pg_policies
    where tablename = 'profiles' and policyname = 'Providers are discoverable'),
  'the policy that widened profiles for discovery is gone'
);
select hasnt_column(
  'public', 'provider_directory', 'token_balance',
  'the directory carries no wallet'
);

-- ---------------------------------------------------------------------------
-- Fixtures: a named applicant, a member, and an unnamed applicant
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider-to-be, named
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member
  ('cccccccc-0000-4000-8000-000000000003');  -- applicant with no name

update public.profiles
set display_name = 'Ada'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- A provider with no name is not representable, whatever route gets there.
select throws_ok(
  $$update public.profiles set role = 'provider'
    where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '23514', null,
  'a nameless profile cannot hold the provider role'
);

insert into public.provider_applications (user_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000003');

select throws_ok(
  $$select public.approve_provider_application('cccccccc-0000-4000-8000-000000000003')$$,
  '22023', null,
  'admission refuses a nameless applicant with an actionable error'
);
select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a named applicant is admitted'
);

-- ---------------------------------------------------------------------------
-- The directory is the only way a member sees a provider
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles where role = 'provider'), 0,
  'a member cannot read provider rows out of the base table'
);
select is(
  (select count(*)::int from public.provider_directory), 1,
  'but sees the provider through the directory'
);
select is(
  (select display_name from public.provider_directory), 'Ada',
  'with a name it can actually render'
);

-- ---------------------------------------------------------------------------
-- A thread with one turn from each side
-- ---------------------------------------------------------------------------
select ok(
  public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001') is not null,
  'the member opens a thread with the provider'
);

insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));

select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'hello')
    ->> 'success')::boolean,
  true, 'the member sends the first turn'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'hi there')
    ->> 'success')::boolean,
  true, 'the provider replies'
);

-- A sender editing their own message is invisible to the policy rather than an
-- error: the USING clause excludes the row, so the statement matches nothing.
-- Asserted as a no-op, because "no error" alone would not prove the text held.
select lives_ok(
  $$update public.messages set body = 'edited by sender'
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'a sender editing its own message is a silent no-op'
);
select is(
  (select body from public.messages
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'hi there', 'and the text is untouched'
);
reset role;

-- ---------------------------------------------------------------------------
-- The recipient: may latch read_at, may not touch anything else
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$update public.messages set body = 'never said this'
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'the recipient cannot rewrite the message it received'
);
select throws_ok(
  $$update public.messages set sender_id = 'bbbbbbbb-0000-4000-8000-000000000002'
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor reassign its authorship'
);
select lives_ok(
  $$update public.messages set read_at = now()
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'but it can mark the message read'
);
select is(
  (select count(*)::int from public.messages
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001' and read_at is not null),
  1, 'and the receipt stuck'
);
select throws_ok(
  $$update public.messages set read_at = null
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'a receipt is a one-way latch and cannot be withdrawn'
);
reset role;

select * from finish();
rollback;
