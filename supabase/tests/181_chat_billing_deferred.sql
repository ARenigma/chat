-- pgTAP for migration 181: chat billing deferred to first provider reply.
--
-- Assertions:
--  (a) Chat session activated, provider never replies → 0 debits, minutes_billed 0,
--      no provider_earnings_ledger row.
--  (b) Provider's first in-session message triggers minute 1: exactly 1 usage_debit
--      row, minutes_billed = 1, next_bill_at is set, member balance reduced by rate.
--  (c) Provider lease goes stale → meter ends session via disconnect_grace;
--      no extra minute billed past the stale heartbeat cutoff.
--  (d) Normal manual end of a chat session with billing active: flush bills owed
--      minute, accrual written — behaviour unchanged from 107.
--  (e) Voice/video (audio channel): minute 1 still prepaid at claim_session_lease
--      activation — audio path is unchanged by 181.

\set ON_ERROR_STOP on
begin;
select plan(16);

-- ---------------------------------------------------------------------------
-- Shared fixture helpers
-- ---------------------------------------------------------------------------
-- Two users: member (aa181…01) and provider (bb181…02)
insert into auth.users (id) values
  ('aa181000-0000-4000-8000-000000000001'),
  ('bb181000-0000-4000-8000-000000000002');

-- Provider application + approval creates the provider profile.
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values (
  'bb181000-0000-4000-8000-000000000002',
  'Test Provider 181',
  (current_date - interval '28 years')::date,
  array['English']
);
select public.approve_provider_application('bb181000-0000-4000-8000-000000000002');

-- Policy acceptances for both users (required by send_message guard).
insert into public.policy_acceptances (user_id, policy_kind, version_id)
select u.id, pv.kind, pv.id
from (values
  ('aa181000-0000-4000-8000-000000000001'::uuid),
  ('bb181000-0000-4000-8000-000000000002'::uuid)
) u(id)
cross join lateral (
  select distinct on (kind) id, kind
  from public.policy_versions
  where effective_at <= now()
  order by kind, version desc
) pv;

-- Give the member a budget.
update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa181000-0000-4000-8000-000000000001';

-- Conversation (direct insert to bypass RLS in test context).
insert into public.conversations (id, member_id, provider_id)
values (
  'cc181000-0000-4000-8000-0000000000c1',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002'
);

-- Derive the chat billing rate from the live config.
create temp table chat_rate as
select rate_tokens_per_min as rate
from public.get_session_billing_snapshot('chat');

-- ---------------------------------------------------------------------------
-- (a) Chat activated, provider never replies → 0 debit, 0 minutes_billed
-- ---------------------------------------------------------------------------
-- Insert a chat paid_session in pending_leases state; simulate both leases
-- arriving (which 181 now activates without debiting); end without any message.

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at
) values (
  '5e181a00-0000-4000-8000-000000000001',
  'cc181000-0000-4000-8000-0000000000c1',
  'chat', 'active',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002',
  (select rate from chat_rate), 60, 7,
  now()
);
-- Mark as active/started with no billing begun (181 state).
update public.paid_sessions
set started_at       = now(),
    last_activity_at = now(),
    minutes_billed   = 0,
    tokens_debited   = 0,
    next_bill_at     = null
where id = '5e181a00-0000-4000-8000-000000000001';

-- Insert member-side lease (provider never joins → session ends via manual end
-- called as the member — use service_role bypass since we're testing the billing
-- invariant, not the end_session auth path).
insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
values
  ('5e181a00-0000-4000-8000-000000000001', 'aa181000-0000-4000-8000-000000000001', 'foreground', now()),
  ('5e181a00-0000-4000-8000-000000000001', 'bb181000-0000-4000-8000-000000000002', 'foreground', now());

-- End as member (manual end, not disconnect_grace).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa181000-0000-4000-8000-000000000001","role":"authenticated"}';

select public.end_session('5e181a00-0000-4000-8000-000000000001', 'manual');

reset role;

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = '5e181a00-0000-4000-8000-000000000001'
     and kind = 'usage_debit'),
  0,
  '(a) chat ended before provider message: 0 usage_debit rows'
);

select is(
  (select minutes_billed from public.paid_sessions
   where id = '5e181a00-0000-4000-8000-000000000001'),
  0,
  '(a) minutes_billed = 0 when provider never replied'
);

select ok(
  not exists (
    select 1 from public.provider_earnings_ledger
    where session_id = '5e181a00-0000-4000-8000-000000000001'
  ),
  '(a) no provider_earnings_ledger row written when 0 debits'
);

select is(
  (select promo_balance + purchased_balance from public.profiles
   where id = 'aa181000-0000-4000-8000-000000000001'),
  500,
  '(a) member balance unchanged when provider never replied'
);

-- ---------------------------------------------------------------------------
-- (b) Provider first message starts billing: 1 debit, next_bill_at anchored
-- ---------------------------------------------------------------------------
-- Session (b): chat active, no billing started. Provider sends a message.

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at,
  started_at, last_activity_at, minutes_billed, tokens_debited, next_bill_at
) values (
  '5e181b00-0000-4000-8000-000000000002',
  'cc181000-0000-4000-8000-0000000000c1',
  'chat', 'active',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002',
  (select rate from chat_rate), 60, 7,
  now() - interval '2 minutes',
  now() - interval '2 minutes',
  now() - interval '2 minutes',
  0, 0, null
);

insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
values
  ('5e181b00-0000-4000-8000-000000000002', 'aa181000-0000-4000-8000-000000000001', 'foreground', now()),
  ('5e181b00-0000-4000-8000-000000000002', 'bb181000-0000-4000-8000-000000000002', 'foreground', now());

-- Provider sends first in-session message via the production RPC path.
-- send_message resolves the active session and links session_id server-side;
-- the touch_session_activity trigger fires and debits minute 1.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb181000-0000-4000-8000-000000000002","role":"authenticated"}';

select public.send_message(
  'cc181000-0000-4000-8000-0000000000c1',
  'Hello from the provider'
);

reset role;

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = '5e181b00-0000-4000-8000-000000000002'
     and kind = 'usage_debit'),
  1,
  '(b) exactly 1 usage_debit row after provider''s first message'
);

select is(
  (select minutes_billed from public.paid_sessions
   where id = '5e181b00-0000-4000-8000-000000000002'),
  1,
  '(b) minutes_billed = 1 after provider first message'
);

select ok(
  (select next_bill_at from public.paid_sessions
   where id = '5e181b00-0000-4000-8000-000000000002') is not null,
  '(b) next_bill_at is set after provider first message'
);

select ok(
  (select next_bill_at from public.paid_sessions
   where id = '5e181b00-0000-4000-8000-000000000002')
  between now() + interval '50 seconds' and now() + interval '70 seconds',
  '(b) next_bill_at is approximately now + 1 minute'
);

select is(
  (select promo_balance + purchased_balance from public.profiles
   where id = 'aa181000-0000-4000-8000-000000000001'),
  500 - (select rate from chat_rate),
  '(b) member balance reduced by exactly rate_tokens_per_min after first message'
);

-- End session (b) to release the one-live-per-(conversation, channel) slot
-- before case (c) inserts another chat session on the same conversation.
-- next_bill_at is ~now+60s so the flush loop does not fire; assertions above
-- are not affected by this end call.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa181000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.end_session('5e181b00-0000-4000-8000-000000000002', 'manual');
reset role;

-- ---------------------------------------------------------------------------
-- (c) Provider lease goes stale → disconnect_grace ends without extra billing
-- ---------------------------------------------------------------------------
-- Session (c): chat active, billing started (next_bill_at in the past so a
-- naive flush would bill again). Provider's last heartbeat is 60 s ago (stale).
-- end_session('disconnect_grace') must NOT collect the overdue minute.

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at,
  started_at, last_activity_at, minutes_billed, tokens_debited, next_bill_at
) values (
  '5e181c00-0000-4000-8000-000000000003',
  'cc181000-0000-4000-8000-0000000000c1',
  'chat', 'active',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002',
  (select rate from chat_rate), 60, 7,
  now() - interval '90 seconds',
  now() - interval '90 seconds',
  now() - interval '65 seconds',
  1, (select rate from chat_rate),
  -- next_bill_at is 30 s in the past: would bill if stale cutoff not applied.
  now() - interval '30 seconds'
);

-- Minute 1 was already debited (simulate it).
select public.deduct_tokens(
  'aa181000-0000-4000-8000-000000000001',
  (select rate from chat_rate),
  '5e181c00-0000-4000-8000-000000000003',
  null
);

-- Member heartbeat: fresh. Provider heartbeat: 60 s ago (stale).
insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
values
  ('5e181c00-0000-4000-8000-000000000003', 'aa181000-0000-4000-8000-000000000001', 'foreground', now()),
  ('5e181c00-0000-4000-8000-000000000003', 'bb181000-0000-4000-8000-000000000002', 'foreground', now() - interval '60 seconds');

-- Record balance before disconnect end.
create temp table balance_before_c as
select promo_balance + purchased_balance as bal
from public.profiles
where id = 'aa181000-0000-4000-8000-000000000001';

-- meter_active_sessions would call end_session('disconnect_grace') when it
-- finds the stale lease. Call it directly here (service_role path; auth.uid()
-- null bypasses the participant check in end_session — verified from the
-- null-not-in behaviour in PL/pgSQL).
reset role;
select public.end_session('5e181c00-0000-4000-8000-000000000003', 'disconnect_grace');

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = '5e181c00-0000-4000-8000-000000000003'
     and kind = 'usage_debit'),
  1,
  '(c) still only 1 usage_debit after disconnect_grace — stale cutoff blocked flush'
);

select is(
  (select promo_balance + purchased_balance from public.profiles
   where id = 'aa181000-0000-4000-8000-000000000001'),
  (select bal from balance_before_c),
  '(c) member balance unchanged by disconnect_grace when next_bill_at > stale heartbeat'
);

-- ---------------------------------------------------------------------------
-- (d) Normal manual end with billing active: owed minute is flushed
-- ---------------------------------------------------------------------------
-- Session (d): chat active, next_bill_at 10 s in the past (owed). Member taps
-- End (manual). The flush must collect the owed minute.

-- Restore a clean balance first.
update public.profiles
set promo_balance = 200, purchased_balance = 0
where id = 'aa181000-0000-4000-8000-000000000001';

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at,
  started_at, last_activity_at, minutes_billed, tokens_debited, next_bill_at
) values (
  '5e181d00-0000-4000-8000-000000000004',
  'cc181000-0000-4000-8000-0000000000c1',
  'chat', 'active',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002',
  (select rate from chat_rate), 60, 7,
  now() - interval '75 seconds',
  now() - interval '75 seconds',
  now() - interval '10 seconds',
  1, (select rate from chat_rate),
  now() - interval '10 seconds'  -- 10 s overdue: flush should collect it
);

-- Simulate minute 1 already debited.
select public.deduct_tokens(
  'aa181000-0000-4000-8000-000000000001',
  (select rate from chat_rate),
  '5e181d00-0000-4000-8000-000000000004',
  null
);

insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
values
  ('5e181d00-0000-4000-8000-000000000004', 'aa181000-0000-4000-8000-000000000001', 'foreground', now()),
  ('5e181d00-0000-4000-8000-000000000004', 'bb181000-0000-4000-8000-000000000002', 'foreground', now());

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa181000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.end_session('5e181d00-0000-4000-8000-000000000004', 'manual');
reset role;

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = '5e181d00-0000-4000-8000-000000000004'
     and kind = 'usage_debit'),
  2,
  '(d) normal manual end: owed minute flushed → 2 usage_debit rows'
);

select is(
  (select minutes_billed from public.paid_sessions
   where id = '5e181d00-0000-4000-8000-000000000004'),
  2,
  '(d) minutes_billed = 2 after flush on manual end'
);

-- ---------------------------------------------------------------------------
-- (e) Audio (voice) session: minute 1 still prepaid at claim_session_lease
-- ---------------------------------------------------------------------------
-- Insert an audio session in pending_leases; claim both leases; verify that
-- deduct_tokens fired and next_bill_at is set — 181 must not touch this path.

update public.profiles
set promo_balance = 200, purchased_balance = 0
where id = 'aa181000-0000-4000-8000-000000000001';

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at
) values (
  '5e181e00-0000-4000-8000-000000000005',
  'cc181000-0000-4000-8000-0000000000c1',
  'audio', 'pending_leases',
  'aa181000-0000-4000-8000-000000000001',
  'bb181000-0000-4000-8000-000000000002',
  22, 60, 7, now()
);

-- Claim member lease.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa181000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.claim_session_lease('5e181e00-0000-4000-8000-000000000005', 'connected');

-- Claim provider lease → activation fires.
set local request.jwt.claims =
  '{"sub":"bb181000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.claim_session_lease('5e181e00-0000-4000-8000-000000000005', 'connected');

reset role;

select is(
  (select count(*)::integer from public.token_transactions
   where session_id = '5e181e00-0000-4000-8000-000000000005'
     and kind = 'usage_debit'),
  1,
  '(e) audio session: 1 usage_debit at activation (minute 1 prepaid)'
);

select ok(
  (select next_bill_at from public.paid_sessions
   where id = '5e181e00-0000-4000-8000-000000000005') is not null,
  '(e) audio session: next_bill_at is set immediately at activation'
);

select is(
  (select minutes_billed from public.paid_sessions
   where id = '5e181e00-0000-4000-8000-000000000005'),
  1,
  '(e) audio session: minutes_billed = 1 at activation'
);

select * from finish();
rollback;
