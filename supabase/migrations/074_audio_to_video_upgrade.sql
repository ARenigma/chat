-- ===========================================================================
-- 074  Extend start_call upgrade path: audio → video
-- ===========================================================================
-- Migration 073 allowed upgrading a live CHAT session to an audio/video call.
-- This migration extends that upgrade path to also handle AUDIO → VIDEO:
-- when a live audio paid_session exists for this conversation and the caller
-- requests video, end the audio session first (same teardown), then proceed.
--
-- What is NOT allowed:
--   - video → audio downgrade (product decision: video is always an upgrade)
--   - any upgrade involving a DIFFERENT conversation (the pair is just busy)
--
-- The single BUSY check now only fires for:
--   (a) a call row in status 'ringing' or 'active' for either participant
--   (b) a live audio or video session for a DIFFERENT conversation pair
--       (this pair's session is handled by the upgrade path above)

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

  select count(*)::integer into v_recent
  from public.calls
  where caller_id = v_uid
    and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  -- ── BUSY check ───────────────────────────────────────────────────────────
  -- Any ringing/active call row for either participant is a hard block.
  -- An audio or video session for THIS conversation is handled by the upgrade
  -- path below, so it is excluded from the BUSY check.
  -- A session for a different conversation means one of the pair is genuinely
  -- busy elsewhere — that is still BUSY.
  if exists (
    select 1 from public.calls
    where status in ('ringing', 'active')
      and (caller_id in (v_uid, v_other) or callee_id in (v_uid, v_other))
  ) or exists (
    select 1 from public.paid_sessions
    where channel in ('audio', 'video')
      and status in ('pending_leases', 'active', 'warning', 'grace')
      and (member_id in (v_uid, v_other) or provider_id in (v_uid, v_other))
      and conversation_id <> p_conversation_id    -- ← same-convo handled below
  ) then
    return json_build_object('success', false, 'error', 'BUSY');
  end if;

  -- ── Upgrade path: end live session of a compatible type for THIS conversation
  --
  -- Eligible sessions:
  --   channel = 'chat'   → always upgradeable to any call medium (073)
  --   channel = 'audio'  → upgradeable to video only (p_medium = 'video') (074)
  --
  -- NOT eligible (left to the BUSY check above, which won't match because we
  -- excluded same-convo above):
  --   channel = 'video' + p_medium = 'voice' → downgrade not allowed
  --   channel = 'audio' + p_medium = 'voice' → same type, nothing to upgrade
  --   channel = 'video' + p_medium = 'video' → same type, nothing to upgrade
  -- ---------------------------------------------------------------------------
  select * into v_upgrade_session
  from public.paid_sessions
  where conversation_id = p_conversation_id
    and status in ('pending_leases', 'active', 'warning', 'grace')
    and (
      channel = 'chat'
      or (channel = 'audio' and p_medium = 'video')
    )
  for update skip locked
  limit 1;

  if found then
    -- Billed minutes for the ending session, identical to end_session.
    v_upgrade_minutes := case
      when v_upgrade_session.started_at is null then 0
      else greatest(
        0,
        floor(extract(epoch from (now() - v_upgrade_session.started_at)) / 60)::integer
      )
    end;

    -- Hide content from this session.
    update public.messages
    set    hidden_at   = now(),
           purge_after = now() + interval '30 days'
    where  conversation_id = p_conversation_id
      and  hidden_at is null
      and  created_at <= now()
      and  (session_id = v_upgrade_session.id or session_id is null);

    -- End the session.
    update public.paid_sessions
    set    status     = 'ended',
           ended_at   = now(),
           end_reason = 'upgraded_to_call'
    where  id = v_upgrade_session.id;

    -- Release leases.
    delete from public.session_leases where session_id = v_upgrade_session.id;

    -- Accrue earnings for any billed minutes.
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

    -- Update thread metadata.
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

  -- ── Create the new session request and call row ───────────────────────────
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

-- Grants unchanged from migration 064.
revoke all on function public.start_call(uuid, public.call_medium) from public, anon, authenticated;
grant execute on function public.start_call(uuid, public.call_medium) to authenticated;
