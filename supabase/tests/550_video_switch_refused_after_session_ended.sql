-- pgTAP for migration 142: a switch is refused once billing has ended, and a
-- call that was never billed still switches.

\set ON_ERROR_STOP on
begin;
select plan(6);

insert into auth.users (id) values
  ('cc142000-0000-4142-8000-000000000001'),
  ('cc142000-0000-4142-8000-000000000002');

-- Two conversations with different people: a conversation, and a callee,
-- each hold at most one live call.
insert into auth.users (id) values
  ('cc142000-0000-4142-8000-000000000003'),
  ('cc142000-0000-4142-8000-000000000004');
insert into public.conversations (id, member_id, provider_id)
values
  ('cc142000-0000-4142-8000-0000000000c1',
   'cc142000-0000-4142-8000-000000000001',
   'cc142000-0000-4142-8000-000000000002'),
  ('cc142000-0000-4142-8000-0000000000c2',
   'cc142000-0000-4142-8000-000000000003',
   'cc142000-0000-4142-8000-000000000004');

-- Call d1: still 'active', but metering has ended its paid session.
-- Call d2: active and never billed. The member has asked on both.
insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status, started_at,
  media_backend, media_assignment_kind,
  upgrade_requested_by, upgrade_to_medium, upgrade_requested_at
) values
  ('cc142000-0000-4142-8000-0000000000d1',
   'cc142000-0000-4142-8000-0000000000c1',
   'cc142000-0000-4142-8000-000000000001',
   'cc142000-0000-4142-8000-000000000002',
   'voice', 'active', now() - interval '3 minutes', 'agora', 'default',
   'cc142000-0000-4142-8000-000000000001', 'video', now()),
  ('cc142000-0000-4142-8000-0000000000d2',
   'cc142000-0000-4142-8000-0000000000c2',
   'cc142000-0000-4142-8000-000000000003',
   'cc142000-0000-4142-8000-000000000004',
   'voice', 'active', now() - interval '3 minutes', 'agora', 'default',
   'cc142000-0000-4142-8000-000000000003', 'video', now());

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, ended_at
) values (
  'cc142000-0000-4142-8000-000000000051',
  'cc142000-0000-4142-8000-0000000000c1',
  'audio', 'ended',
  'cc142000-0000-4142-8000-000000000001',
  'cc142000-0000-4142-8000-000000000002',
  'cc142000-0000-4142-8000-0000000000d1',
  2, 40, 20, 60, 7,
  now() - interval '3 minutes', now() - interval '3 minutes', now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc142000-0000-4142-8000-000000000002","role":"authenticated"}';

select is(
  public.get_video_switch_quote('cc142000-0000-4142-8000-0000000000d1') ->> 'error',
  'SESSION_ENDED',
  '1. no price is quoted once billing has ended'
);

select is(
  public.respond_media_upgrade('cc142000-0000-4142-8000-0000000000d1', true) ->> 'error',
  'SESSION_ENDED',
  '2. accepting after the session ended is refused'
);

reset role;

select is(
  (select medium::text || '/' || upgrade_result
   from public.calls where id = 'cc142000-0000-4142-8000-0000000000d1'),
  'voice/session_ended',
  '3. the call stays on voice and records why'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc142000-0000-4142-8000-000000000004","role":"authenticated"}';

select is(
  (public.get_video_switch_quote('cc142000-0000-4142-8000-0000000000d2') ->> 'billed')::boolean,
  false,
  '4. a never-billed call is quoted as not charged'
);

select is(
  (public.respond_media_upgrade('cc142000-0000-4142-8000-0000000000d2', true) ->> 'accepted')::boolean,
  true,
  '5. a never-billed call still switches'
);

reset role;

select is(
  (select medium::text from public.calls where id = 'cc142000-0000-4142-8000-0000000000d2'),
  'video',
  '6. and is on video'
);

select * from finish();
rollback;
