-- ---------------------------------------------------------------------------
-- 035 — Public config RPC and runtime wiring
-- ---------------------------------------------------------------------------
-- Adds get_public_config(domain) accessible to the anon role so pre-auth
-- mobile screens (kill_switches, auth_ui) can read safe flags before a user
-- signs in. Sensitive billing/economics domains remain authenticated-only.
--
-- Safe domains for anon access: kill_switches, auth_ui
-- Authenticated-only: economics, recharge, wallet, thresholds, payouts,
--                     report_taxonomy
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. get_public_config — anon-accessible, allowlisted domains only
-- ---------------------------------------------------------------------------
create or replace function public.get_public_config(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, admin
as $$
declare
  v_payload jsonb;
begin
  -- Only expose domains that are safe for unauthenticated callers.
  if p_domain not in ('kill_switches', 'auth_ui') then
    raise exception 'Domain % is not publicly accessible', p_domain
      using errcode = 'insufficient_privilege';
  end if;

  select payload into v_payload
  from admin.config_active
  where domain      = p_domain
    and environment = 'prod';

  return v_payload;
end;
$$;

comment on function public.get_public_config(text) is
  'Publicly accessible config accessor for safe-to-expose domains '
  '(kill_switches, auth_ui). All other domains require authentication '
  'via get_active_config(). SECURITY DEFINER so anon role can read '
  'admin schema rows for pre-auth mobile screens.';

-- Grant to both anon and authenticated.
grant execute on function public.get_public_config(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Report taxonomy validation in report submission
-- ---------------------------------------------------------------------------
-- Update the guard used by the report RPC (if exists) to validate against
-- the active report_taxonomy config rather than a hardcoded enum list.
-- Only applies if the reports table / RPC exists from earlier migrations.
-- ---------------------------------------------------------------------------

-- Helper: check if a report reason is currently allowed by config.
create or replace function public.is_valid_report_reason(p_reason text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, admin
as $$
declare
  v_config jsonb;
  v_reasons jsonb;
begin
  v_config := public.get_active_config('report_taxonomy');
  if v_config is null then
    -- No config published yet — accept any non-empty reason.
    return p_reason is not null and length(trim(p_reason)) > 0;
  end if;

  v_reasons := v_config -> 'reasons';
  return v_reasons is not null and (v_reasons ? p_reason);
end;
$$;

comment on function public.is_valid_report_reason(text) is
  'Returns true if the reason slug is present in the active '
  'report_taxonomy config. Falls back to non-empty check when no config '
  'is published. Used by safety report RPCs.';

grant execute on function public.is_valid_report_reason(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Config freshness view — visible to service_role for admin dashboard
-- ---------------------------------------------------------------------------
create or replace view admin.config_freshness as
select
  d.key                        as domain,
  d.description,
  ca.version_id                is not null     as has_active,
  cv.version_number,
  cv.published_at,
  cv.published_by,
  extract(epoch from (now() - cv.published_at)) / 3600 as hours_since_publish
from admin.config_domains d
left join admin.config_active ca
       on ca.domain = d.key and ca.environment = 'prod'
left join admin.config_versions cv
       on cv.id = ca.version_id;

comment on view admin.config_freshness is
  'Shows every config domain with its active version, publish time, '
  'and age in hours. Used by the admin dashboard config health indicator.';

grant select on admin.config_freshness to service_role;
