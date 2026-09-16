-- ===========================================================================
-- 109  The call rate limit is runtime config, and a wedged call row expires
-- ===========================================================================
-- Two defects that present as the same symptom during testing: "I cannot call
-- anyone any more." One is the rate limit, one is not, and telling them apart
-- from the device is impossible because both refuse before the phone rings.
--
-- ---------------------------------------------------------------------------
-- 1. RATE_LIMITED was a literal, so raising it needed a migration
-- ---------------------------------------------------------------------------
-- `start_call` (099, the live definition) counts every `calls` row this user
-- created as caller in the last rolling hour and refuses at 10, with the 10
-- written into the function body. The count is over ATTEMPTS, so a declined
-- ring and a twenty-minute call cost the same. Two testers ringing each other
-- exhaust the hour in minutes and are then locked out for sixty with nothing
-- anyone can do about it short of shipping SQL.
--
-- The guard is NOT removed. It becomes runtime configurable, which is what the
-- repo already does for the message limit: `send_message` (077:274-289) reads
-- `get_active_config('thresholds')->>'rate_limit_messages_per_min'` with a
-- coalesce fallback, so an admin can raise it for a test window and put it back
-- without a release. The fallback is the floor: with no published config the
-- old 10/hour still applies, so this cannot fail open.
--
-- The new key is `rate_limit_calls_per_hour`, named after the existing one. It
-- needs a matching entry in `admin/lib/config-registry.ts` (runtime: 'live')
-- before it is editable from the admin UI; until then it reads as 10.
--
-- ---------------------------------------------------------------------------
-- 2. An abandoned call row locked a user out of calling ANYONE, forever
-- ---------------------------------------------------------------------------
-- 011's `meter_active_calls` swept two things: a ring nobody answered, and an
-- ACTIVE call whose `last_seen_at` had gone quiet for 90 seconds (status
-- 'ended', end_reason 'dropped'). 037 replaced the whole function to move
-- billing onto `meter_active_sessions`, kept the ring expiry, and dropped the
-- abandoned-call branch with the billing it was tangled up in. No later
-- migration restored it.
--
-- So a crash, a force-stop or a dead battery mid-call leaves `calls.status`
-- at 'active' with nothing in the system that will ever move it. `start_call`'s
-- cross-conversation BUSY branch (099:161-174) then refuses every call that
-- user places to anyone, indefinitely. During testing this reads exactly like
-- the rate limit above, which is why both are in one migration.
--
-- The paid_sessions half of that same BUSY branch already self-heals:
-- `meter_active_sessions` ends a session whose leases went quiet
-- ('disconnect_grace') and a 'pending_leases' session older than 15 minutes.
-- The `calls` row was the only one with no sweeper.
--
-- 'dropped' is already in the `calls.end_reason` CHECK (011:716-719, unchanged
-- since: no later migration touches that constraint), so this writes a value
-- the table accepts. Checked because 089 was this exact class of bug.
--
-- What is deliberately NOT restored: 011's per-row `settle_call` loop and its
-- block/suspend re-checks. Billing moved to the session meter in 037 and
-- belongs there. This is a liveness sweep on a signalling row, nothing else.

-- No explicit BEGIN/COMMIT: the Supabase CLI wraps each file in its own
-- transaction, and a COMMIT inside closes it early.

-- ── 1. start_call: 099 verbatim, with the rate limit read from config ───────
create or replace function public.start_call(
  p_conversation_id uuid,
  p_medium public.call_medium
)
returns json
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_uid              uuid := auth.uid();
  v_member           uuid;
  v_provider         uuid;
  v_other            uuid;
  v_suspended        timestamptz;
  v_recent           integer;
  v_rate_limit       integer;
  v_request          uuid;
  v_call             public.calls%rowtype;
  v_controls         jsonb;
  v_enabled          boolean;
  v_upgrade_session  public.paid_sessions%rowtype;
  v_upgrade_minutes  integer;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select payload into v_controls
  from admin.config_active
  where domain = 'kill_switches'
    and environment = 'prod';

  v_enabled := coalesce(
    case p_medium
      when 'voice' then (v_controls ->> 'voice_calls_enabled')::boolean
      when 'video' then (v_controls ->> 'video_calls_enabled')::boolean
    end,
    (v_controls ->> 'calls_enabled')::boolean,
    true
  );

  if not v_enabled then
    return json_build_object(
      'success', false,
      'error', case p_medium
        when 'voice' then 'VOICE_CALLS_DISABLED'
        else 'VIDEO_CALLS_DISABLED'
      end
    );
  end if;

  select member_id, provider_id
  into v_member, v_provider
  from public.conversations
  where id = p_conversation_id;

  if not found then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid not in (v_member, v_provider) then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  v_other := case when v_uid = v_member then v_provider else v_member end;

  select suspended_until into v_suspended
  from public.profiles
  where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- The only change from 099. Same shape as send_message's message limit: the
  -- coalesce fallback is the floor, so an unpublished config still enforces 10.
  v_rate_limit := coalesce(
    (public.get_active_config('thresholds')->>'rate_limit_calls_per_hour')::integer,
    10
  );

  select count(*)::integer into v_recent
  from public.calls
  where caller_id = v_uid
    and created_at > now() - interval '1 hour';
  if v_recent >= v_rate_limit then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  -- Same-conversation ringing/active call is an upgrade, not BUSY.
  if exists (
    select 1 from public.calls
    where status in ('ringing', 'active')
      and conversation_id <> p_conversation_id
      and (caller_id in (v_uid, v_other) or callee_id in (v_uid, v_other))
  ) or exists (
    select 1 from public.paid_sessions
    where channel in ('audio', 'video')
      and status in ('pending_leases', 'active', 'warning', 'grace')
      and (member_id in (v_uid, v_other) or provider_id in (v_uid, v_other))
      and conversation_id <> p_conversation_id
  ) then
    return json_build_object('success', false, 'error', 'BUSY');
  end if;

  -- End this conversation's live call row so the new insert is not a second live call.
  update public.calls
  set    status     = case when status = 'ringing' then 'missed'::public.call_status else 'ended'::public.call_status end,
         ended_at   = now(),
         end_reason = 'hangup'
  where  conversation_id = p_conversation_id
    and  status in ('ringing', 'active');

  update public.session_requests
  set    status       = 'cancelled',
         responded_at = now()
  where  conversation_id = p_conversation_id
    and  channel = 'chat'
    and  status = 'pending';

  select * into v_upgrade_session
  from public.paid_sessions
  where conversation_id = p_conversation_id
    and status in ('pending_leases', 'active', 'warning', 'grace')
    -- AUDIO -> VIDEO ONLY. The chat upgrade moved to claim_session_lease on
    -- 2026-09-13; see 099's header. This branch stays because with per-channel
    -- uniqueness 'audio' and 'video' are now distinct channels, so without it
    -- BOTH would be live and both would bill.
    and channel = 'audio'
    and p_medium = 'video'
  for update skip locked
  limit 1;

  if found then
    v_upgrade_minutes := case
      when v_upgrade_session.started_at is null then 0
      else greatest(
        0,
        floor(extract(epoch from (now() - v_upgrade_session.started_at)) / 60)::integer
      )
    end;

    -- Keep the transcript. Upgrade is a billing handoff, not end_session purge.

    update public.paid_sessions
    set    status     = 'ended',
           ended_at   = now(),
           end_reason = 'upgraded_to_call'
    where  id = v_upgrade_session.id;

    delete from public.session_leases where session_id = v_upgrade_session.id;

    if v_upgrade_minutes > 0 and v_upgrade_session.rate_tokens_per_min is not null then
      perform public.record_provider_accrual(
        v_upgrade_session.provider_id,
        v_upgrade_session.id,
        v_upgrade_minutes,
        v_upgrade_session.rate_tokens_per_min,
        v_upgrade_session.provider_share_percent,
        v_upgrade_session.payout_hold_days,
        v_upgrade_session.economics_config_version_id
      );
    end if;

    insert into public.conversation_thread_meta (
      conversation_id, last_session_at, last_session_channel,
      last_session_duration_seconds, last_preview_kind, updated_at
    ) values (
      p_conversation_id, now(), v_upgrade_session.channel,
      v_upgrade_minutes * 60,
      case v_upgrade_session.channel when 'chat' then 'session' else 'call' end,
      now()
    )
    on conflict (conversation_id) do update
      set last_session_at               = excluded.last_session_at,
          last_session_channel          = excluded.last_session_channel,
          last_session_duration_seconds = excluded.last_session_duration_seconds,
          last_preview_kind             = excluded.last_preview_kind,
          updated_at                    = excluded.updated_at;
  end if;

  begin
    v_request := public.create_session_request(
      p_conversation_id,
      case p_medium
        when 'voice' then 'audio'::public.session_channel
        else 'video'::public.session_channel
      end
    );
  exception
    when sqlstate 'P0003' then
      return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    when sqlstate 'P0005' then
      return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
    when sqlstate 'P0009' then
      return json_build_object('success', false, 'error', 'CHANNEL_DISABLED_BY_PROVIDER');
    when others then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
  end;

  insert into public.calls (
    conversation_id, caller_id, callee_id, medium, session_request_id
  ) values (
    p_conversation_id, v_uid, v_other, p_medium, v_request
  )
  returning * into v_call;

  return json_build_object(
    'success', true,
    'call_id', v_call.id,
    'session_request_id', v_request,
    'medium', v_call.medium,
    'media_backend', v_call.media_backend
  );
end;
$$;

revoke all on function public.start_call(uuid, public.call_medium)
  from public, anon, authenticated;
grant execute on function public.start_call(uuid, public.call_medium)
  to authenticated;

comment on function public.start_call(uuid, public.call_medium) is
  '099 verbatim with one change: the calls-per-hour rate limit is read from '
  'thresholds.rate_limit_calls_per_hour, falling back to 10 so an unpublished '
  'config still enforces. The limit counts ATTEMPTS, not minutes, which is why '
  'it has to be raisable for a test window without a release.';

-- ── 2. meter_active_calls: 037's ring expiry, plus the sweep 037 dropped ────
create or replace function public.meter_active_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired   integer;
  v_abandoned integer;
begin
  with expired as (
    update public.calls
    set status = 'missed',
        ended_at = now(),
        end_reason = 'unanswered'
    where status = 'ringing'
      and created_at < now() - interval '30 seconds'
    returning session_request_id
  ),
  requests as (
    update public.session_requests sr
    set status = 'expired',
        responded_at = now()
    from expired e
    where sr.id = e.session_request_id
      and sr.status = 'pending'
    returning sr.id
  )
  select count(*)::integer into v_expired from expired;

  -- Restored from 011. Nobody has heartbeated for 90 seconds, so the clients
  -- are gone: without this the row stays 'active' forever and start_call's
  -- cross-conversation BUSY branch refuses every later call by that user.
  -- No settle_call: billing is meter_active_sessions' job since 037.
  with abandoned as (
    update public.calls
    set status = 'ended',
        ended_at = now(),
        end_reason = 'dropped'
    where status = 'active'
      and last_seen_at < now() - interval '90 seconds'
    returning id
  )
  select count(*)::integer into v_abandoned from abandoned;

  return v_expired + v_abandoned;
end;
$$;

revoke all on function public.meter_active_calls()
  from public, anon, authenticated;
grant execute on function public.meter_active_calls() to service_role;

comment on function public.meter_active_calls() is
  'Liveness sweep for the calls signalling row, on the one-minute pg_cron tick '
  '(011). Expires a ring older than 30 seconds and cascades its pending '
  'session_request (037), and ends an ACTIVE call whose last_seen_at went '
  'quiet for 90 seconds as end_reason ''dropped'' (011, dropped by 037 with '
  'the billing it was tangled up in). Bills nothing: that is '
  'meter_active_sessions.';
