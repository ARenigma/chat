-- ===========================================================================
-- 037  Paid-session server cutover (ADR-0020)
-- ===========================================================================
-- Completes the server-side session architecture:
--
--  1. send_message — removes per-message token debit; auto-creates a pending
--     chat session request on the member's first text; auto-accepts on the
--     provider's first reply. Messages are associated with the active session
--     row so purge_session_content can delete them atomically.
--
--  2. spend_chat_minute — replaced with a backward-compatible no-op that
--     returns {success:true} so the v1 client rollout is safe. Old clients
--     calling spend_chat_minute before session-aware billing ships will not
--     incorrectly debit tokens.
--
--  3. get_active_session — new RPC for the client to read the current
--     session state for a conversation.
--
--  4. get_pending_session_request — new RPC to read any pending request.
--
-- What this migration does NOT change:
--   - call billing paths (answer_call / meter_active_calls).
--   - RLS policies.
--   - The billing snapshot or accrual math (migration 029).

-- ---------------------------------------------------------------------------
-- 1. Updated send_message — session-aware, no per-message debit
-- ---------------------------------------------------------------------------
-- Signature is unchanged from migration 024 so existing grants apply.
--
-- Session-integration logic:
--   a. A member's first text in a conversation creates a pending chat request
--      if no pending/active session already exists.
--   b. The provider's first text in a conversation with a pending chat request
--      auto-accepts it and creates the paid_sessions row.
--   c. Messages are linked to the session row via session_id when an active
--      session exists at send time; otherwise session_id is NULL.
--   d. No token debit occurs here. Billing is solely via claim_session_lease
--      (first minute) and meter_active_sessions (subsequent minutes).

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

  -- ── Provider first send: auto-accept pending chat request ────────────────
  -- The provider's first reply accepts the pending request and creates the
  -- paid_sessions row. This mirrors the two-sided acceptance model in
  -- accept_session_request but fires automatically so the provider does not
  -- need a separate RPC call for text sessions. ADR-0020.
  if not v_is_member and v_session_id is null then
    select id, created_at into v_req_id, v_req_created_at
    from   public.session_requests
    where  conversation_id = p_conversation_id
      and  channel         = 'chat'
      and  status          = 'pending'
      and  recipient_id    = v_uid
    for update skip locked
    limit 1;

    if v_req_id is not null then
      update public.session_requests
      set    status       = 'accepted',
             responded_at = now()
      where  id = v_req_id;

      -- Snapshot billing params at acceptance — immutable for the session life.
      if v_snapshot_rate is null then
        select snap.rate_tokens_per_min,
               snap.provider_share_percent,
               snap.payout_hold_days,
               snap.economics_version_id
        into   v_snapshot_rate, v_snapshot_share, v_snapshot_hold, v_snapshot_ver
        from   public.get_session_billing_snapshot('chat') as snap;
      end if;

      insert into public.paid_sessions (
        conversation_id, request_id, channel,
        member_id, provider_id,
        rate_tokens_per_min, provider_share_percent,
        payout_hold_days, economics_config_version_id,
        accepted_at
      ) values (
        p_conversation_id, v_req_id, 'chat',
        v_member, v_provider,
        v_snapshot_rate, v_snapshot_share,
        v_snapshot_hold, v_snapshot_ver,
        now()
      )
      returning id into v_session_id;

      -- The initiating content was sent while the request was pending, before
      -- a paid_sessions row existed. Attach all content from this request
      -- window to the accepted session so end_session can purge it atomically.
      update public.messages
      set    session_id = v_session_id
      where  conversation_id = p_conversation_id
        and  session_id is null
        and  created_at >= v_req_created_at;
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

-- ---------------------------------------------------------------------------
-- 6. Idempotent started-minute metering
-- ---------------------------------------------------------------------------

alter table public.paid_sessions
  add column if not exists minutes_billed integer not null default 0
    check (minutes_billed >= 0),
  add column if not exists tokens_debited integer not null default 0
    check (tokens_debited >= 0),
  add column if not exists next_bill_at timestamptz;

-- A session has exactly one provider accrual. This also makes repeated end
-- attempts and trigger/function overlap harmless.
create unique index if not exists provider_earnings_one_per_session
  on public.provider_earnings_ledger (session_id);

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

    return 'active';
  end if;

  return v_session.status::text;
end;
$$;

revoke all on function public.claim_session_lease(uuid, public.lease_kind)
  from public, anon, service_role;
grant execute on function public.claim_session_lease(uuid, public.lease_kind)
  to authenticated;

-- Heartbeats prove presence; they are not user activity. Message sends update
-- last_activity_at. This distinction lets the five-minute idle timeout work.
create or replace function public.meter_active_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.paid_sessions%rowtype;
begin
  for v_session in
    select ps.*
    from public.paid_sessions ps
    where ps.status in ('active', 'warning', 'grace')
      and ps.started_at is not null
    for update skip locked
  loop
    if not exists (
      select 1 from public.session_leases sl
      where sl.session_id = v_session.id
        and sl.user_id = v_session.member_id
        and sl.last_heartbeat_at > now() - interval '30 seconds'
    ) or not exists (
      select 1 from public.session_leases sl
      where sl.session_id = v_session.id
        and sl.user_id = v_session.provider_id
        and sl.last_heartbeat_at > now() - interval '30 seconds'
    ) then
      perform public.end_session(
        v_session.id, 'disconnect_grace', null, null, null
      );
      continue;
    end if;

    if v_session.last_activity_at < now() - interval '5 minutes 30 seconds' then
      perform public.end_session(v_session.id, 'inactivity', null, null, null);
      continue;
    elsif v_session.last_activity_at < now() - interval '5 minutes' then
      update public.paid_sessions
      set status = 'warning',
          warning_at = coalesce(warning_at, now())
      where id = v_session.id;
    elsif v_session.status in ('warning', 'grace') then
      update public.paid_sessions
      set status = 'active',
          warning_at = null
      where id = v_session.id;
    end if;

    while v_session.next_bill_at is not null
          and v_session.next_bill_at <= now()
    loop
      begin
        perform public.deduct_tokens(
          v_session.member_id,
          v_session.rate_tokens_per_min,
          v_session.id,
          v_session.economics_config_version_id
        );

        update public.paid_sessions
        set minutes_billed = minutes_billed + 1,
            tokens_debited = tokens_debited + rate_tokens_per_min,
            next_bill_at = next_bill_at + interval '1 minute'
        where id = v_session.id
        returning * into v_session;
      exception when sqlstate 'P0003' then
        perform public.end_session(
          v_session.id, 'balance_exhausted', null, null, null
        );
        exit;
      end;
    end loop;
  end loop;

  update public.session_requests
  set status = 'expired',
      responded_at = coalesce(responded_at, now())
  where status = 'pending'
    and expires_at < now();

  update public.paid_sessions
  set status = 'ended',
      ended_at = now(),
      end_reason = 'system'
  where status = 'pending_leases'
    and accepted_at < now() - interval '15 minutes';
end;
$$;

revoke all on function public.meter_active_sessions()
  from public, anon, authenticated;
grant execute on function public.meter_active_sessions() to service_role;

-- Message/voice/image sends are activity for the idle timeout.
create or replace function public.touch_session_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.session_id is not null then
    update public.paid_sessions
    set last_activity_at = now(),
        status = case
          when status in ('warning', 'grace')
          then 'active'::public.paid_session_status
          else status
        end,
        warning_at = null
    where id = new.session_id
      and status in ('active', 'warning', 'grace');
  end if;
  return new;
end;
$$;

drop trigger if exists messages_touch_session_activity on public.messages;
create trigger messages_touch_session_activity
after insert on public.messages
for each row execute function public.touch_session_activity();

-- Accrual is based on actual usage-debit rows, not wall-clock duration. That
-- preserves started-minute semantics for sessions ending before 00:60.
create or replace function public.record_provider_accrual(
  p_provider_id            uuid,
  p_session_id             uuid,
  p_minutes_billed         integer,
  p_rate_per_min           integer,
  p_provider_share_percent integer,
  p_payout_hold_days       integer,
  p_config_version_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes  integer;
  v_gross    integer;
  v_provider integer;
  v_tx_id    uuid;
begin
  if exists (
    select 1 from public.provider_earnings_ledger
    where session_id = p_session_id
  ) then
    return;
  end if;

  select count(*)::integer into v_minutes
  from public.token_transactions
  where session_id = p_session_id
    and kind = 'usage_debit'
    and status = 'succeeded';

  if v_minutes = 0 then return; end if;

  v_gross := v_minutes * p_rate_per_min;
  v_provider := (v_gross * p_provider_share_percent) / 100;

  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta,
    session_id, config_version_id, provider_id
  ) values (
    p_provider_id, 'provider_accrual', 'succeeded',
    v_provider * 100, v_provider,
    p_session_id, p_config_version_id, p_provider_id
  )
  returning id into v_tx_id;

  insert into public.provider_earnings_ledger (
    provider_id, session_id, minutes_billed, rate_per_min,
    gross_tokens, provider_tokens, hold_until, transaction_id
  ) values (
    p_provider_id, p_session_id, v_minutes, p_rate_per_min,
    v_gross, v_provider,
    now() + make_interval(days => p_payout_hold_days),
    v_tx_id
  )
  on conflict (session_id) do nothing;
end;
$$;

create or replace function public.accrue_ended_paid_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ended' and old.status is distinct from 'ended' then
    perform public.record_provider_accrual(
      new.provider_id,
      new.id,
      new.minutes_billed,
      new.rate_tokens_per_min,
      new.provider_share_percent,
      new.payout_hold_days,
      new.economics_config_version_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists paid_sessions_accrue_on_end on public.paid_sessions;
create trigger paid_sessions_accrue_on_end
after update of status on public.paid_sessions
for each row execute function public.accrue_ended_paid_session();

revoke all on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. spend_chat_minute — backward-compatible no-op
-- ---------------------------------------------------------------------------
-- Old clients call spend_chat_minute once per minute. Under the per-minute
-- session model this is incorrect; the session meter handles charging.
-- This wrapper returns success without debiting tokens so old clients do not
-- display an error. Remove once all clients are on the session-aware path.

create or replace function public.spend_chat_minute()
returns json
language sql
stable
security definer
set search_path = public
as $$
  -- No debit. Session meter is the sole billing path now. ADR-0020.
  select json_build_object('success', true, 'new_balance', null, 'compat', 'no-op');
$$;

revoke all on function public.spend_chat_minute() from public, anon, service_role;
grant execute on function public.spend_chat_minute() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_active_session — read the live session for a conversation
-- ---------------------------------------------------------------------------

create or replace function public.get_active_session(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session public.paid_sessions%rowtype;
begin
  if v_uid is null then return null; end if;

  select * into v_session
  from   public.paid_sessions
  where  conversation_id = p_conversation_id
    and  (member_id = v_uid or provider_id = v_uid)
    and  status in ('pending_leases', 'active', 'warning', 'grace')
  order  by accepted_at desc
  limit  1;

  if not found then return null; end if;

  return jsonb_build_object(
    'id',                  v_session.id,
    'conversation_id',     v_session.conversation_id,
    'status',              v_session.status,
    'channel',             v_session.channel,
    'member_id',           v_session.member_id,
    'provider_id',         v_session.provider_id,
    'rate_tokens_per_min', v_session.rate_tokens_per_min,
    'started_at',          v_session.started_at,
    'accepted_at',         v_session.accepted_at,
    'ended_at',            v_session.ended_at,
    'last_activity_at',    v_session.last_activity_at
  );
end;
$$;

comment on function public.get_active_session(uuid) is
  'Returns the pending_leases or active paid session for a conversation, or '
  'NULL if none. Callers see only sessions they are party to. ADR-0020.';

revoke all on function public.get_active_session(uuid) from public, anon;
grant execute on function public.get_active_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_pending_session_request — read the open request for a conversation
-- ---------------------------------------------------------------------------

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
    'initiator_id', v_req.initiator_id,
    'recipient_id', v_req.recipient_id,
    'expires_at',   v_req.expires_at,
    'created_at',   v_req.created_at
  );
end;
$$;

comment on function public.get_pending_session_request(uuid) is
  'Returns the most recent non-expired pending session request for a '
  'conversation visible to the caller. NULL if none. ADR-0020.';

revoke all on function public.get_pending_session_request(uuid) from public, anon;
grant execute on function public.get_pending_session_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Metadata-only inbox projection and Realtime invalidation
-- ---------------------------------------------------------------------------
-- Keep peer presence for the existing Home affordance, but expose no message
-- body or sender content. The status comes from the latest paid session and is
-- metadata only. ADR-0020.

drop view if exists public.conversation_summaries;

create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id                                                        as conversation_id,
    case when c.member_id = auth.uid()
         then c.provider_id else c.member_id
    end                                                         as peer_id,
    pe.peer_display_name,
    coalesce(pe.peer_presence, 'hidden'::public.presence_choice) as peer_presence,
    pe.peer_last_active_at,
    pe.peer_avatar_url,
    tm.last_session_at,
    tm.last_session_channel,
    tm.last_session_duration_seconds,
    tm.last_preview_kind,
    latest.status                                               as last_session_status,
    coalesce(tm.unread_count_member, 0)                         as unread_count_member,
    coalesce(tm.unread_count_provider, 0)                       as unread_count_provider,
    (c.member_id = auth.uid())                                  as i_am_member
  from public.conversations c
  left join public.conversation_peers pe
         on pe.conversation_id = c.id
  left join public.conversation_thread_meta tm
         on tm.conversation_id = c.id
  left join lateral (
    select ps.status
    from   public.paid_sessions ps
    where  ps.conversation_id = c.id
    order  by ps.created_at desc
    limit  1
  ) latest on true
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'Metadata-only inbox projection: peer identity/presence, latest session '
  'activity/channel/status, and role-specific unread counts. Message content '
  'is intentionally absent. ADR-0020.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;

-- Realtime remains an invalidation hint; Postgres reads are authoritative.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'session_requests'
  ) then
    alter publication supabase_realtime add table public.session_requests;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'paid_sessions'
  ) then
    alter publication supabase_realtime add table public.paid_sessions;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Move audio/video calls onto the paid-session meter
-- ---------------------------------------------------------------------------
-- The calls row remains the ringing/signalling record. Billing is removed from
-- answer_call, heartbeat_call, end_call, and meter_active_calls; accepted calls
-- are linked to paid_sessions and activate only after both connected leases.

alter table public.calls
  add column if not exists session_request_id uuid
    references public.session_requests(id);

create unique index if not exists calls_session_request_unique
  on public.calls (session_request_id)
  where session_request_id is not null;

create or replace function public.start_call(
  p_conversation_id uuid,
  p_medium public.call_medium
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_member    uuid;
  v_provider  uuid;
  v_other     uuid;
  v_suspended timestamptz;
  v_recent    integer;
  v_request   uuid;
  v_call      public.calls%rowtype;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
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

  if exists (
    select 1 from public.calls
    where status in ('ringing', 'active')
      and (caller_id in (v_uid, v_other) or callee_id in (v_uid, v_other))
  ) or exists (
    select 1 from public.paid_sessions
    where status in ('pending_leases', 'active', 'warning', 'grace')
      and (member_id in (v_uid, v_other) or provider_id in (v_uid, v_other))
  ) then
    return json_build_object('success', false, 'error', 'BUSY');
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
      return json_build_object(
        'success', false, 'error', 'INSUFFICIENT_BALANCE'
      );
    when sqlstate 'P0005' then
      return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
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
    'medium', v_call.medium
  );
end;
$$;

revoke all on function public.start_call(uuid, public.call_medium)
  from public, anon;
grant execute on function public.start_call(uuid, public.call_medium)
  to authenticated;

create or replace function public.answer_call(p_call_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_call    public.calls%rowtype;
  v_session uuid;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_call
  from public.calls
  where id = p_call_id
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_call.callee_id <> v_uid then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;
  if v_call.status <> 'ringing' then
    return json_build_object('success', false, 'error', 'GONE');
  end if;

  begin
    v_session := public.accept_session_request(v_call.session_request_id);
  exception when others then
    return json_build_object('success', false, 'error', 'GONE');
  end;

  update public.paid_sessions
  set call_id = p_call_id
  where id = v_session;

  update public.calls
  set status = 'active',
      started_at = now(),
      last_seen_at = now()
  where id = p_call_id;

  return json_build_object(
    'success', true,
    'status', 'active',
    'session_id', v_session,
    'started_at', now(),
    'tokens_debited', 0
  );
end;
$$;

revoke all on function public.answer_call(uuid) from public, anon;
grant execute on function public.answer_call(uuid) to authenticated;

create or replace function public.heartbeat_call(p_call_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_call    public.calls%rowtype;
  v_session public.paid_sessions%rowtype;
begin
  update public.calls
  set last_seen_at = now()
  where id = p_call_id
    and status = 'active'
    and (caller_id = v_uid or callee_id = v_uid)
  returning * into v_call;

  if not found then
    select * into v_call from public.calls where id = p_call_id;
    if not found or v_uid not in (v_call.caller_id, v_call.callee_id) then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
    end if;
  end if;

  select * into v_session
  from public.paid_sessions
  where call_id = p_call_id
  order by created_at desc
  limit 1;

  return json_build_object(
    'success', true,
    'status', coalesce(v_session.status::text, v_call.status::text),
    'session_id', v_session.id,
    'minutes_billed', coalesce(v_session.minutes_billed, 0),
    'tokens_debited', coalesce(v_session.tokens_debited, 0)
  );
end;
$$;

revoke all on function public.heartbeat_call(uuid) from public, anon;
grant execute on function public.heartbeat_call(uuid) to authenticated;

create or replace function public.end_call(
  p_call_id uuid,
  p_reason text default 'hangup'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_call    public.calls%rowtype;
  v_session public.paid_sessions%rowtype;
  v_status  public.call_status;
  v_reason  text;
begin
  select * into v_call
  from public.calls
  where id = p_call_id
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid not in (v_call.caller_id, v_call.callee_id) then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;
  if v_call.status in ('ended', 'missed', 'declined', 'failed') then
    return json_build_object(
      'success', true, 'status', v_call.status, 'end_reason', v_call.end_reason
    );
  end if;

  select * into v_session
  from public.paid_sessions
  where call_id = p_call_id
    and status not in ('ended', 'reported_hold')
  order by created_at desc
  limit 1;

  if found then
    perform public.end_session(
      v_session.id,
      case when p_reason = 'media_failed' then 'system' else 'manual' end,
      null, null, null
    );
  else
    update public.session_requests
    set status = case
          when v_uid = v_call.callee_id
          then 'declined'::public.session_request_status
          else 'cancelled'::public.session_request_status
        end,
        responded_at = now()
    where id = v_call.session_request_id
      and status = 'pending';
  end if;

  v_status := case
    when p_reason = 'media_failed' then 'failed'::public.call_status
    when v_call.status = 'ringing' and v_uid = v_call.callee_id
      then 'declined'::public.call_status
    when v_call.status = 'ringing' then 'missed'::public.call_status
    else 'ended'::public.call_status
  end;
  v_reason := case
    when p_reason = 'media_failed' then 'media_failed'
    when v_status = 'declined' then 'declined'
    when v_status = 'missed' then 'unanswered'
    else 'hangup'
  end;

  update public.calls
  set status = v_status,
      ended_at = now(),
      end_reason = v_reason
  where id = p_call_id
  returning * into v_call;

  return json_build_object(
    'success', true,
    'status', v_call.status,
    'end_reason', v_call.end_reason,
    'tokens_debited', coalesce(v_session.tokens_debited, 0)
  );
end;
$$;

revoke all on function public.end_call(uuid, text) from public, anon;
grant execute on function public.end_call(uuid, text) to authenticated;

-- Keep only ringing expiry here. Active-call charging belongs exclusively to
-- meter_active_sessions after this migration.
create or replace function public.meter_active_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_touched integer;
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
  select count(*)::integer into v_touched from expired;

  return v_touched;
end;
$$;

revoke all on function public.meter_active_calls()
  from public, anon, authenticated;
grant execute on function public.meter_active_calls() to service_role;
