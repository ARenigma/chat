-- pgTAP for migration 116: messages.session_id/client_nonce/notified_at are
-- not client-writable.
--
-- Written as the attack, matching 030's own convention for guard triggers: a
-- recipient (the one role whose UPDATE policy on `messages` otherwise allows
-- touching a row at all) tries each column in turn.

\set ON_ERROR_STOP on
begin;
select plan(4);

select has_trigger(
  'public', 'messages', 'guard_message_session_and_dedup_columns',
  'messages carry a guard for session_id/client_nonce/notified_at'
);

insert into auth.users (id) values
  ('dd480000-0000-4000-8000-000000000001'),  -- sender
  ('ee480000-0000-4000-8000-000000000002'); -- recipient

-- open_conversation now requires an admitted provider. This suite predates that
-- invariant, so create the same minimal approved-provider fixture used by the
-- call suites rather than failing before any guard assertion runs.
insert into public.provider_applications
  (user_id, display_name, date_of_birth, languages)
values (
  'ee480000-0000-4000-8000-000000000002',
  'Guard Provider 480',
  (current_date - interval '26 years')::date,
  array['English']
);
select public.approve_provider_application(
  'ee480000-0000-4000-8000-000000000002'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dd480000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread480',
  public.open_conversation('ee480000-0000-4000-8000-000000000002')
);

-- This suite tests the UPDATE guard, not the paid-send/session preconditions.
-- Insert the fixture as the database owner so a future send_message gate cannot
-- make the UPDATE match zero rows and turn every throws_ok into a false failure.
reset role;
insert into public.messages (conversation_id, sender_id, body)
values (
  (select v from test.fixture where k = 'thread480'),
  'dd480000-0000-4000-8000-000000000001',
  'hello, 480'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ee480000-0000-4000-8000-000000000002","role":"authenticated"}';

-- The exploit this migration closes: a recipient could set session_id to
-- anything (including NULL), which is exactly what would let a message
-- outlive the hiding sweep `end_session` runs by session_id -- undermining
-- the ephemeral-bilateral-paid-session guarantee ADR-0020 sells the product
-- on.
select throws_ok(
  $$update public.messages set session_id = gen_random_uuid()
    where sender_id = 'dd480000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'the recipient cannot assign a message to a session of their choosing'
);
select throws_ok(
  $$update public.messages set client_nonce = gen_random_uuid()
    where sender_id = 'dd480000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor forge its idempotency key'
);
select throws_ok(
  $$update public.messages set notified_at = now()
    where sender_id = 'dd480000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor mark it as already having been pushed'
);
reset role;

select * from finish();
rollback;
