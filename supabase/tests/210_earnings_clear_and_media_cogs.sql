-- pgTAP for migrations 058–059: earnings clear + media COGS ledger.
--
-- Assertions:
--   1.  clear_pending_earnings exists
--   2.  service_role has EXECUTE; authenticated does not
--   3.  past-hold pending → cleared
--   4.  future-hold pending stays pending
--   5.  second clear is a no-op (0 rows)
--   6.  media_vendor_usage_daily / media_channel_usage exist
--   7.  upsert_media_vendor_usage_daily computes std-minutes
--   8.  refresh_media_channel_usage_estimates writes product_estimate
--   9.  admin.call_margin / daily_media_margin / session_margin exist
--  10. call_margin joins member tokens to estimated COGS

\set ON_ERROR_STOP on
begin;
select plan(15);

select ok(
  exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'clear_pending_earnings'
  ),
  '1. clear_pending_earnings exists'
);

select ok(
  has_function_privilege(
    'service_role', 'public.clear_pending_earnings()', 'EXECUTE'
  ),
  '2a. service_role can clear_pending_earnings'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.clear_pending_earnings()', 'EXECUTE'
  ),
  '2b. authenticated cannot clear_pending_earnings'
);

-- Fixtures: two auth users (profiles via trigger).
insert into auth.users (id) values
  ('cc058000-0000-4058-8000-000000000001'),
  ('cc058000-0000-4058-8000-000000000002');

insert into public.provider_earnings_ledger (
  provider_id, session_id, minutes_billed, rate_per_min,
  gross_tokens, provider_tokens, hold_until, status
) values
  (
    'cc058000-0000-4058-8000-000000000002',
    'cc058000-0000-4058-8000-0000000000a1',
    5, 22, 110, 66,
    now() - interval '1 hour',
    'pending'
  ),
  (
    'cc058000-0000-4058-8000-000000000002',
    'cc058000-0000-4058-8000-0000000000a2',
    3, 22, 66, 40,
    now() + interval '3 days',
    'pending'
  );

select is(
  public.clear_pending_earnings(),
  1,
  '3. clears exactly one past-hold pending row'
);

select is(
  (select status from public.provider_earnings_ledger
   where session_id = 'cc058000-0000-4058-8000-0000000000a1'),
  'cleared',
  '3b. past-hold row is cleared'
);

select is(
  (select status from public.provider_earnings_ledger
   where session_id = 'cc058000-0000-4058-8000-0000000000a2'),
  'pending',
  '4. future-hold row stays pending'
);

select is(
  public.clear_pending_earnings(),
  0,
  '5. second clear is a no-op'
);

select ok(
  to_regclass('public.media_vendor_usage_daily') is not null
  and to_regclass('public.media_channel_usage') is not null,
  '6. usage tables exist'
);

select lives_ok(
  $$select public.upsert_media_vendor_usage_daily(
     'agora'::public.call_media_backend,
     'test-project',
     current_date,
     120,
     60,
     0, 0, 0, 0,
     'agora_console_api',
     '{}'::jsonb,
     null
   )$$,
  '7a. upsert_media_vendor_usage_daily runs'
);

select is(
  (select std_minutes_est from public.media_vendor_usage_daily
   where project_id = 'test-project' and usage_date = current_date),
  6.0000::numeric,
  '7. upsert computes 2 + 4 = 6 std-minutes'
);

-- Minimal conversation + ended agora call + paid_session (product meter).
select lives_ok(
  $$
  insert into public.conversations (id, member_id, provider_id)
  values (
    'cc058000-0000-4058-8000-0000000000c1',
    'cc058000-0000-4058-8000-000000000001',
    'cc058000-0000-4058-8000-000000000002'
  );
  insert into public.calls (
    id, conversation_id, caller_id, callee_id, medium, status,
    started_at, ended_at, minutes_billed, tokens_debited, media_backend
  ) values (
    'cc058000-0000-4058-8000-0000000000d1',
    'cc058000-0000-4058-8000-0000000000c1',
    'cc058000-0000-4058-8000-000000000001',
    'cc058000-0000-4058-8000-000000000002',
    'voice', 'ended',
    now() - interval '10 minutes', now() - interval '5 minutes',
    0, 0, 'agora'
  );
  insert into public.paid_sessions (
    id, conversation_id, channel, status, member_id, provider_id,
    call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
    provider_share_percent, payout_hold_days,
    accepted_at, started_at, ended_at
  ) values (
    'cc058000-0000-4058-8000-000000000051',
    'cc058000-0000-4058-8000-0000000000c1',
    'audio', 'ended',
    'cc058000-0000-4058-8000-000000000001',
    'cc058000-0000-4058-8000-000000000002',
    'cc058000-0000-4058-8000-0000000000d1',
    5, 110, 22, 60, 7,
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '5 minutes'
  );
  $$,
  '7b. fixture conversation + ended agora call + paid_session'
);

select is(
  public.refresh_media_channel_usage_estimates(now() - interval '1 day'),
  1,
  '8. refresh writes one product_estimate row'
);

select is(
  (select std_minutes_est from public.media_channel_usage
   where call_id = 'cc058000-0000-4058-8000-0000000000d1'),
  10.0000,
  '8b. voice 5 conv-min → 10 std-min'
);

select ok(
  to_regclass('admin.call_margin') is not null
  and to_regclass('admin.daily_media_margin') is not null
  and to_regclass('admin.session_margin') is not null,
  '9. margin views exist'
);

select is(
  (select agora_std_minutes_est from admin.call_margin
   where call_id = 'cc058000-0000-4058-8000-0000000000d1'),
  10.0000,
  '10. call_margin shows estimated Agora std-minutes'
);

select * from finish();
rollback;
