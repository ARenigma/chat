-- pgTAP for migration 060: payout settle + INR sync assert.
--
-- Covers:
--   1–2. mark/settle function grants
--   3.   mark_provider_payout_submitted stamps cf id, stays processing
--   4.   settle ok → completed
--   5.   settle ok replay is idempotent
--   6.   settle fail after completed reverts earnings to cleared
--   7–9. assert_call_inr_sync on voice call with matching COGS estimate
--  10.  assert raises when COGS estimate is wrong

\set ON_ERROR_STOP on
begin;
select plan(14);

select ok(
  has_function_privilege(
    'service_role',
    'public.mark_provider_payout_submitted(uuid, text)',
    'EXECUTE'
  ),
  '1. service_role can mark_provider_payout_submitted'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.settle_provider_payout_batch(uuid, text, boolean)',
    'EXECUTE'
  ),
  '2. service_role can settle_provider_payout_batch'
);

insert into auth.users (id) values
  ('cc060000-0000-4060-8000-000000000001'),
  ('cc060000-0000-4060-8000-000000000002');

insert into public.provider_payout_batches (
  id, provider_id, status, total_tokens, total_paise, initiated_at
) values (
  'cc060000-0000-4060-8000-0000000000b1',
  'cc060000-0000-4060-8000-000000000002',
  'processing', 66, 6600, now()
);

insert into public.provider_earnings_ledger (
  provider_id, session_id, minutes_billed, rate_per_min,
  gross_tokens, provider_tokens, hold_until, status, payout_batch_id
) values (
  'cc060000-0000-4060-8000-000000000002',
  'cc060000-0000-4060-8000-0000000000a1',
  5, 22, 110, 66,
  now() - interval '1 day',
  'paid',
  'cc060000-0000-4060-8000-0000000000b1'
);

select lives_ok(
  $$select public.mark_provider_payout_submitted(
    'cc060000-0000-4060-8000-0000000000b1',
    'cf-xfer-1'
  )$$,
  '3a. mark submitted runs'
);

select is(
  (select status from public.provider_payout_batches
   where id = 'cc060000-0000-4060-8000-0000000000b1'),
  'processing',
  '3b. mark leaves batch processing'
);

select is(
  (select cashfree_batch_id from public.provider_payout_batches
   where id = 'cc060000-0000-4060-8000-0000000000b1'),
  'cf-xfer-1',
  '3c. mark stamps cashfree id'
);

select lives_ok(
  $$select public.settle_provider_payout_batch(
    'cc060000-0000-4060-8000-0000000000b1',
    'cf-xfer-1',
    true
  )$$,
  '4a. settle ok runs'
);

select is(
  (select status from public.provider_payout_batches
   where id = 'cc060000-0000-4060-8000-0000000000b1'),
  'completed',
  '4b. settle ok → completed'
);

select lives_ok(
  $$select public.settle_provider_payout_batch(
    'cc060000-0000-4060-8000-0000000000b1',
    'cf-xfer-1',
    true
  )$$,
  '5. settle ok replay is idempotent'
);

select lives_ok(
  $$select public.settle_provider_payout_batch(
    'cc060000-0000-4060-8000-0000000000b1',
    'cf-xfer-1',
    false
  )$$,
  '6a. settle fail after completed (bank reverse) runs'
);

select is(
  (select status from public.provider_earnings_ledger
   where session_id = 'cc060000-0000-4060-8000-0000000000a1'),
  'cleared',
  '6b. reverse reverts earnings to cleared'
);

-- INR sync fixture: voice call + product_estimate COGS (no session required
-- for COGS-only path; earnings optional).
insert into public.conversations (id, member_id, provider_id)
values (
  'cc060000-0000-4060-8000-0000000000c1',
  'cc060000-0000-4060-8000-000000000001',
  'cc060000-0000-4060-8000-000000000002'
);

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, ended_at, minutes_billed, tokens_debited,
  media_backend, media_assignment_kind
) values (
  'cc060000-0000-4060-8000-0000000000d1',
  'cc060000-0000-4060-8000-0000000000c1',
  'cc060000-0000-4060-8000-000000000001',
  'cc060000-0000-4060-8000-000000000002',
  'voice', 'ended',
  now() - interval '10 minutes', now() - interval '5 minutes',
  5, 110, 'agora', 'default'
);

select is(
  public.refresh_media_channel_usage_estimates(now() - interval '1 day'),
  1,
  '7. refresh writes COGS estimate for the call'
);

select is(
  (public.assert_call_inr_sync('cc060000-0000-4060-8000-0000000000d1')
    ->> 'margin_after_media_paise')::integer,
  -- take without earnings = 110 - 0 = 110 tokens = 11000 paise
  -- voice COGS 5 × 16 = 80 paise → margin 10920
  10920,
  '8. assert_call_inr_sync margin = member_paise − agora_cogs (no accrual yet)'
);

select is(
  (public.assert_call_inr_sync('cc060000-0000-4060-8000-0000000000d1')
    ->> 'agora_cost_paise_est')::integer,
  80,
  '9. voice 5 min × 16 paise = ₹0.80 COGS estimate'
);

update public.media_channel_usage
set cost_paise_est = 999
where call_id = 'cc060000-0000-4060-8000-0000000000d1';

select throws_ok(
  $$select public.assert_call_inr_sync('cc060000-0000-4060-8000-0000000000d1')$$,
  'P0001',
  'product_estimate COGS != minutes × media_cogs rate',
  '10. assert raises when COGS drifts from rates'
);

select * from finish();
rollback;
