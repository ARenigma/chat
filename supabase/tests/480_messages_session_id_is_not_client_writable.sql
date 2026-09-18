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

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dd480000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread480',
  public.open_conversation('ee480000-0000-4000-8000-000000000002')
);

do $$
begin
  perform public.send_message(
    (select v from test.fixture where k = 'thread480'),
    'hello, 480'
  );
end$$;

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
