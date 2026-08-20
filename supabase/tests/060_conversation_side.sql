-- pgTAP for migration 007: which side of a conversation the caller is on.
--
-- One assertion here is the whole point of the migration, and it is the last
-- one: a member who is later admitted as a provider is *still the member* of
-- the threads they paid for. Until this column existed the client answered that
-- question from `profiles.role`, which flips on admission and takes the answer
-- with it — so the rating prompt disappeared from the only person entitled to
-- use it, and the provider's work list grew a thread that was not work.

\set ON_ERROR_STOP on
begin;
select plan(11);

select has_column(
  'public', 'conversation_summaries', 'i_am_member',
  'the summary says which side you are on'
);
select has_column(
  'public', 'conversation_summaries', 'reviewed',
  'and whether it has been rated'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one provider, one member, one thread with traffic both ways.
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002');  -- member

-- `identity_verified_at` matters as much as the role here: `open_conversation`
-- refuses a provider who has a role but was never admitted.
update public.profiles
set role = 'provider',
    display_name = 'Ada',
    date_of_birth = (current_date - interval '26 years')::date,
    identity_verified_at = now(),
    is_available = true
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'hello')
    ->> 'success')::boolean,
  true, 'the member opens the thread'
);
select is(
  (select i_am_member from public.conversation_summaries), true,
  'and sees themselves as the member of it'
);
select is(
  (select reviewed from public.conversation_summaries), false,
  'with nothing rated yet'
);
reset role;

-- The same row, read by the other participant.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select i_am_member from public.conversation_summaries), false,
  'the provider reading the same thread is not the member'
);
reset role;

-- ---------------------------------------------------------------------------
-- The case profiles.role gets wrong
-- ---------------------------------------------------------------------------
-- Promote the member. This is the supply pipeline working, not an edge case:
-- members who liked the product are the obvious candidates to become providers.
update public.profiles
set role = 'provider',
    display_name = 'Bea',
    date_of_birth = (current_date - interval '31 years')::date
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select role::text from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  'provider', 'the member is now a provider by role'
);
select is(
  (select i_am_member from public.conversation_summaries
    where id = (select v from test.fixture where k = 'thread')),
  true,
  'yet remains the member of the thread they paid for — which profiles.role cannot express'
);
-- And the entitlement that hung on it is real: they can still rate it.
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'still here')
    ->> 'success')::boolean,
  true, 'they can still send in it'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'I am here')
    ->> 'success')::boolean,
  true, 'the provider replies'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.submit_review((select v from test.fixture where k = 'thread'), 5::smallint, null)$$,
  'and submit_review still accepts them, because it checks the conversation'
);
reset role;

select * from finish();
rollback;
