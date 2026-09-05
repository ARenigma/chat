-- pgTAP for migration 061: dual-source COGS, invoice import, variance alerts.
--
-- 1.  media_channel_usage PK is (call_id, source)
-- 2.  product_estimate + agora_analytics coexist
-- 3.  import_media_invoice_days writes invoice_csv (preferred over console)
-- 4.  check_media_cogs_variance raises day alert when std-min drifts
-- 5.  call-level product vs analytics alert when threshold exceeded
-- 6.  admin.media_cogs_open_alerts lists unacked rows

\set ON_ERROR_STOP on
begin;
select plan(12);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.media_channel_usage'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) like '%call_id%source%'
  ),
  '1. media_channel_usage PK includes (call_id, source)'
);

insert into auth.users (id) values
  ('cc061000-0000-4061-8000-000000000001'),
  ('cc061000-0000-4061-8000-000000000002');

insert into public.conversations (id, member_id, provider_id)
values (
  'cc061000-0000-4061-8000-0000000000c1',
  'cc061000-0000-4061-8000-000000000001',
  'cc061000-0000-4061-8000-000000000002'
);

insert into public.calls (
  id, conversation_id, caller_id, callee_id, medium, status,
  started_at, ended_at, media_backend, media_assignment_kind
) values (
  'cc061000-0000-4061-8000-0000000000d1',
  'cc061000-0000-4061-8000-0000000000c1',
  'cc061000-0000-4061-8000-000000000001',
  'cc061000-0000-4061-8000-000000000002',
  'voice', 'ended',
  now() - interval '10 minutes', now() - interval '5 minutes',
  'agora', 'default'
);

insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  call_id, minutes_billed, tokens_debited, rate_tokens_per_min,
  provider_share_percent, payout_hold_days,
  accepted_at, started_at, ended_at
) values (
  'cc061000-0000-4061-8000-000000000051',
  'cc061000-0000-4061-8000-0000000000c1',
  'audio', 'ended',
  'cc061000-0000-4061-8000-000000000001',
  'cc061000-0000-4061-8000-000000000002',
  'cc061000-0000-4061-8000-0000000000d1',
  5, 110, 22, 60, 7,
  now() - interval '10 minutes',
  now() - interval '10 minutes',
  now() - interval '5 minutes'
);

select is(
  public.refresh_media_channel_usage_estimates(now() - interval '1 day'),
  1,
  '2. refresh writes product_estimate from paid_sessions'
);

select lives_ok(
  $$select public.upsert_media_channel_usage_analytics(
    'cc061000-0000-4061-8000-0000000000d1',
    600,
    2,
    '{"test":true}'::jsonb
  )$$,
  '3a. analytics upsert runs'
);

select is(
  (select count(*)::integer from public.media_channel_usage
   where call_id = 'cc061000-0000-4061-8000-0000000000d1'),
  2,
  '3. product_estimate and agora_analytics coexist'
);

select is(
  (select conversation_minutes from public.media_channel_usage
   where call_id = 'cc061000-0000-4061-8000-0000000000d1'
     and source = 'agora_analytics'),
  10,
  '3b. 600s Analytics → 10 conversation-minutes'
);

-- Console day with tiny std-min vs product estimate (5 voice min → 10 std).
select lives_ok(
  $$select public.upsert_media_vendor_usage_daily(
     'agora'::public.call_media_backend,
     'test-project-061',
     (timezone('utc', now())::date),
     60, 0, 0, 0, 0, 0,
     'agora_console_api',
     '{}'::jsonb,
     null
   )$$,
  '4a. console vendor day (1 std-min) upserted'
);

select is(
  public.import_media_invoice_days(
    jsonb_build_array(
      jsonb_build_object(
        'project_id', 'test-project-061',
        'usage_date', timezone('utc', now())::date,
        'duration_audio_seconds', 60,
        'cost_paise', 999
      )
    )
  ),
  1,
  '4. invoice_csv import writes one day'
);

select is(
  (select vendor_source from admin.daily_media_margin
   where usage_date = timezone('utc', now())::date
     and vendor_cogs_paise = 999),
  'invoice_csv',
  '4b. daily_media_margin prefers invoice_csv'
);

-- Force a huge product vs analytics gap (analytics=10, product=5 → -50%).
-- Threshold default is 50, so abs(-50) >= 50 alerts.
select ok(
  public.check_media_cogs_variance(timezone('utc', now())::date - 1) >= 1,
  '5. variance check inserts at least one alert'
);

select ok(
  exists (
    select 1 from public.media_cogs_recon_alerts
    where kind = 'call_product_vs_analytics'
      and call_id = 'cc061000-0000-4061-8000-0000000000d1'
      and acknowledged_at is null
  ),
  '5b. call_product_vs_analytics alert open'
);

select ok(
  to_regclass('admin.media_cogs_open_alerts') is not null,
  '6. media_cogs_open_alerts view exists'
);

select ok(
  exists (
    select 1 from admin.media_cogs_open_alerts
    where call_id = 'cc061000-0000-4061-8000-0000000000d1'
  ),
  '6b. open alerts view surfaces the call alert'
);

select * from finish();
rollback;
