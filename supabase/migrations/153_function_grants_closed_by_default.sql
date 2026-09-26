-- Functions are closed to clients by default, and the ones still open are the
-- ones a client is meant to reach.
--
-- 143 section 7 closed the class that let a member move money or approve their
-- own provider application: Supabase's default privileges grant EXECUTE on
-- every function created in public to anon and authenticated BY NAME, so a
-- migration that revoked from PUBLIC only left a server function callable by
-- any signed-in client.
-- https://supabase.com/docs/guides/database/postgres/roles#public-schema-and-function-privileges
--
-- This migration finishes that work in four parts:
--   1. it records the three revokes run live on 2026-09-25 that 143 did not
--      carry;
--   2. it closes what was still callable and had no business being;
--   3. it narrows get_active_config to the domains a client reads;
--   4. it stops the platform default from granting the next function.
-- 568 pins the exact set that stays callable, in both directions.
--
-- Every function closed here was checked for a caller that runs with the
-- client's rights before it was closed:
--   * the app's rpc() calls;
--   * RLS policies, and security_invoker views;
--   * CHECK constraints and column defaults;
--   * the bodies of every SECURITY INVOKER function, triggers included.
-- A SECURITY DEFINER caller runs as the owner and is unaffected.

-- ---------------------------------------------------------------------------
-- 1. The 2026-09-25 hotfix, recorded
-- ---------------------------------------------------------------------------
-- Run by hand against prod through `supabase db query --linked`, together with
-- 143's section 7, before this file existed. These three were not in 143:
--   * get_session_billing_snapshot (029) was granted to authenticated on
--     purpose, for session start, but every caller since 030 is a DEFINER
--     function. It reads the payouts domain.
--   * accrue_ended_paid_session (030) is a trigger function.
--   * purge_expired_reports (005) is moderate.mjs's, which holds the service
--     role.
-- No-ops where the hotfix already ran.
revoke execute on function public.get_session_billing_snapshot(text) from public, anon, authenticated;
revoke execute on function public.accrue_ended_paid_session() from public, anon, authenticated;
revoke execute on function public.purge_expired_reports() from public, anon, authenticated;
grant execute on function public.get_session_billing_snapshot(text) to service_role;
grant execute on function public.purge_expired_reports() to service_role;

-- ---------------------------------------------------------------------------
-- 2. What was still open with no client caller
-- ---------------------------------------------------------------------------
-- Trigger functions. Postgres refuses to run one outside a trigger, so these
-- grants gave nothing. They are also the functions no client should ever name.
-- Privilege on a trigger function is checked when CREATE TRIGGER runs, not
-- when the trigger fires, so an insert or update from a client still fires
-- every trigger it did before. 568 proves this with an invoker trigger that
-- runs as `authenticated`.
-- https://www.postgresql.org/docs/current/sql-createtrigger.html
-- Swept by return type rather than listed, so none is missed. An event
-- trigger function counts too: the hosted project installs rls_auto_enable
-- in public with PUBLIC's grant.
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
  end loop;
end;
$$;

-- Callable by a signed-in client, with no client caller and nothing that runs
-- with a client's rights using them:
--   * user_has_accepted_current_policies(uuid) answers for any account id.
--     pending_policy_acceptances() is the caller's own.
--   * provider_offers_channel(uuid, channel) is enforce_provider_channel's.
--     That trigger is a DEFINER, and so are start_call and
--     create_session_request.
--   * seed_conversation_openers(uuid) is v1 chat's. The v2 chat calls
--     insert_next_opener.
--   * call_minimum_minutes(), call_tokens_per_minute() and
--     message_edit_window() are constants read by DEFINER functions.
revoke execute on function public.user_has_accepted_current_policies(uuid) from public, anon, authenticated;
revoke execute on function public.provider_offers_channel(uuid, public.session_channel) from public, anon, authenticated;
revoke execute on function public.seed_conversation_openers(uuid) from public, anon, authenticated;
revoke execute on function public.call_minimum_minutes() from public, anon, authenticated;
revoke execute on function public.call_tokens_per_minute() from public, anon, authenticated;
revoke execute on function public.message_edit_window() from public, anon, authenticated;

-- Callable signed out, through PUBLIC's grant, and read by nothing a client
-- runs:
--   * is_valid_report_reason(text) is submit_report's, a DEFINER.
--   * seed_expertise_for(uuid, text) is 084's backfill.
-- The other PUBLIC helpers stay open. expertise_list_is_sane,
-- language_list_is_sane and voice_peaks_ok are CHECK constraints on rows a
-- client writes, and get_public_config is the signed-out config read.
revoke execute on function public.is_valid_report_reason(text) from public, anon, authenticated;
revoke execute on function public.seed_expertise_for(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_active_config reads only what a client reads
-- ---------------------------------------------------------------------------
-- 026 made this the signed-in config read, for ANY domain. That included
-- media_cogs, the vendor's per-minute cost and the alert margins, which no
-- client reads. It also included whatever domain is published next.
--
-- What is allowed:
--   * the five domains src/api/appConfig.ts reads signed in: economics,
--     recharge, wallet, thresholds and report_taxonomy;
--   * the four get_public_config already serves signed out;
--   * payouts, which get_session_billing_snapshot reads (the cadence, hold
--     days and minimum a provider is told anyway).
-- Every in-database reader, and both Edge Function readers (create-order and
-- generate-invoice, which read economics), asks for one of these. Anything else
-- is refused as get_public_config refuses it, and a server that needs another
-- domain reads admin.config_active with the service role.
create or replace function public.get_active_config(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, admin
as $$
begin
  if p_domain is null or p_domain not in (
    'economics', 'recharge', 'wallet', 'thresholds', 'report_taxonomy', 'payouts',
    'kill_switches', 'auth_ui', 'permissions', 'client_support'
  ) then
    raise exception 'Domain % is not readable here', p_domain
      using errcode = 'insufficient_privilege';
  end if;

  return (
    select payload
    from admin.config_active
    where domain = p_domain
      and environment = 'prod'
  );
end;
$$;

comment on function public.get_active_config(text) is
  'The active prod payload for a config domain a client or billing RPC reads, '
  'or null if none is published. Refuses every other domain (153). SECURITY '
  'DEFINER so authenticated can read the admin schema row.';

-- ---------------------------------------------------------------------------
-- 4. The next function starts closed
-- ---------------------------------------------------------------------------
-- Removes the platform's by-name grant to anon and authenticated for
-- functions this role creates in public from now on. service_role keeps its
-- grant.
--
-- PUBLIC's grant is Postgres's own global default, and a per-schema default
-- cannot take it away:
-- https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
-- So the repo's rule stands: revoke from PUBLIC, and grant execute to
-- authenticated for a client RPC. What changes is that a function which
-- revokes from PUBLIC and grants nothing is now closed, instead of open to
-- every client. Existing functions keep their ACLs. `create or replace`
-- keeps an ACL, but a drop-and-create starts from this default, so a client
-- RPC re-created that way needs its grant restated. 568 fails if it is
-- missing.
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
