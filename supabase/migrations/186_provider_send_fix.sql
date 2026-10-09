-- ---------------------------------------------------------------------------
-- 186: fix provider send when provider's own chat channel is off
--
-- Bug (B4): A provider with chat_enabled = false cannot send any message
-- outside a live session. The provider-send branch in send_message_core
-- inserts a session_requests row with initiator_id = auth.uid() (the
-- provider). The enforce_provider_channel trigger (064) raises P0009 when
-- the initiator's own channel is off. Only unique_violation was caught, so
-- P0009 escaped and the entire send failed, showing the provider "They are
-- not taking chats right now." — about themselves.
--
-- Fix: before inserting the provider-initiated request, check that the
-- provider's own chat_enabled flag is true. When it is off, skip the insert
-- so the message goes through without creating a session request.
--
-- Body copied from 077 (unchanged from 077→157 rename; 181 only touches
-- touch_session_activity and end_session). The ONLY diff is in the
-- "Provider send" block: the INSERT is now guarded on chat_enabled.
-- ---------------------------------------------------------------------------

create or replace function public.send_message_core(
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

  -- ── Provider send: join an existing request, or start one for the member ─
  --
  -- B4 (186): When the provider's own chat channel is off, inserting a
  -- session_request with initiator_id = v_uid triggers enforce_provider_channel
  -- (064), which raises P0009. That error was not caught here, so the entire
  -- send failed — the provider saw "They are not taking chats right now" about
  -- themselves. Fix: guard the INSERT on the provider's own chat_enabled flag.
  -- The message still sends (there is nothing to bill until the member replies),
  -- and no session request is created until the provider's channel is on.
  if not v_is_member and v_session_id is null then
    update public.session_requests
    set    responded_at = coalesce(responded_at, now())
    where  conversation_id = p_conversation_id
      and  channel         = 'chat'
      and  status          = 'pending'
      and  recipient_id    = v_uid
      and  responded_at is null;
    if not exists (
      select 1 from public.session_requests
      where  conversation_id = p_conversation_id
        and  channel         = 'chat'
        and  status          = 'pending'
    ) then
      -- Only create the provider-initiated request when the provider's own
      -- chat channel is on. enforce_provider_channel (064) raises P0009 when
      -- it is off, and only unique_violation was previously caught, so the
      -- send failed. Skipping the insert here lets the message through.
      if exists (
        select 1 from public.profiles
        where  id           = v_uid
          and  chat_enabled = true
      ) then
        begin
          insert into public.session_requests (
            conversation_id, channel, initiator_id, recipient_id,
            expires_at, responded_at
          ) values (
            p_conversation_id, 'chat', v_uid, v_member,
            now() + interval '24 hours', now()
          );
        exception when unique_violation then
          null;
        end;
      end if;
    end if;
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

comment on function public.send_message_core(uuid, text, uuid, text, integer, text, integer, integer, real[]) is
  'Core send path (077''s body). 186: provider-send branch no longer inserts a '
  'session_request when the provider''s own chat_enabled is false, preventing '
  'enforce_provider_channel (064) from raising P0009 and killing the send.';
