-- pgTAP for migration 132: voice → video switch works, needs the OTHER
-- party's consent, charges only (video − voice) for the prepaid current
-- minute, and provider accrual pays on what the member actually paid.
--
--  1-2.  requesting video succeeds; 'audio' is refused
--  3.    the requester cannot accept their own request
--  4-8.  accept: charged_now = video − voice, medium/result/channel/rate move,
--        member balance drops by exactly the difference
--  9.    provider accrual = voice minutes + the difference (not n x video rate)
-- 10-11. an unaffordable difference is refused and the call stays voice
-- 12.    a lagging meter is flushed at the VOICE rate before the difference

\set ON_ERROR_STOP on
begin;
select plan(22);

insert into auth.users (id) values
  ('aa520000-0000-4000-8000-000000000001'),  -- member
  ('bb520000-0000-4000-8000-000000000002');  -- provider

insert into public.conversations (id, member_id, provider_id)
values (
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002'
);

-- The video rate this session will be switched to (config or ADR-0021 default).
create temp table rates as
select 22 as voice, (select rate_tokens_per_min from public.get_session_billing_snapshot('video')) as video;
grant select on rates to authenticated;

-- ---------------------------------------------------------------------------
-- Session A: a live voice call, 3 prepaid minutes already debited at 22.
-- ---------------------------------------------------------------------------
update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000a1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now() - interval '150 seconds', 'agora', 'default', now()
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, next_bill_at, last_activity_at
) values (
  'ee520000-0000-4000-8000-0000000000a1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'active',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000a1',
  3, 66, 22, 60, 7,
  now() - interval '150 seconds', now() - interval '150 seconds',
  now() + interval '30 seconds', now()
);

select public.deduct_tokens('aa520000-0000-4000-8000-000000000001', 22, 'ee520000-0000-4000-8000-0000000000a1', null);
select public.deduct_tokens('aa520000-0000-4000-8000-000000000001', 22, 'ee520000-0000-4000-8000-0000000000a1', null);
select public.deduct_tokens('aa520000-0000-4000-8000-000000000001', 22, 'ee520000-0000-4000-8000-0000000000a1', null);

-- 500 - 66 = 434 left before the switch.

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.request_media_upgrade('dd520000-0000-4000-8000-0000000000a1', 'audio') ->> 'error',
  'INVALID_MEDIUM',
  '1. only voice → video is a valid switch'
);

select is(
  (public.request_media_upgrade('dd520000-0000-4000-8000-0000000000a1', 'video') ->> 'success')::boolean,
  true,
  '2. the member can ask to switch to video'
);

select is(
  public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000a1', true) ->> 'error',
  'NOT_YOUR_REQUEST',
  '3. the requester cannot accept their own request'
);

set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  (public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000a1', true) ->> 'charged_now')::integer,
  (select video - voice from rates),
  '4. accepting charges only the difference for the prepaid current minute'
);

reset role;

select is(
  (select medium::text || '/' || upgrade_result from public.calls where id = 'dd520000-0000-4000-8000-0000000000a1'),
  'video/accepted',
  '5. the call is now video and the requester can see it was accepted'
);

select is(
  (select channel || '/' || rate_tokens_per_min from public.paid_sessions where id = 'ee520000-0000-4000-8000-0000000000a1'),
  'video/' || (select video from rates),
  '6. later minutes bill at the video rate'
);

select is(
  (select tokens_debited from public.paid_sessions where id = 'ee520000-0000-4000-8000-0000000000a1'),
  66 + (select video - voice from rates),
  '7. tokens_debited = three voice minutes + the difference'
);

select is(
  (select promo_balance + purchased_balance from public.profiles where id = 'aa520000-0000-4000-8000-000000000001'),
  434 - (select video - voice from rates),
  '8. the member paid exactly the difference, nothing twice'
);

select public.end_session('ee520000-0000-4000-8000-0000000000a1');

select is(
  (select gross_tokens from public.provider_earnings_ledger where session_id = 'ee520000-0000-4000-8000-0000000000a1'),
  66 + (select video - voice from rates),
  '9. provider accrual is on what was actually debited, not minutes x final rate'
);

-- ---------------------------------------------------------------------------
-- Session B: the member cannot afford the difference.
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000a1';

update public.profiles
set promo_balance = 0, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000b1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now() - interval '30 seconds', 'agora', 'default', now()
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, next_bill_at, last_activity_at
) values (
  'ee520000-0000-4000-8000-0000000000b1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'active',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000b1',
  1, 22, 22, 60, 7,
  now() - interval '30 seconds', now() - interval '30 seconds',
  now() + interval '30 seconds', now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000b1', 'video');

set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000b1', true) ->> 'error',
  'INSUFFICIENT_BALANCE',
  '10. an unaffordable difference is refused'
);

reset role;
select is(
  (select medium::text || '/' || upgrade_result from public.calls where id = 'dd520000-0000-4000-8000-0000000000b1'),
  'voice/insufficient_balance',
  '11. the call stays voice and the requester is told why'
);

-- ---------------------------------------------------------------------------
-- Session C: the meter is lagging (next_bill_at already passed).
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000b1';
update public.paid_sessions set status = 'ended', ended_at = now()
where id = 'ee520000-0000-4000-8000-0000000000b1';

update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000c1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now() - interval '70 seconds', 'agora', 'default', now()
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, next_bill_at, last_activity_at
) values (
  'ee520000-0000-4000-8000-0000000000c1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'active',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000c1',
  1, 22, 22, 60, 7,
  now() - interval '70 seconds', now() - interval '70 seconds',
  now() - interval '10 seconds', now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000c1', 'video');
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000c1', true);

reset role;
select is(
  (select minutes_billed || '/' || tokens_debited from public.paid_sessions where id = 'ee520000-0000-4000-8000-0000000000c1'),
  '2/' || (22 + 22 + (select video - voice from rates)),
  '12. the owed voice minute is billed at 22 first, then only the difference'
);

-- ---------------------------------------------------------------------------
-- Session D (134): a pending_leases session takes the video rate, charges
-- nothing now, and the quote says so.
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000c1';
update public.paid_sessions set status = 'ended', ended_at = now()
where id = 'ee520000-0000-4000-8000-0000000000c1';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000d1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now(), 'agora', 'default', now()
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days, accepted_at
) values (
  'ee520000-0000-4000-8000-0000000000d1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'pending_leases',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000d1',
  0, 0, 22, 60, 7, now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.get_video_switch_quote('dd520000-0000-4000-8000-0000000000d1') ->> 'extra_now')::integer,
  0,
  '13. the quote for a not-yet-started session charges nothing now'
);
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000d1', 'video');
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000d1', true) ->> 'charged_now')::integer,
  0,
  '14. accepting on a pending session charges nothing yet'
);

reset role;
select is(
  (select channel || '/' || rate_tokens_per_min || '/' || tokens_debited from public.paid_sessions where id = 'ee520000-0000-4000-8000-0000000000d1'),
  'video/' || (select video from rates) || '/0',
  '15. the pending session will start at the video rate'
);

-- ---------------------------------------------------------------------------
-- Session E (135): pending session, member can afford voice but not video.
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000d1';
update public.paid_sessions set status = 'ended', ended_at = now()
where id = 'ee520000-0000-4000-8000-0000000000d1';
update public.profiles
set promo_balance = 25, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000e1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now(), 'agora', 'default', now()
);
insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days, accepted_at
) values (
  'ee520000-0000-4000-8000-0000000000e1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'pending_leases',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000e1',
  0, 0, 22, 60, 7, now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000e1', 'video');
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000e1', true) ->> 'error',
  'INSUFFICIENT_BALANCE',
  '16. a pending session is not switched to a rate the member cannot pay'
);
reset role;
select is(
  (select c.medium::text || '/' || ps.rate_tokens_per_min
     from public.calls c join public.paid_sessions ps on ps.call_id = c.id
    where c.id = 'dd520000-0000-4000-8000-0000000000e1'),
  'voice/22',
  '17. the call and its session stay voice'
);

-- ---------------------------------------------------------------------------
-- Session F (136): switched while pending, then the balance drops below the
-- video rate before both leases connect. The call starts on VOICE.
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000e1';
update public.paid_sessions set status = 'ended', ended_at = now()
where id = 'ee520000-0000-4000-8000-0000000000e1';
update public.profiles
set promo_balance = 100, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000f1',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now(), 'agora', 'default', now()
);
insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days, accepted_at
) values (
  'ee520000-0000-4000-8000-0000000000f1',
  'cc520000-0000-4000-8000-0000000000c1',
  'audio', 'pending_leases',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'dd520000-0000-4000-8000-0000000000f1',
  0, 0, 22, 60, 7, now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000f1', 'video');
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000f1', true);

reset role;
-- A chat minute elsewhere leaves enough for voice, not video.
update public.profiles
set promo_balance = (select voice from rates) + 3, purchased_balance = 0
where id = 'aa520000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.claim_session_lease('ee520000-0000-4000-8000-0000000000f1', 'connected');
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.claim_session_lease('ee520000-0000-4000-8000-0000000000f1', 'connected'),
  'active',
  '18. the call starts instead of ending'
);
reset role;
select is(
  (select channel || '/' || rate_tokens_per_min || '/' || tokens_debited
     from public.paid_sessions where id = 'ee520000-0000-4000-8000-0000000000f1'),
  'audio/22/22',
  '19. it starts at the voice rate, one voice minute charged'
);
select is(
  (select medium::text || '/' || upgrade_result
     from public.calls where id = 'dd520000-0000-4000-8000-0000000000f1'),
  'voice/insufficient_balance',
  '20. the call is back on voice and both sides are told why'
);

-- ---------------------------------------------------------------------------
-- 137: video is kill-switched between the request and the acceptance.
-- ---------------------------------------------------------------------------
update public.calls set status = 'ended', ended_at = now()
where id = 'dd520000-0000-4000-8000-0000000000f1';
update public.paid_sessions set status = 'ended', ended_at = now()
where id = 'ee520000-0000-4000-8000-0000000000f1';

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, media_backend, media_assignment_kind, last_seen_at
) values (
  'dd520000-0000-4000-8000-0000000000a9',
  'cc520000-0000-4000-8000-0000000000c1',
  'aa520000-0000-4000-8000-000000000001',
  'bb520000-0000-4000-8000-000000000002',
  'voice', 'active', now(), 'agora', 'default', now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa520000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.request_media_upgrade('dd520000-0000-4000-8000-0000000000a9', 'video');

reset role;
update admin.config_active
set payload = payload || '{"video_calls_enabled": false}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb520000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.respond_media_upgrade('dd520000-0000-4000-8000-0000000000a9', true) ->> 'error',
  'VIDEO_DISABLED',
  '21. acceptance is refused once video is switched off'
);
reset role;
select is(
  (select medium::text || '/' || upgrade_result from public.calls where id = 'dd520000-0000-4000-8000-0000000000a9'),
  'voice/declined',
  '22. the call stays voice and the request is closed'
);

select * from finish();
rollback;
