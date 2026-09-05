-- ===========================================================================
-- 061  Media COGS reconcile tighten — product meter, Analytics, invoice, alerts
-- ===========================================================================
-- Fixes the post-037 blind spot (calls.minutes_billed stays 0 while billing
-- lives on paid_sessions), lets product_estimate and agora_analytics coexist
-- per call, adds invoice-day import helper, and raises recon alerts on
-- day / call variance. Provider payouts remain on usage_debit only.

-- ---------------------------------------------------------------------------
-- 1. Dual-source per-call COGS: (call_id, source) primary key
-- ---------------------------------------------------------------------------
alter table public.media_channel_usage
  drop constraint media_channel_usage_pkey;

alter table public.media_channel_usage
  add constraint media_channel_usage_pkey primary key (call_id, source);

comment on table public.media_channel_usage is
  'Per-call media COGS by source. product_estimate = paid_sessions.minutes_billed '
  '× medium multipliers; agora_analytics = Call Inspector channel duration. '
  'Both may exist for the same call_id. Channel name = call_id. Not invoice truth.';

-- ---------------------------------------------------------------------------
-- 2. Config: variance alert thresholds
-- ---------------------------------------------------------------------------
update admin.config_active
set payload = payload
  || jsonb_build_object(
    'std_min_day_variance_alert_pct',
    coalesce((payload ->> 'std_min_day_variance_alert_pct')::numeric, 15),
    'product_vs_analytics_alert_pct',
    coalesce((payload ->> 'product_vs_analytics_alert_pct')::numeric, 50)
  ),
  updated_at = now()
where domain = 'media_cogs';

-- ---------------------------------------------------------------------------
-- 3. Refresh estimates from paid_sessions (authoritative product meter)
-- ---------------------------------------------------------------------------
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
  v_minutes integer;
begin
  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';

  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_fhd := coalesce((v_cfg ->> 'video_fhd_paise_per_conv_min')::integer, 148);
  v_tier := coalesce(v_cfg ->> 'default_video_tier', 'hd');

  for r in
    select
      c.id,
      c.medium::text as medium,
      c.media_backend,
      ps.minutes_billed as product_minutes
    from public.calls c
    inner join public.paid_sessions ps on ps.call_id = c.id
    where c.media_backend = 'agora'
      and c.status in ('ended', 'failed')
      and ps.minutes_billed > 0
      and coalesce(c.ended_at, ps.ended_at, c.created_at) >= p_since
  loop
    v_minutes := r.product_minutes;
    if r.medium = 'voice' then
      v_std := v_minutes * 2.0;
      v_paise_per_min := v_voice;
    elsif v_tier = 'fhd' then
      v_std := v_minutes * 18.0;
      v_paise_per_min := v_fhd;
    else
      v_std := v_minutes * 8.0;
      v_paise_per_min := v_hd;
    end if;
    v_cost := v_minutes * v_paise_per_min;
    v_inserted := false;

    insert into public.media_channel_usage (
      call_id, backend, medium, conversation_minutes,
      std_minutes_est, cost_paise_est, source
    ) values (
      r.id, r.media_backend, r.medium, v_minutes,
      v_std, v_cost, 'product_estimate'
    )
    on conflict (call_id, source) do update
      set medium = excluded.medium,
          conversation_minutes = excluded.conversation_minutes,
          std_minutes_est = excluded.std_minutes_est,
          cost_paise_est = excluded.cost_paise_est,
          refreshed_at = now()
    returning true into v_inserted;

    if coalesce(v_inserted, false) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.refresh_media_channel_usage_estimates(timestamptz) is
  'Writes/refreshes product_estimate rows from paid_sessions.minutes_billed '
  '(not calls.minutes_billed). Coexists with agora_analytics / manual sources.';

-- ---------------------------------------------------------------------------
-- 4. Upsert Agora Analytics per-channel duration (Call Inspector lists)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_media_channel_usage_analytics(
  p_call_id              uuid,
  p_duration_seconds     integer,
  p_participant_acu      numeric default 2,
  p_raw                  jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  c public.calls%rowtype;
  v_cfg jsonb;
  v_voice integer;
  v_hd integer;
  v_fhd integer;
  v_tier text;
  v_minutes integer;
  v_std numeric;
  v_cost integer;
  v_paise_per_min integer;
  v_acu numeric;
begin
  if p_call_id is null then
    raise exception 'call_id required' using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 then
    raise exception 'duration_seconds must be >= 0' using errcode = '22023';
  end if;

  select * into c from public.calls where id = p_call_id;
  if not found then
    raise exception 'call not found' using errcode = 'P0002';
  end if;
  if c.media_backend is distinct from 'agora' then
    raise exception 'call is not agora-backed' using errcode = 'P0001';
  end if;

  -- Started-minute product meter uses whole minutes; Analytics wall-clock
  -- rounds up so a 61s channel is 2 minutes of media presence.
  v_minutes := case
    when p_duration_seconds <= 0 then 0
    else greatest(1, ceil(p_duration_seconds::numeric / 60.0)::integer)
  end;

  v_acu := greatest(coalesce(p_participant_acu, 2), 1);

  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';
  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_fhd := coalesce((v_cfg ->> 'video_fhd_paise_per_conv_min')::integer, 148);
  v_tier := coalesce(v_cfg ->> 'default_video_tier', 'hd');

  -- Approximate std-min: conversation-minute multipliers × ACU/2 so a 1:1
  -- call matches product_estimate shape; >2 ACU scales COGS up.
  if c.medium::text = 'voice' then
    v_paise_per_min := v_voice;
    v_std := v_minutes * 2.0 * (v_acu / 2.0);
  elsif v_tier = 'fhd' then
    v_paise_per_min := v_fhd;
    v_std := v_minutes * 18.0 * (v_acu / 2.0);
  else
    v_paise_per_min := v_hd;
    v_std := v_minutes * 8.0 * (v_acu / 2.0);
  end if;
  v_cost := round(v_minutes * v_paise_per_min * (v_acu / 2.0))::integer;

  insert into public.media_channel_usage (
    call_id, backend, medium, conversation_minutes,
    std_minutes_est, cost_paise_est, source, raw
  ) values (
    p_call_id, c.media_backend, c.medium::text, v_minutes,
    v_std, v_cost, 'agora_analytics',
    coalesce(p_raw, '{}'::jsonb) || jsonb_build_object(
      'duration_seconds', p_duration_seconds,
      'participant_acu', v_acu
    )
  )
  on conflict (call_id, source) do update
    set medium = excluded.medium,
        conversation_minutes = excluded.conversation_minutes,
        std_minutes_est = excluded.std_minutes_est,
        cost_paise_est = excluded.cost_paise_est,
        raw = excluded.raw,
        refreshed_at = now();

  return p_call_id;
end;
$$;

comment on function public.upsert_media_channel_usage_analytics(uuid, integer, numeric, jsonb) is
  'Service-role upsert of agora_analytics COGS from Call Inspector duration. '
  'Does not overwrite product_estimate. Does not drive member/provider money.';

revoke all on function public.upsert_media_channel_usage_analytics(uuid, integer, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_media_channel_usage_analytics(uuid, integer, numeric, jsonb)
  to service_role;

-- Calls eligible for Analytics per-channel ingest (cname = call_id).
create or replace function public.list_agora_calls_for_analytics_ingest(
  p_from date,
  p_to date
) returns table (
  call_id uuid,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.id as call_id,
    coalesce(c.started_at, ps.started_at, c.created_at) as started_at,
    coalesce(c.ended_at, ps.ended_at, c.created_at) as ended_at
  from public.calls c
  inner join public.paid_sessions ps on ps.call_id = c.id
  where c.media_backend = 'agora'
    and c.status in ('ended', 'failed')
    and ps.minutes_billed > 0
    and coalesce(c.ended_at, ps.ended_at, c.created_at)::date
      between p_from and p_to
  order by coalesce(c.ended_at, ps.ended_at) desc
  limit 200;
$$;

comment on function public.list_agora_calls_for_analytics_ingest(date, date) is
  'Service-role list of Agora calls with product minutes for Call Inspector ingest.';

revoke all on function public.list_agora_calls_for_analytics_ingest(date, date)
  from public, anon, authenticated;
grant execute on function public.list_agora_calls_for_analytics_ingest(date, date)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Invoice CSV day import (money truth for vendor COGS)
-- ---------------------------------------------------------------------------
create or replace function public.import_media_invoice_days(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  r jsonb;
  v_count integer := 0;
  v_id uuid;
  v_project text;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_project := coalesce(r ->> 'project_id', '');
    if v_project = '' then
      raise exception 'project_id required on each row' using errcode = '22023';
    end if;
    if (r ->> 'usage_date') is null then
      raise exception 'usage_date required on each row' using errcode = '22023';
    end if;

    v_id := public.upsert_media_vendor_usage_daily(
      coalesce((r ->> 'backend')::public.call_media_backend, 'agora'),
      v_project,
      (r ->> 'usage_date')::date,
      coalesce((r ->> 'duration_audio_seconds')::bigint, 0),
      coalesce((r ->> 'duration_video_hd_seconds')::bigint, 0),
      coalesce((r ->> 'duration_video_hdp_seconds')::bigint, 0),
      coalesce((r ->> 'duration_video_1080p_seconds')::bigint, 0),
      coalesce((r ->> 'duration_video_2k_seconds')::bigint, 0),
      coalesce((r ->> 'duration_video_4k_seconds')::bigint, 0),
      'invoice_csv',
      coalesce(r -> 'raw', r),
      case
        when r ? 'cost_paise' then (r ->> 'cost_paise')::integer
        else null
      end
    );
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function public.import_media_invoice_days(jsonb) is
  'Service-role batch upsert of invoice_csv vendor day rows. Prefer cost_paise '
  'from the invoice; otherwise provisional list FX is applied. Money truth for COGS.';

revoke all on function public.import_media_invoice_days(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_media_invoice_days(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Recon alerts
-- ---------------------------------------------------------------------------
create table if not exists public.media_cogs_recon_alerts (
  id              uuid primary key default gen_random_uuid(),
  usage_date      date not null,
  kind            text not null
    check (kind in ('day_std_min_variance', 'call_product_vs_analytics')),
  call_id         uuid references public.calls(id) on delete cascade,
  variance_pct    numeric(10, 2),
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz
);

create unique index if not exists media_cogs_recon_alerts_day_kind
  on public.media_cogs_recon_alerts (usage_date, kind)
  where kind = 'day_std_min_variance';

create unique index if not exists media_cogs_recon_alerts_call_kind
  on public.media_cogs_recon_alerts (usage_date, kind, call_id)
  where kind = 'call_product_vs_analytics' and call_id is not null;

comment on table public.media_cogs_recon_alerts is
  'Open COGS reconciliation alerts. Never mutates member/provider money. '
  'Acknowledge in admin when investigated.';

alter table public.media_cogs_recon_alerts enable row level security;
revoke all on public.media_cogs_recon_alerts from public, anon, authenticated;

create or replace function public.check_media_cogs_variance(
  p_since date default (timezone('utc', now())::date - 7)
) returns integer
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_cfg jsonb;
  v_day_thr numeric;
  v_call_thr numeric;
  v_count integer := 0;
  d record;
  c record;
  v_pct numeric;
begin
  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';

  v_day_thr := coalesce((v_cfg ->> 'std_min_day_variance_alert_pct')::numeric, 15);
  v_call_thr := coalesce((v_cfg ->> 'product_vs_analytics_alert_pct')::numeric, 50);

  for d in
    select *
    from admin.daily_media_margin
    where usage_date >= p_since
      and std_min_variance_pct is not null
      and abs(std_min_variance_pct) >= v_day_thr
  loop
    insert into public.media_cogs_recon_alerts (
      usage_date, kind, variance_pct, detail
    ) values (
      d.usage_date,
      'day_std_min_variance',
      d.std_min_variance_pct,
      jsonb_build_object(
        'estimated_std_minutes', d.estimated_std_minutes,
        'vendor_std_minutes', d.vendor_std_minutes,
        'vendor_source', d.vendor_source,
        'threshold_pct', v_day_thr
      )
    )
    on conflict (usage_date, kind) where kind = 'day_std_min_variance'
    do update set
      variance_pct = excluded.variance_pct,
      detail = excluded.detail,
      created_at = now(),
      acknowledged_at = null;
    v_count := v_count + 1;
  end loop;

  for c in
    select
      ps.call_id,
      coalesce(ps.ended_at, ps.created_at)::date as usage_date,
      pe.conversation_minutes as product_minutes,
      aa.conversation_minutes as analytics_minutes
    from public.paid_sessions ps
    join public.media_channel_usage pe
      on pe.call_id = ps.call_id and pe.source = 'product_estimate'
    join public.media_channel_usage aa
      on aa.call_id = ps.call_id and aa.source = 'agora_analytics'
    where ps.call_id is not null
      and coalesce(ps.ended_at, ps.created_at)::date >= p_since
      and pe.conversation_minutes > 0
  loop
    v_pct := round(
      (c.product_minutes - c.analytics_minutes)::numeric
      / nullif(c.analytics_minutes, 0) * 100,
      1
    );
    if v_pct is null or abs(v_pct) < v_call_thr then
      continue;
    end if;

    insert into public.media_cogs_recon_alerts (
      usage_date, kind, call_id, variance_pct, detail
    ) values (
      c.usage_date,
      'call_product_vs_analytics',
      c.call_id,
      v_pct,
      jsonb_build_object(
        'product_minutes', c.product_minutes,
        'analytics_minutes', c.analytics_minutes,
        'threshold_pct', v_call_thr
      )
    )
    on conflict (usage_date, kind, call_id)
      where kind = 'call_product_vs_analytics' and call_id is not null
    do update set
      variance_pct = excluded.variance_pct,
      detail = excluded.detail,
      created_at = now(),
      acknowledged_at = null;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.check_media_cogs_variance(date) is
  'Inserts/refreshes media_cogs_recon_alerts for day std-min drift and '
  'per-call product vs Analytics minute drift. Thresholds from media_cogs config.';

revoke all on function public.check_media_cogs_variance(date)
  from public, anon, authenticated;
grant execute on function public.check_media_cogs_variance(date) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Margin views — product from paid_sessions; dual COGS sources
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE cannot rename view columns (42P16); drop first.
drop view if exists admin.media_cogs_open_alerts;
drop view if exists admin.daily_media_margin;
drop view if exists admin.call_margin;

create view admin.call_margin as
select
  c.id                                              as call_id,
  c.conversation_id,
  c.medium::text                                    as medium,
  c.media_backend,
  c.status::text                                    as call_status,
  ps.minutes_billed                                 as product_minutes,
  ps.tokens_debited                                 as member_tokens,
  ps.tokens_debited * 100                           as member_paise,
  ps.id                                             as session_id,
  e.provider_tokens,
  e.provider_tokens * 100                           as provider_paise,
  e.status                                          as earnings_status,
  e.hold_until,
  (ps.tokens_debited - coalesce(e.provider_tokens, 0)) as platform_take_tokens,
  (ps.tokens_debited - coalesce(e.provider_tokens, 0)) * 100 as platform_take_paise,
  pe.std_minutes_est                                as product_std_minutes_est,
  pe.cost_paise_est                                 as product_cogs_paise_est,
  aa.conversation_minutes                           as analytics_minutes,
  aa.std_minutes_est                                as analytics_std_minutes_est,
  aa.cost_paise_est                                 as analytics_cogs_paise_est,
  coalesce(aa.std_minutes_est, pe.std_minutes_est)  as agora_std_minutes_est,
  coalesce(aa.cost_paise_est, pe.cost_paise_est)    as agora_cost_paise_est,
  case
    when aa.call_id is not null then 'agora_analytics'
    when pe.call_id is not null then 'product_estimate'
    else null
  end                                               as cogs_source,
  (
    (ps.tokens_debited - coalesce(e.provider_tokens, 0)) * 100
    - coalesce(aa.cost_paise_est, pe.cost_paise_est, 0)
  )                                                 as margin_after_media_paise,
  coalesce(c.ended_at, ps.ended_at, c.created_at)::date as usage_date
from public.calls c
inner join public.paid_sessions ps on ps.call_id = c.id
left join public.provider_earnings_ledger e on e.session_id = ps.id
left join public.media_channel_usage pe
  on pe.call_id = c.id and pe.source = 'product_estimate'
left join public.media_channel_usage aa
  on aa.call_id = c.id and aa.source = 'agora_analytics'
where ps.minutes_billed > 0;

comment on view admin.call_margin is
  'Per-call reconciliation from paid_sessions (product truth). Prefer '
  'agora_analytics COGS when present, else product_estimate. Dual sources shown.';

create view admin.daily_media_margin as
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

create view admin.media_cogs_open_alerts as
select
  id,
  usage_date,
  kind,
  call_id,
  variance_pct,
  detail,
  created_at
from public.media_cogs_recon_alerts
where acknowledged_at is null
order by created_at desc;

comment on view admin.media_cogs_open_alerts is
  'Unacknowledged COGS reconciliation alerts for founder review.';

-- session_margin unchanged structurally; re-grant after call_margin drop chain.
revoke all on admin.call_margin, admin.daily_media_margin, admin.session_margin,
  admin.media_cogs_open_alerts
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. assert_call_inr_sync — paid_sessions product meter
-- ---------------------------------------------------------------------------
create or replace function public.assert_call_inr_sync(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  c          public.calls%rowtype;
  e          public.provider_earnings_ledger%rowtype;
  u          public.media_channel_usage%rowtype;
  v_ps       public.paid_sessions%rowtype;
  v_cfg      jsonb;
  v_has_e    boolean := false;
  v_has_u    boolean := false;
  v_voice    integer;
  v_hd       integer;
  v_cogs     integer;
  v_take     integer;
  v_minutes  integer;
  v_tokens   integer;
begin
  select * into c from public.calls where id = p_call_id;
  if not found then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  select * into v_ps from public.paid_sessions where call_id = p_call_id;
  if not found or v_ps.minutes_billed <= 0 then
    raise exception 'call has no billed paid_session minutes' using errcode = 'P0001';
  end if;

  v_minutes := v_ps.minutes_billed;
  v_tokens := v_ps.tokens_debited;

  select l.* into e
  from public.provider_earnings_ledger l
  where l.session_id = v_ps.id;
  v_has_e := found;

  if v_has_e then
    if e.gross_tokens <> e.minutes_billed * e.rate_per_min then
      raise exception 'gross_tokens != minutes_billed × rate_per_min'
        using errcode = 'P0001';
    end if;
    if e.provider_tokens <> (e.gross_tokens * v_ps.provider_share_percent) / 100 then
      raise exception 'provider_tokens != gross × provider_share_percent / 100'
        using errcode = 'P0001';
    end if;
  end if;

  select * into u
  from public.media_channel_usage
  where call_id = p_call_id and source = 'product_estimate';
  v_has_u := found;

  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';
  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_cogs := v_minutes * (
    case when c.medium = 'video' then v_hd else v_voice end
  );

  if v_has_u and u.cost_paise_est <> v_cogs then
    raise exception 'product_estimate COGS != minutes × media_cogs rate'
      using errcode = 'P0001';
  end if;
  if v_has_u and u.conversation_minutes <> v_minutes then
    raise exception 'product_estimate minutes != paid_sessions.minutes_billed'
      using errcode = 'P0001';
  end if;

  v_take := coalesce(e.gross_tokens, v_tokens) - coalesce(e.provider_tokens, 0);

  return jsonb_build_object(
    'call_id', p_call_id,
    'medium', c.medium,
    'product_minutes', v_minutes,
    'member_tokens', v_tokens,
    'member_paise', v_tokens * 100,
    'gross_tokens', e.gross_tokens,
    'provider_tokens', e.provider_tokens,
    'provider_paise', coalesce(e.provider_tokens, 0) * 100,
    'platform_take_tokens', v_take,
    'platform_take_paise', v_take * 100,
    'agora_cost_paise_est', coalesce(u.cost_paise_est, v_cogs),
    'margin_after_media_paise',
      v_take * 100 - coalesce(u.cost_paise_est, v_cogs),
    'earnings_status', e.status,
    'cogs_source', u.source,
    'inr_sync_ok', true
  );
end;
$$;

comment on function public.assert_call_inr_sync(uuid) is
  'Verifies earnings ledger arithmetic and product_estimate COGS against '
  'paid_sessions.minutes_billed. Raises on internal inconsistency. Not invoice truth.';

-- ---------------------------------------------------------------------------
-- 9. Cron: variance check after daily ingest window
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'media-cogs-variance-check') then
    perform cron.unschedule('media-cogs-variance-check');
  end if;
  -- 07:00 UTC — after agora-usage-ingest at 06:20.
  perform cron.schedule(
    'media-cogs-variance-check',
    '0 7 * * *',
    $cron$select public.check_media_cogs_variance()$cron$
  );
end
$$;
