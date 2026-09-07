-- ===========================================================================
-- 076  Call handoff, keep transcript, member chat consent
-- ===========================================================================
-- Decisions 2026-09-07:
--   start_call ends this conversation's live calls row (audio→video).
--   Upgrade does NOT hide messages.
--   start_call supersedes a pending chat request.
--   Provider reply sets session_requests.responded_at and leaves status pending.
--   Member confirm_chat_session then creates the paid_session.

create or replace function public.confirm_chat_session(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req         public.session_requests%rowtype;
  v_member_id   uuid;
  v_provider_id uuid;
  v_snapshot    record;
  v_session_id  uuid;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized' using errcode = 'P0001';
  end if;

  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found or v_req.status <> 'pending' then
    raise exception 'Request not found or not open' using errcode = 'P0001';
  end if;
  -- Member (initiator) confirms after the provider has joined.
  if v_req.initiator_id <> auth.uid() then
    raise exception 'Not the initiator' using errcode = 'P0001';
  end if;
  if v_req.channel <> 'chat' then
    raise exception 'Not a chat request' using errcode = 'P0001';
  end if;
  if v_req.responded_at is null then
    raise exception 'Provider has not joined' using errcode = 'P0001';
  end if;
  if v_req.expires_at < now() then
    update public.session_requests set status = 'expired' where id = p_request_id;
    raise exception 'Request has expired' using errcode = 'P0007';
  end if;

  update public.session_requests
  set    status = 'accepted', responded_at = now()
  where  id = p_request_id;

  select member_id, provider_id
  into   v_member_id, v_provider_id
  from   public.conversations
  where  id = v_req.conversation_id;

  select * into v_snapshot
  from   public.get_session_billing_snapshot('chat');

  insert into public.paid_sessions (
    conversation_id, request_id, channel,
    member_id, provider_id,
    rate_tokens_per_min, provider_share_percent,
    payout_hold_days, economics_config_version_id,
    accepted_at
  ) values (
    v_req.conversation_id, p_request_id, 'chat',
    v_member_id, v_provider_id,
    v_snapshot.rate_tokens_per_min, v_snapshot.provider_share_percent,
    v_snapshot.payout_hold_days,    v_snapshot.economics_version_id,
    now()
  )
  returning id into v_session_id;

  update public.messages
  set    session_id = v_session_id
  where  conversation_id = v_req.conversation_id
    and  session_id is null
    and  created_at >= v_req.created_at;

  return v_session_id;
end;
$$;

revoke all on function public.confirm_chat_session(uuid) from public, anon;
grant execute on function public.confirm_chat_session(uuid) to authenticated;

-- Member may cancel their own open chat request (Decline on the consent sheet).
create or replace function public.decline_session_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.session_requests%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'GONE');
  end if;
  if v_req.recipient_id <> v_uid and v_req.initiator_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('success', true, 'status', v_req.status);
  end if;

  update public.session_requests
  set    status       = case when v_req.initiator_id = v_uid then 'cancelled' else 'declined' end,
         responded_at = now()
  where  id           = p_request_id;

  return jsonb_build_object('success', true, 'status',
    case when v_req.initiator_id = v_uid then 'cancelled' else 'declined' end);
end;
$$;

create or replace function public.get_pending_session_request(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.session_requests%rowtype;
begin
  if v_uid is null then return null; end if;

  select * into v_req
  from   public.session_requests
  where  conversation_id = p_conversation_id
    and  (initiator_id = v_uid or recipient_id = v_uid)
    and  status = 'pending'
    and  expires_at > now()
  order  by created_at desc
  limit  1;

  if not found then return null; end if;

  return jsonb_build_object(
    'id',           v_req.id,
    'channel',      v_req.channel,
    'status',       v_req.status,
    'responded_at', v_req.responded_at,
    'initiator_id', v_req.initiator_id,
    'recipient_id', v_req.recipient_id,
    'expires_at',   v_req.expires_at,
    'created_at',   v_req.created_at
  );
end;
$$;

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
  set    status     = case when status = 'ringing' then 'missed' else 'ended' end,
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
    and (
      channel = 'chat'
      or (channel = 'audio' and p_medium = 'video')
    )
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

revoke all on function public.start_call(uuid, public.call_medium) from public, anon, authenticated;
grant execute on function public.start_call(uuid, public.call_medium) to authenticated;

create or replace function public.send_message(
  p_conversation_id    uuid,
  p_body               text     default null,
  p_reply_to_id        uuid     default null,
  p_voice_path         text     default null,
  p_voice_duration_ms  integer  default null,
  p_attachment_path    text     default null,
  p_attachment_width   integer  default null,
  p_attachment_height  integer  default null,
  p_voice_peaks        real[]   default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid        := auth.uid();
  v_member         uuid;
  v_provider       uuid;
  v_other          uuid;
  v_is_member      boolean;
  v_message        public.messages%rowtype;
  v_trimmed        text        := nullif(btrim(p_body), '');
  v_voice          boolean     := p_voice_path is not null;
  v_image          boolean     := p_attachment_path is not null;
  v_recent         integer;
  v_suspended      timestamptz;
  v_session_id     uuid;
  v_req_id         uuid;
  v_req_created_at timestamptz;
  v_snapshot_rate  integer;
  v_snapshot_share integer;
  v_snapshot_hold  integer;
  v_snapshot_ver   uuid;
  v_rate_limit     integer;
begin
  -- ── Auth guard ─────────────────────────────────────────────────────────────
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  -- ── Payload validation (unchanged from migration 024) ─────────────────────
  if (v_trimmed is not null)::int + v_voice::int + v_image::int <> 1 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_trimmed is not null and length(v_trimmed) > 4000 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and (
    p_voice_duration_ms is null
    or p_voice_duration_ms < 1000
    or p_voice_duration_ms > 180000
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and p_voice_peaks is not null
    and array_length(p_voice_peaks, 1) > 64 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_image and (
    p_attachment_width  is null or p_attachment_height is null
    or p_attachment_width  <= 0 or p_attachment_height <= 0
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and split_part(p_voice_path, '/', 1) <> p_conversation_id::text then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_image and split_part(p_attachment_path, '/', 1) <> p_conversation_id::text then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  -- ── Conversation lookup ───────────────────────────────────────────────────
  select member_id, provider_id
  into   v_member, v_provider
  from   public.conversations
  where  id = p_conversation_id;

  if v_member is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  v_is_member := v_uid = v_member;
  v_other := case when v_is_member then v_provider else v_member end;

  -- Acceptance is a server invariant, not only a boot-screen convention.
  -- This function can create or accept a session implicitly, so it must enforce
  -- the same gate as the explicit session RPCs before storing any UGC.
  if not public.user_has_accepted_current_policies(v_uid) then
    return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
  end if;

  -- ── Suspension check ─────────────────────────────────────────────────────
  select suspended_until into v_suspended
  from   public.profiles
  where  id = v_uid;

  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  -- Blocking is symmetric: neither party may use an existing thread to reach
  -- the other after either participant blocks the pair.
  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- ── Rate-limit check (rolling 60-second window) ──────────────────────────
  -- The active thresholds projection is the production control plane. Keep the
  -- established 20 msg/min limit as the safe fallback before first publish.
  v_rate_limit := coalesce(
    (public.get_active_config('thresholds')->>'rate_limit_messages_per_min')::integer,
    20
  );

  select count(*) into v_recent
  from   public.messages
  where  sender_id        = v_uid
    and  created_at       > now() - interval '60 seconds';

  if v_recent >= v_rate_limit then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  -- ── Reply guard ──────────────────────────────────────────────────────────
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where  id              = p_reply_to_id
      and  conversation_id = p_conversation_id
  ) then
    return json_build_object('success', false, 'error', 'REPLY_NOT_FOUND');
  end if;

  -- ── Resolve any existing live session ────────────────────────────────────
  select id into v_session_id
  from   public.paid_sessions
  where  conversation_id = p_conversation_id
    and  status in ('pending_leases', 'active', 'warning', 'grace')
  order  by accepted_at desc
  limit  1;

  -- ── Member first send: auto-create pending chat request ──────────────────
  -- Creates an implicit chat request when the member sends the opening content
  -- and no session or pending request already exists. This removes the need
  -- for a separate create_session_request call on the member side. ADR-0020.
  if v_is_member and v_session_id is null then
    select snap.rate_tokens_per_min,
           snap.provider_share_percent,
           snap.payout_hold_days,
           snap.economics_version_id
    into   v_snapshot_rate, v_snapshot_share, v_snapshot_hold, v_snapshot_ver
    from   public.get_session_billing_snapshot('chat') as snap;

    if (
      select token_balance
      from public.profiles
      where id = v_member
    ) < v_snapshot_rate then
      return json_build_object(
        'success', false, 'error', 'INSUFFICIENT_BALANCE'
      );
    end if;

    if not exists (
      select 1 from public.session_requests
      where  conversation_id = p_conversation_id
        and  channel         = 'chat'
        and  status          = 'pending'
    ) then
      begin
        insert into public.session_requests (
          conversation_id, channel, initiator_id, recipient_id, expires_at
        ) values (
          p_conversation_id, 'chat', v_uid, v_provider,
          now() + interval '24 hours'
        )
        returning id into v_req_id;
      exception when unique_violation then
        null; -- concurrent insert; request already exists
      end;
    end if;
  end if;

  -- ── Provider first send: mark the request joined, do not bill yet ────────
  -- Member confirm_chat_session creates the paid_session (076).
  if not v_is_member and v_session_id is null then
    update public.session_requests
    set    responded_at = coalesce(responded_at, now())
    where  conversation_id = p_conversation_id
      and  channel         = 'chat'
      and  status          = 'pending'
      and  recipient_id    = v_uid
      and  responded_at is null;
  end if;

  -- ── Re-resolve session_id after potential creation above ─────────────────
  if v_session_id is null then
    select id into v_session_id
    from   public.paid_sessions
    where  conversation_id = p_conversation_id
      and  status in ('pending_leases', 'active', 'warning', 'grace')
    order  by accepted_at desc
    limit  1;
  end if;

  -- ── Insert message (NO per-message token debit) ──────────────────────────
  -- Per-message debit removed: the per-minute session meter (claim_session_lease
  -- + meter_active_sessions) is the sole billing path. ADR-0020.
  insert into public.messages (
    conversation_id,
    sender_id,
    body,
    voice_path,
    voice_duration_ms,
    voice_peaks,
    attachment_path,
    attachment_width,
    attachment_height,
    reply_to_id,
    session_id
  ) values (
    p_conversation_id,
    v_uid,
    v_trimmed,
    p_voice_path,
    p_voice_duration_ms,
    p_voice_peaks,
    p_attachment_path,
    p_attachment_width,
    p_attachment_height,
    p_reply_to_id,
    v_session_id
  )
  returning * into v_message;

  -- ── Thread metadata ───────────────────────────────────────────────────────
  insert into public.conversation_thread_meta (
    conversation_id,
    last_session_at,
    last_preview_kind,
    unread_count_member,
    unread_count_provider,
    updated_at
  ) values (
    p_conversation_id,
    now(),
    case
      when v_voice then 'voice'
      when v_image then 'image'
      else 'text'
    end,
    case when v_is_member then 0 else 1 end,
    case when v_is_member then 1 else 0 end,
    now()
  )
  on conflict (conversation_id) do update
    set last_session_at   = excluded.last_session_at,
        last_preview_kind = excluded.last_preview_kind,
        unread_count_member   = case
          when v_is_member then 0
          else conversation_thread_meta.unread_count_member + 1
        end,
        unread_count_provider = case
          when not v_is_member then 0
          else conversation_thread_meta.unread_count_provider + 1
        end,
        updated_at = excluded.updated_at;

  -- new_balance is null: no per-message debit in the session model.
  return json_build_object(
    'success',    true,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'kind',       case
                    when v_voice then 'voice'
                    when v_image then 'image'
                    else 'text'
                  end,
    'session_id', v_session_id,
    'new_balance', null
  );
end;
$$;

