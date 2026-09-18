-- Simultaneous calls in the same conversation silently ended the wrong side.
-- Telegram-CTO audit, 2026-09-17, confirmed (M23). Amit's call: show a
-- dialog ("X is calling you too — answer instead?"), not auto-connect and
-- not the current silent-replace behaviour.
--
-- Before this migration, `start_call` treated ANY existing ringing/active
-- call in the SAME conversation as something to silently end and replace
-- (the "upgrade, not BUSY" comment two lines above the fix): if member and
-- provider tap Call within the same instant, whichever `start_call`
-- transaction commits second ends the FIRST caller's still-ringing row
-- (status -> 'missed', end_reason 'hangup') and inserts a fresh one — so
-- the first caller's own outgoing call reads as a call THEY placed that
-- was never answered, when in fact the other person was calling them back
-- the same second.
--
-- The fix is narrow: BEFORE ending anything, check whether the OTHER party
-- is already ringing THIS user in THIS conversation (status = 'ringing',
-- caller_id = the peer, callee_id = me). If so, return a new error code
-- carrying that call's id instead of silently replacing it, so the client
-- can offer to answer it. Scoped to 'ringing' only (not 'active'): if the
-- other party's call had already been answered, this device would already
-- be looking at that CallScreen and there would be no Call button to have
-- pressed in the first place.
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
  v_incoming         public.calls%rowtype;
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

  -- Same shape as send_message's message limit: the coalesce fallback is the
  -- floor, so an unpublished config still enforces 10.
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

  -- THE FIX (M23): the other party is already ringing ME in THIS
  -- conversation, right now. Ending their call and placing a fresh one
  -- would mark THEIR still-live call attempt as missed for a reason that
  -- is not true — tell the caller to answer it instead.
  select * into v_incoming
  from public.calls
  where conversation_id = p_conversation_id
    and status = 'ringing'
    and caller_id = v_other
    and callee_id = v_uid
  limit 1;

  if found then
    return json_build_object(
      'success', false,
      'error', 'ALREADY_RINGING',
      'call_id', v_incoming.id
    );
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
  '109 verbatim with one addition: if the other party is already ringing '
  'this user in the SAME conversation (status = ringing, caller/callee '
  'reversed), returns {success:false, error:ALREADY_RINGING, call_id} '
  'instead of silently ending their call and placing a fresh one. '
  'Migration 120, 2026-09-17.';
