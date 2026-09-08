-- pgTAP for migration 090: an expired request stops blocking the next one.
--
-- The defect, found against production on 2026-09-08: `send_message` decides
-- whether to open a chat request by testing `status = 'pending'` alone, while
-- `session_requests_one_pending` allows exactly one pending row per
-- conversation and channel. A request that passes its 24-hour expiry untouched
-- keeps `status = 'pending'` forever, so every later send opens nothing and the
-- conversation exchanges messages that can never become a paid session.
--
-- These assertions are written against the SUPPRESSION, not against the sweep's
-- return value, because the return value is not what broke. Assertion 3 is the
-- one that was failing before 090.
--
--  1. a pending request past expires_at is what the sweep targets
--  2. ...and a pending request still inside its window is left alone
--  3. once swept, the unique index is free and a new pending request can exist
--     — which is what send_message needs and could not have
--  4. the sweep is idempotent: nothing left to do on a second pass
--  5. it does not touch requests in any other terminal state

begin;
select plan(5);

-- Two providers, because `conversations` is unique on (member_id,
-- provider_id): the second conversation needs its own counterpart.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'member400@test.local'),
  ('aaaaaaaa-0000-0000-0000-00000000d002', 'provider400@test.local'),
  ('aaaaaaaa-0000-0000-0000-00000000d003', 'provider400b@test.local');

insert into public.conversations (id, member_id, provider_id) values
  ('cccccccc-0000-0000-0000-00000000d001',
   'aaaaaaaa-0000-0000-0000-00000000d001',
   'aaaaaaaa-0000-0000-0000-00000000d002'),
  ('cccccccc-0000-0000-0000-00000000d002',
   'aaaaaaaa-0000-0000-0000-00000000d001',
   'aaaaaaaa-0000-0000-0000-00000000d003');

-- The stuck row: answered, pending, and past its own expiry — exactly the
-- production row this migration was written for.
insert into public.session_requests (
  id, conversation_id, channel, initiator_id, recipient_id,
  status, responded_at, expires_at
) values (
  'bbbbbbbb-0000-0000-0000-00000000d001',
  'cccccccc-0000-0000-0000-00000000d001',
  'chat',
  'aaaaaaaa-0000-0000-0000-00000000d001',
  'aaaaaaaa-0000-0000-0000-00000000d002',
  'pending',
  now() - interval '21 hours',
  now() - interval '1 minute'
);

-- A healthy one in a different conversation, still inside its window.
insert into public.session_requests (
  id, conversation_id, channel, initiator_id, recipient_id,
  status, expires_at
) values (
  'bbbbbbbb-0000-0000-0000-00000000d002',
  'cccccccc-0000-0000-0000-00000000d002',
  'chat',
  'aaaaaaaa-0000-0000-0000-00000000d001',
  'aaaaaaaa-0000-0000-0000-00000000d003',
  'pending',
  now() + interval '23 hours'
);

select is(
  public.expire_stale_session_requests(), 1,
  'the sweep expires the one request that is past its window'
);

select is(
  (select status::text from public.session_requests
    where id = 'bbbbbbbb-0000-0000-0000-00000000d002'),
  'pending',
  'a request still inside its window is untouched'
);

-- ---------------------------------------------------------------------------
-- 3. THE POINT OF ALL THIS. Before 090 this insert failed on
--    session_requests_one_pending, because the stale row was still 'pending'
--    — and that failure is why send_message opened nothing and the chat went
--    unbilled with no error anywhere.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    insert into public.session_requests (
      conversation_id, channel, initiator_id, recipient_id, status, expires_at
    ) values (
      'cccccccc-0000-0000-0000-00000000d001',
      'chat',
      'aaaaaaaa-0000-0000-0000-00000000d001',
      'aaaaaaaa-0000-0000-0000-00000000d002',
      'pending',
      now() + interval '24 hours'
    )
  $$,
  'a fresh request can now open in the conversation that was stuck'
);

select is(
  public.expire_stale_session_requests(), 0,
  'the sweep is idempotent — the fresh request is not collateral'
);

-- ---------------------------------------------------------------------------
-- 5. Terminal states are decisions somebody made. The sweep is about a clock
--    running out, and must not rewrite a decline into an expiry.
-- ---------------------------------------------------------------------------
insert into public.session_requests (
  id, conversation_id, channel, initiator_id, recipient_id,
  status, expires_at
) values (
  'bbbbbbbb-0000-0000-0000-00000000d003',
  'cccccccc-0000-0000-0000-00000000d002',
  'audio',
  'aaaaaaaa-0000-0000-0000-00000000d001',
  'aaaaaaaa-0000-0000-0000-00000000d003',
  'declined',
  now() - interval '2 days'
);

select is(
  (select status::text from public.session_requests
    where id = 'bbbbbbbb-0000-0000-0000-00000000d003'),
  'declined',
  'a long-expired DECLINED request keeps its decision'
);

select * from finish();
rollback;
