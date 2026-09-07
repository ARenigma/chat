-- pgTAP for migration 007: which side of a conversation the caller is on.
--
-- One assertion here is the whole point of the migration, and it is the last
-- one: a member who is later admitted as a provider is *still the member* of
-- the threads they paid for. Until this column existed the client answered that
-- question from `profiles.role`, which flips on admission and takes the answer
-- with it, so the rating prompt disappeared from the only person entitled to
-- use it, and the provider's work list grew a thread that was not work.

\set ON_ERROR_STOP on
begin;
select plan(11);

select has_column(
  'public', 'conversation_summaries', 'i_am_member',
  'the summary says which side you are on'
);
-- Migration 037 removed `reviewed` from the view and replaced it with
-- role-specific unread counts.  Assert the replacement column instead.
select has_column(
  'public', 'conversation_summaries', 'unread_count_member',
  'the inbox tracks role-specific unread counts (replaces reviewed, ADR-0020)'
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
    languages = array['English'],
    display_name = 'Ada',
    date_of_birth = (current_date - interval '26 years')::date,
    identity_verified_at = now(),
    is_available = true
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Fund member so the session balance gate (ADR-0020) passes on first send.
update public.profiles set promo_balance = 500
where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select test.accept_current_policies(id)
from auth.users;

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
-- `reviewed` was removed from the view in migration 037 (ADR-0020).
-- Assert the replacement: provider should have 1 unread after the member's send.
select is(
  (select unread_count_provider from public.conversation_summaries), 1,
  'the provider has one unread message after the first send'
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
    languages = array['English'],
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
    where conversation_id = (select v from test.fixture where k = 'thread')),
  true,
  'yet remains the member of the thread they paid for, which profiles.role cannot express'
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
