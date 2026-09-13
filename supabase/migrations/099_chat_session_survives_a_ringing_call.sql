-- 099_chat_session_survives_a_ringing_call.sql
--
-- Chat and a ringing call may now coexist, and the chat session ends only when
-- the call actually connects.
--
-- THE BUG THIS FIXES, stated precisely because two earlier readings of it were
-- wrong. `start_call` (079, the live definition -- NOT 073) ends the chat
-- session inline with `end_reason = 'upgraded_to_call'` and carries an explicit
-- comment where 073's purge used to be: "Keep the transcript. Upgrade is a
-- billing handoff, not end_session purge." So it never calls `end_session`.
--
-- Nothing else hides those messages either. `end_session` hides
-- `session_id = p_session_id or session_id is null`; the old chat messages
-- carry the CHAT session's id, so the call's own end_session at hang-up does
-- not match them, and neither does any later chat session's. The result: ONE
-- call attempt in a conversation -- even a declined one -- left that chat
-- session's transcript visible permanently, and every later session showed it.
-- "Only metadata survives a session" was true for a normally-ended chat session
-- and false for any conversation that had ever tried a call.
--
-- WHY start_call ended the chat session at all: `paid_sessions_one_live` is a
-- unique index on conversation_id over non-terminal states, so the call's row
-- could not be inserted while the chat session lived. The purge rode along with
-- a constraint workaround.
--
-- THE MODEL (Amit, 2026-09-13): every session is independent. Tapping call must
-- not disturb the chat. A declined, unanswered or failed call leaves the chat
-- session LIVE and its transcript intact. Only a call that actually connects
-- ends the chat, and then the chat's content goes with it.
--
-- THREE CHANGES:
--
-- 1. `paid_sessions_one_live` becomes unique per (conversation_id, channel), so
--    a live chat session and a pending call session can coexist while it rings.
--    The no-double-bill property this index protected is preserved by
--    construction, not by hope: a call session is inserted at `pending_leases`
--    and bills NOTHING, and `meter_active_sessions` only bills
--    active/warning/grace -- so the chat bills alone until the call connects,
--    and the chat is ended in the SAME transaction that activates the call.
--    There is no instant where two sessions in one conversation both bill.
--
-- 2. `start_call` stops touching the chat session. Its upgrade block is kept
--    but narrowed to audio -> video, which still needs it: per-channel
--    uniqueness makes 'audio' and 'video' distinct, so without that branch both
--    would be live and both would bill.
--
-- 3. `claim_session_lease` ends the chat session -- via `end_session`, so the
--    transcript is hidden by the same rule as every other session end -- at the
--    moment a non-chat session takes its first billed minute. For a call that
--    already requires `v_both_media`, i.e. media connected on both sides.

begin;

-- ── 1. One live session per conversation PER CHANNEL ────────────────────────
drop index if exists public.paid_sessions_one_live;

create unique index paid_sessions_one_live
  on public.paid_sessions (conversation_id, channel)
  where status not in ('ended', 'reported_hold');

comment on index public.paid_sessions_one_live is
  'One live session per conversation PER CHANNEL (099). Was per conversation, '
  'which forced start_call to end the chat session before a call could be '
  'inserted -- and that inline end skipped end_session, so the chat transcript '
  'was never hidden. Per-channel lets the chat survive a ringing call; the '
  'chat is ended by claim_session_lease when the call actually connects. No '
  'double billing: a pending_leases session bills nothing and is invisible to '
  'meter_active_sessions, and the chat ends in the same transaction the call '
  'activates.';

-- ── 2. start_call: hands off audio -> video only, never touches chat ────────
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
    -- 2026-09-13; see this migration's header. This branch stays because with
    -- per-channel uniqueness 'audio' and 'video' are now distinct channels, so
    -- without it BOTH would be live and both would bill.
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

-- ── 3. claim_session_lease: a connected call ends the chat session ─────────
create or replace function public.claim_session_lease(
  p_session_id uuid,
  p_kind       public.lease_kind default 'foreground'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session     public.paid_sessions%rowtype;
  v_both_leases boolean;
  v_both_media  boolean;
  v_chat_id     uuid;
begin
  select * into v_session
  from public.paid_sessions
  where id = p_session_id
  for update;

  if not found or v_session.status in ('ended', 'reported_hold') then
    return 'ended';
  end if;

  if auth.uid() not in (v_session.member_id, v_session.provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
  values (p_session_id, auth.uid(), p_kind, now())
  on conflict (session_id, user_id) do update
    set kind = excluded.kind,
        last_heartbeat_at = excluded.last_heartbeat_at;

  select count(*) = 2 into v_both_leases
  from public.session_leases
  where session_id = p_session_id
    and last_heartbeat_at > now() - interval '30 seconds';

  select count(*) = 2 into v_both_media
  from public.session_leases
  where session_id = p_session_id
    and kind = 'connected'
    and last_heartbeat_at > now() - interval '30 seconds';

  if v_session.status = 'pending_leases'
     and v_both_leases
     and (v_session.channel = 'chat' or v_both_media)
  then
    begin
      perform public.deduct_tokens(
        v_session.member_id,
        v_session.rate_tokens_per_min,
        p_session_id,
        v_session.economics_config_version_id
      );
    exception when sqlstate 'P0003' then
      perform public.end_session(
        p_session_id, 'balance_exhausted', null, null, null
      );
      return 'ended';
    end;

    update public.paid_sessions
    set status           = 'active',
        started_at       = now(),
        last_activity_at = now(),
        minutes_billed   = 1,
        tokens_debited   = rate_tokens_per_min,
        next_bill_at     = now() + interval '1 minute'
    where id = p_session_id;

    /*
     * A CALL just became real. The chat session it supersedes ends NOW.
     *
     * This is the whole point of the migration. Reaching this line means the
     * media is connected on both sides (`v_both_media` is required above for a
     * non-chat channel) and minute one has just been debited -- so the call is
     * happening and is costing money. That is the moment Amit chose for the
     * handoff, over pickup: a call that is answered and then fails on the
     * network bills nothing and now costs no transcript either.
     *
     * It ends through `end_session` rather than by updating the row here, and
     * that is the fix rather than a detail. `start_call` used to end the chat
     * session inline and skip `end_session` entirely, so the chat's messages
     * were never hidden by anyone -- not at call start, not at call end (the
     * call's own end_session hides `session_id = <call session> or null`, and
     * the chat's messages carry the chat session's id, which matches neither).
     * One call attempt in a conversation left that chat transcript visible
     * permanently. Routing through end_session means there is ONE hiding rule
     * in the system instead of a second, quieter path.
     *
     * Guarded on a live row because end_session raises P0008 on an already
     * ended session, and an unguarded call would abort the lease claim -- which
     * would break the call to tidy up the chat.
     */
    if v_session.channel <> 'chat' then
      select id into v_chat_id
      from   public.paid_sessions
      where  conversation_id = v_session.conversation_id
        and  channel = 'chat'
        and  status not in ('ended', 'reported_hold')
      limit  1;

      if v_chat_id is not null then
        perform public.end_session(v_chat_id, 'upgraded_to_call');
      end if;
    end if;

    return 'active';
  end if;

  return v_session.status::text;
end;
$$;

commit;
