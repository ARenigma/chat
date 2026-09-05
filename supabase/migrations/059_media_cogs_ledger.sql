-- ===========================================================================
-- 059  Agora usage ingest + COGS / margin reconciliation
-- ===========================================================================
-- Two meters must not be conflated (see call-media economics review):
--   • Product metering — paid_sessions / calls minutes_billed → member tokens
--     and provider_earnings_ledger (already live).
--   • Vendor COGS metering — what Agora bills. Console REST /dev/v3/usage is
--     project-day aggregates (money-adjacent reference). Analytics is NOT
--     invoice truth. Per-call channel name = calls.id (call-media-token room).
--
-- This migration stores:
--   1. media_vendor_usage_daily — Console (or CSV) project-day SKU seconds.
--   2. media_channel_usage — per call_id estimates (and optional analytics).
--   3. admin.call_margin / admin.daily_media_margin — join product ↔ estimate
--      ↔ vendor day totals.
-- Provisional INR rates live in admin.config domain media_cogs until invoice
-- contract rates replace them.

-- ---------------------------------------------------------------------------
-- 1. Config domain: provisional Agora ₹ rates (paise per 1:1 conversation-min)
-- ---------------------------------------------------------------------------
-- Defaults from public list at ₹83/USD (2026-09):
--   voice 2 std-min → $0.00198 → ₹0.16 → 16 paise
--   HD    8 std-min → $0.00792 → ₹0.66 → 66 paise
--   FHD  18 std-min → $0.01782 → ₹1.48 → 148 paise
-- Video calls without a known resolution use HD.

insert into admin.config_domains (key, description)
values (
  'media_cogs',
  'Provisional Agora media COGS rates (paise). Replace with invoice rates.'
)
on conflict (key) do nothing;

do $$
declare
  v_payload jsonb := '{
    "usd_inr_fx": 83,
    "agora_usd_per_1000_std_min": 0.99,
    "agora_usd_cents_per_1000_std_min": 99,
    "voice_paise_per_conv_min": 16,
    "video_hd_paise_per_conv_min": 66,
    "video_fhd_paise_per_conv_min": 148,
    "default_video_tier": "hd"
  }';
  v_env text;
  v_id uuid;
  v_sha text;
begin
  v_sha := encode(sha256(v_payload::text::bytea), 'hex');

  foreach v_env in array array['staging', 'prod'] loop
    if exists (
      select 1 from admin.config_active
      where domain = 'media_cogs' and environment = v_env
    ) then
      continue;
    end if;

    v_id := gen_random_uuid();

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'media_cogs', v_env, 1, 'active',
       v_payload, v_sha, now(),
       'migration_059', 'migration_059', now(),
       'Initial provisional Agora COGS rates');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('media_cogs', v_env, v_id, v_payload, now(), now());

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', 'media_cogs', v_id, 'migration_059',
       'Initial media_cogs seed for ' || v_env);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Vendor day totals (Console / invoice CSV)
-- ---------------------------------------------------------------------------

create table public.media_vendor_usage_daily (
  id                         uuid        primary key default gen_random_uuid(),
  backend                    public.call_media_backend not null default 'agora',
  project_id                 text        not null,
  usage_date                 date        not null,
  duration_audio_seconds     bigint      not null default 0 check (duration_audio_seconds >= 0),
  duration_video_hd_seconds  bigint      not null default 0 check (duration_video_hd_seconds >= 0),
  duration_video_hdp_seconds bigint      not null default 0 check (duration_video_hdp_seconds >= 0),
  duration_video_1080p_seconds bigint    not null default 0 check (duration_video_1080p_seconds >= 0),
  duration_video_2k_seconds  bigint      not null default 0 check (duration_video_2k_seconds >= 0),
  duration_video_4k_seconds  bigint      not null default 0 check (duration_video_4k_seconds >= 0),
  -- Estimated std-minutes from SKU weights (Agora billing multipliers).
  std_minutes_est            numeric(14, 4) not null default 0,
  -- Cost at provisional list rate; invoice CSV may overwrite with source=invoice.
  cost_paise_est             integer     not null default 0,
  source                     text        not null
    check (source in ('agora_console_api', 'invoice_csv', 'manual')),
  raw                        jsonb,
  ingested_at                timestamptz not null default now(),
  unique (backend, project_id, usage_date, source)
);

comment on table public.media_vendor_usage_daily is
  'Project-day Agora (or future vendor) usage. Console REST is reference; '
  'invoice_csv is money truth when available. Not per-channel. '
  'https://docs.agora.io/en/video-calling/channel-management-api/agora-console-rest-api';

alter table public.media_vendor_usage_daily enable row level security;
revoke all on public.media_vendor_usage_daily from public, anon, authenticated;

create or replace function public.upsert_media_vendor_usage_daily(
  p_backend                      public.call_media_backend,
  p_project_id                   text,
  p_usage_date                   date,
  p_duration_audio_seconds       bigint,
  p_duration_video_hd_seconds    bigint,
  p_duration_video_hdp_seconds   bigint,
  p_duration_video_1080p_seconds bigint,
  p_duration_video_2k_seconds    bigint,
  p_duration_video_4k_seconds    bigint,
  p_source                       text,
  p_raw                          jsonb default null,
  p_cost_paise_override          integer default null
) returns uuid
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_cfg jsonb;
  v_usd_per_1k numeric;
  v_fx numeric;
  v_std numeric;
  v_cost integer;
  v_id uuid;
begin
  if p_project_id is null or length(p_project_id) = 0 then
    raise exception 'project_id required' using errcode = '22023';
  end if;
  if p_source not in ('agora_console_api', 'invoice_csv', 'manual') then
    raise exception 'invalid source' using errcode = '22023';
  end if;

  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';

  v_usd_per_1k := coalesce(
    (v_cfg ->> 'agora_usd_per_1000_std_min')::numeric,
    (v_cfg ->> 'agora_usd_cents_per_1000_std_min')::numeric / 100.0,
    0.99
  );
  v_fx := coalesce((v_cfg ->> 'usd_inr_fx')::numeric, 83);

  -- Agora std-minute weights: audio 1×, HD/HDP 4×, 1080p 9×, 2K 16×, 4K 36×
  -- (participant-seconds → std-minutes).
  v_std := (
      coalesce(p_duration_audio_seconds, 0)
    + 4 * coalesce(p_duration_video_hd_seconds, 0)
    + 4 * coalesce(p_duration_video_hdp_seconds, 0)
    + 9 * coalesce(p_duration_video_1080p_seconds, 0)
    + 16 * coalesce(p_duration_video_2k_seconds, 0)
    + 36 * coalesce(p_duration_video_4k_seconds, 0)
  )::numeric / 60.0;

  v_cost := coalesce(
    p_cost_paise_override,
    round(v_std * (v_usd_per_1k / 1000.0) * v_fx * 100)::integer
  );

  insert into public.media_vendor_usage_daily (
    backend, project_id, usage_date,
    duration_audio_seconds, duration_video_hd_seconds,
    duration_video_hdp_seconds, duration_video_1080p_seconds,
    duration_video_2k_seconds, duration_video_4k_seconds,
    std_minutes_est, cost_paise_est, source, raw
  ) values (
    p_backend, p_project_id, p_usage_date,
    coalesce(p_duration_audio_seconds, 0),
    coalesce(p_duration_video_hd_seconds, 0),
    coalesce(p_duration_video_hdp_seconds, 0),
    coalesce(p_duration_video_1080p_seconds, 0),
    coalesce(p_duration_video_2k_seconds, 0),
    coalesce(p_duration_video_4k_seconds, 0),
    v_std, v_cost, p_source, p_raw
  )
  on conflict (backend, project_id, usage_date, source) do update
    set duration_audio_seconds = excluded.duration_audio_seconds,
        duration_video_hd_seconds = excluded.duration_video_hd_seconds,
        duration_video_hdp_seconds = excluded.duration_video_hdp_seconds,
        duration_video_1080p_seconds = excluded.duration_video_1080p_seconds,
        duration_video_2k_seconds = excluded.duration_video_2k_seconds,
        duration_video_4k_seconds = excluded.duration_video_4k_seconds,
        std_minutes_est = excluded.std_minutes_est,
        cost_paise_est = excluded.cost_paise_est,
        raw = excluded.raw,
        ingested_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.upsert_media_vendor_usage_daily(
  public.call_media_backend, text, date, bigint, bigint, bigint, bigint, bigint, bigint, text, jsonb, integer
) is
  'Service-role upsert of a project-day vendor usage row. Computes std-minutes '
  'and provisional cost_paise unless p_cost_paise_override is set (invoice).';

revoke all on function public.upsert_media_vendor_usage_daily(
  public.call_media_backend, text, date, bigint, bigint, bigint, bigint, bigint, bigint, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.upsert_media_vendor_usage_daily(
  public.call_media_backend, text, date, bigint, bigint, bigint, bigint, bigint, bigint, text, jsonb, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Per-channel (call_id) usage — estimates + optional analytics import
-- ---------------------------------------------------------------------------

create table public.media_channel_usage (
  call_id              uuid        primary key references public.calls(id) on delete cascade,
  backend              public.call_media_backend not null,
  medium               text        not null check (medium in ('voice', 'video')),
  conversation_minutes integer     not null check (conversation_minutes >= 0),
  -- 1:1 Agora: voice = 2 std-min / conv-min; HD = 8; FHD = 18.
  std_minutes_est      numeric(14, 4) not null,
  cost_paise_est       integer     not null,
  source               text        not null
    check (source in ('product_estimate', 'agora_analytics', 'manual')),
  raw                  jsonb,
  refreshed_at         timestamptz not null default now()
);

comment on table public.media_channel_usage is
  'Per-call media COGS. Channel name in Agora = call_id. product_estimate is '
  'derived from calls.minutes_billed × medium; replace with analytics/invoice '
  'when available. Not invoice truth by itself.';

comment on column public.media_channel_usage.call_id is
  'Equals the Agora channel name minted by call-media-token (room = call.id).';

alter table public.media_channel_usage enable row level security;
revoke all on public.media_channel_usage from public, anon, authenticated;

create index media_channel_usage_refreshed
  on public.media_channel_usage (refreshed_at desc);

-- Refresh estimates for ended agora calls that have product minutes.
-- Never overwrites agora_analytics / manual rows.
create or replace function public.refresh_media_channel_usage_estimates(
  p_since timestamptz default now() - interval '2 days'
) returns integer
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_cfg jsonb;
  v_voice integer;
  v_hd integer;
  v_fhd integer;
  v_tier text;
  v_count integer := 0;
  r record;
  v_std numeric;
  v_cost integer;
  v_paise_per_min integer;
  v_inserted boolean;
begin
  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';

  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_fhd := coalesce((v_cfg ->> 'video_fhd_paise_per_conv_min')::integer, 148);
  v_tier := coalesce(v_cfg ->> 'default_video_tier', 'hd');

  for r in
    select c.id, c.medium::text as medium, c.minutes_billed, c.media_backend
    from public.calls c
    where c.media_backend = 'agora'
      and c.status in ('ended', 'failed')
      and c.minutes_billed > 0
      and coalesce(c.ended_at, c.created_at) >= p_since
  loop
    if r.medium = 'voice' then
      v_std := r.minutes_billed * 2.0;
      v_paise_per_min := v_voice;
    elsif v_tier = 'fhd' then
      v_std := r.minutes_billed * 18.0;
      v_paise_per_min := v_fhd;
    else
      v_std := r.minutes_billed * 8.0;
      v_paise_per_min := v_hd;
    end if;
    v_cost := r.minutes_billed * v_paise_per_min;
    v_inserted := false;

    insert into public.media_channel_usage (
      call_id, backend, medium, conversation_minutes,
      std_minutes_est, cost_paise_est, source
    ) values (
      r.id, r.media_backend, r.medium, r.minutes_billed,
      v_std, v_cost, 'product_estimate'
    )
    on conflict (call_id) do update
      set medium = excluded.medium,
          conversation_minutes = excluded.conversation_minutes,
          std_minutes_est = excluded.std_minutes_est,
          cost_paise_est = excluded.cost_paise_est,
          refreshed_at = now()
      where media_channel_usage.source = 'product_estimate'
    returning true into v_inserted;

    if coalesce(v_inserted, false) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.refresh_media_channel_usage_estimates(timestamptz) is
  'Writes/refreshes product_estimate COGS rows for recent ended Agora calls. '
  'Channel key = call_id. Skips rows already sourced from analytics/manual.';

revoke all on function public.refresh_media_channel_usage_estimates(timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_media_channel_usage_estimates(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Margin views (admin schema — service-role / founder console)
-- ---------------------------------------------------------------------------

create or replace view admin.call_margin as
select
  c.id                                              as call_id,
  c.conversation_id,
  c.medium::text                                    as medium,
  c.media_backend,
  c.status::text                                    as call_status,
  c.minutes_billed                                  as product_minutes,
  c.tokens_debited                                  as member_tokens,
  c.tokens_debited * 100                            as member_paise,
  ps.id                                             as session_id,
  e.provider_tokens,
  e.provider_tokens * 100                           as provider_paise,
  e.status                                          as earnings_status,
  e.hold_until,
  (c.tokens_debited - coalesce(e.provider_tokens, 0)) as platform_take_tokens,
  (c.tokens_debited - coalesce(e.provider_tokens, 0)) * 100 as platform_take_paise,
  u.std_minutes_est                                 as agora_std_minutes_est,
  u.cost_paise_est                                  as agora_cost_paise_est,
  u.source                                          as cogs_source,
  (
    (c.tokens_debited - coalesce(e.provider_tokens, 0)) * 100
    - coalesce(u.cost_paise_est, 0)
  )                                                 as margin_after_media_paise,
  coalesce(c.ended_at, c.created_at)::date          as usage_date
from public.calls c
left join public.paid_sessions ps on ps.call_id = c.id
left join public.provider_earnings_ledger e on e.session_id = ps.id
left join public.media_channel_usage u on u.call_id = c.id
where c.minutes_billed > 0;

comment on view admin.call_margin is
  'Per-call reconciliation: member tokens ↔ provider accrual ↔ estimated Agora '
  'COGS. margin_after_media_paise = platform take − estimated media cost. '
  'Vendor day totals live in admin.daily_media_margin.';

create or replace view admin.daily_media_margin as
with call_day as (
  select
    usage_date,
    count(*)::integer                               as calls,
    sum(product_minutes)::integer                   as product_minutes,
    sum(member_paise)::bigint                       as member_paise,
    sum(coalesce(provider_paise, 0))::bigint        as provider_paise,
    sum(platform_take_paise)::bigint                as platform_take_paise,
    sum(coalesce(agora_std_minutes_est, 0))         as estimated_std_minutes,
    sum(coalesce(agora_cost_paise_est, 0))::bigint  as estimated_cogs_paise
  from admin.call_margin
  group by usage_date
),
vendor_day as (
  -- Prefer invoice_csv over console over manual when multiple sources exist.
  select distinct on (usage_date)
    usage_date,
    source                                          as vendor_source,
    std_minutes_est                                 as vendor_std_minutes,
    cost_paise_est                                  as vendor_cogs_paise
  from public.media_vendor_usage_daily
  where backend = 'agora'
  order by usage_date,
    case source
      when 'invoice_csv' then 1
      when 'agora_console_api' then 2
      else 3
    end
)
select
  coalesce(c.usage_date, v.usage_date)              as usage_date,
  coalesce(c.calls, 0)                              as calls,
  coalesce(c.product_minutes, 0)                    as product_minutes,
  coalesce(c.member_paise, 0)                       as member_paise,
  coalesce(c.provider_paise, 0)                     as provider_paise,
  coalesce(c.platform_take_paise, 0)                as platform_take_paise,
  coalesce(c.estimated_std_minutes, 0)              as estimated_std_minutes,
  coalesce(c.estimated_cogs_paise, 0)               as estimated_cogs_paise,
  v.vendor_source,
  v.vendor_std_minutes,
  v.vendor_cogs_paise,
  coalesce(c.platform_take_paise, 0)
    - coalesce(v.vendor_cogs_paise, c.estimated_cogs_paise, 0)
                                                    as margin_after_media_paise,
  case
    when v.vendor_std_minutes is null then null
    when coalesce(c.estimated_std_minutes, 0) = 0 then null
    else round(
      (c.estimated_std_minutes - v.vendor_std_minutes)
      / nullif(v.vendor_std_minutes, 0) * 100, 1
    )
  end                                               as std_min_variance_pct
from call_day c
full outer join vendor_day v using (usage_date);

comment on view admin.daily_media_margin is
  'Day rollup: product take vs estimated per-call COGS vs vendor day bill. '
  'std_min_variance_pct flags product≪≫vendor minute drift.';

create or replace view admin.session_margin as
select
  ps.id                                             as session_id,
  ps.conversation_id,
  ps.channel::text                                  as channel,
  ps.call_id,
  ps.minutes_billed                                 as product_minutes,
  ps.rate_tokens_per_min,
  (ps.minutes_billed * ps.rate_tokens_per_min)       as member_tokens_est,
  e.gross_tokens,
  e.provider_tokens,
  e.status                                          as earnings_status,
  e.hold_until,
  (coalesce(e.gross_tokens, ps.minutes_billed * ps.rate_tokens_per_min)
    - coalesce(e.provider_tokens, 0))               as platform_take_tokens,
  u.cost_paise_est                                  as agora_cost_paise_est,
  u.source                                          as cogs_source,
  (
    (coalesce(e.gross_tokens, ps.minutes_billed * ps.rate_tokens_per_min)
      - coalesce(e.provider_tokens, 0)) * 100
    - coalesce(u.cost_paise_est, 0)
  )                                                 as margin_after_media_paise,
  ps.ended_at,
  ps.created_at
from public.paid_sessions ps
left join public.provider_earnings_ledger e on e.session_id = ps.id
left join public.media_channel_usage u on u.call_id = ps.call_id
where ps.minutes_billed > 0;

comment on view admin.session_margin is
  'Per paid_session margin. Chat has null Agora COGS; audio/video join '
  'media_channel_usage on call_id when present.';

revoke all on admin.call_margin, admin.daily_media_margin, admin.session_margin
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cron: channel estimates + optional Agora Console ingest dispatch
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping media COGS schedules';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'media-channel-usage-estimates') then
    perform cron.unschedule('media-channel-usage-estimates');
  end if;

  perform cron.schedule(
    'media-channel-usage-estimates',
    '15 * * * *',
    $cron$select public.refresh_media_channel_usage_estimates()$cron$
  );
end
$$;

-- Optional HTTP dispatch to agora-usage-ingest when vault secrets are set
-- (same pattern as dispatch_pending_pushes). Quiet no-op if unset.
create or replace function public.dispatch_agora_usage_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'agora_usage_ingest_url';
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'agora_usage_ingest_key';

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.dispatch_agora_usage_ingest() is
  'Daily cron hook: POST agora-usage-ingest when vault secrets '
  'agora_usage_ingest_url / agora_usage_ingest_key are set.';

revoke all on function public.dispatch_agora_usage_ingest()
  from public, anon, authenticated;
grant execute on function public.dispatch_agora_usage_ingest() to service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'agora-usage-ingest') then
    perform cron.unschedule('agora-usage-ingest');
  end if;
  -- 06:20 UTC daily — Console usage for the prior UTC day is usually settled.
  perform cron.schedule(
    'agora-usage-ingest',
    '20 6 * * *',
    $cron$select public.dispatch_agora_usage_ingest()$cron$
  );
end
$$;
