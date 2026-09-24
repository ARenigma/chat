-- pgTAP for migration 140: a call switched to video mid-session reconciles.
--
-- Three voice minutes at 20, the switch minute's 40 difference, two video
-- minutes at 60: the member paid 220 for 5 minutes, which is not 5 × 60.
-- The accrual books 220 and the reconciliation must accept it.

\set ON_ERROR_STOP on
begin;
select plan(4);

insert into auth.users (id) values
  ('cc140000-0000-4140-8000-000000000001'),
  ('cc140000-0000-4140-8000-000000000002');

insert into public.conversations (id, member_id, provider_id)
values (
  'cc140000-0000-4140-8000-0000000000c1',
  'cc140000-0000-4140-8000-000000000001',
  'cc140000-0000-4140-8000-000000000002'
);

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, ended_at, minutes_billed, tokens_debited,
  media_backend, media_assignment_kind, upgrade_result
) values (
  'cc140000-0000-4140-8000-0000000000d1',
  'cc140000-0000-4140-8000-0000000000c1',
  'cc140000-0000-4140-8000-000000000001',
  'cc140000-0000-4140-8000-000000000002',
  'video', 'ended',
  now() - interval '10 minutes', now() - interval '5 minutes',
  0, 0, 'agora', 'default', 'accepted'
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, ended_at
) values (
  'cc140000-0000-4140-8000-000000000051',
  'cc140000-0000-4140-8000-0000000000c1',
  'video', 'ended',
  'cc140000-0000-4140-8000-000000000001',
  'cc140000-0000-4140-8000-000000000002',
  'cc140000-0000-4140-8000-0000000000d1',
  5, 220, 60, 60, 7,
  now() - interval '10 minutes',
  now() - interval '10 minutes',
  now() - interval '5 minutes'
);

insert into public.token_transactions (
  user_id, kind, status, amount_paise, tokens_delta, session_id
)
select
  'cc140000-0000-4140-8000-000000000001', 'usage_debit', 'succeeded',
  d * 100, -d, 'cc140000-0000-4140-8000-000000000051'
from unnest(array[20, 20, 20, 40, 60, 60]) as d;

select public.record_provider_accrual(
  'cc140000-0000-4140-8000-000000000002',
  'cc140000-0000-4140-8000-000000000051',
  5, 60, 60, 7, null
);

select is(
  (select gross_tokens from public.provider_earnings_ledger
   where session_id = 'cc140000-0000-4140-8000-000000000051'),
  220,
  '1. accrual books what the member paid, not minutes × video rate'
);

select lives_ok(
  $$select public.assert_call_inr_sync('cc140000-0000-4140-8000-0000000000d1')$$,
  '2. a switched call passes reconciliation'
);

select is(
  (public.assert_call_inr_sync('cc140000-0000-4140-8000-0000000000d1')
    ->> 'platform_take_tokens')::integer,
  220 - 132,
  '3. take = gross 220 − provider 60% (132)'
);

update public.provider_earnings_ledger
set gross_tokens = 300
where session_id = 'cc140000-0000-4140-8000-000000000051';

select throws_ok(
  $$select public.assert_call_inr_sync('cc140000-0000-4140-8000-0000000000d1')$$,
  'P0001',
  null,
  '4. a ledger gross that drifts from the debits still raises'
);

select * from finish();
rollback;
