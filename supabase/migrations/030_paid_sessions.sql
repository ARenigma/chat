-- ===========================================================================
-- 030  Session requests, paid sessions, participant leases, thread metadata
-- ===========================================================================
-- Ephemeral bilateral paid-session core. No message content is retained
-- after a session ends; the schema is designed so that nothing here can
-- leak session content to the inbox or to any client list view.
--
-- Five tables:
--   • session_requests  — bilateral invitation layer (ADR-0020)
--   • paid_sessions     — authoritative billing record
--   • session_leases    — per-participant liveness leases
--   • conversation_thread_meta — inbox metadata, no message body
--   • messages.session_id column added (existing table)
--
-- Three RPCs:
--   • create_session_request — initiate a session invitation
--   • accept_session_request — accept and spawn paid_session row
--   • claim_session_lease    — heartbeat; activates when both leases live
--
-- Dependency note: migration 029 (billing_snapshot_and_accrual.sql) is
-- planned but not yet written. Three functions it will own are stubbed here
-- so this migration is self-contained. When 029 lands it replaces the stubs
-- with ledger-backed implementations; the signatures are locked.
--
-- References: ADR-0020, ADR-0021

-- Note: deduct_tokens, get_session_billing_snapshot, and record_provider_accrual
-- are defined in migrations 028 and 029 respectively. No stubs here; running
-- CREATE OR REPLACE against them would overwrite 028's bucket-aware deduct_tokens
-- (promo/purchased split) with a token_balance-only update, breaking ADR-0021.

-- ---------------------------------------------------------------------------
-- 1. Session requests — bilateral invitation layer
-- ---------------------------------------------------------------------------
-- One active pending request per (conversation, channel) at a time.
-- Providers may only initiate with prior-session members or members with
-- an open unanswered request (ADR-0020, provider re-invitation rules).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_channel') then
    create type public.session_channel as enum ('chat', 'audio', 'video');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_request_status') then
    create type public.session_request_status as enum (
      'pending', 'accepted', 'declined', 'expired', 'cancelled'
    );
  end if;
end
$$;

create table public.session_requests (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id) on delete cascade,
  channel          public.session_channel not null,
  initiator_id     uuid        not null references public.profiles(id),
  recipient_id     uuid        not null references public.profiles(id),
  status           public.session_request_status not null default 'pending',
  -- Expiry rules (ADR-0020):
  -- member chat requests expire in 24 hours
  -- provider return invitations expire in 30 minutes
  -- call requests expire in 30 seconds (handled by meter_active_calls)
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  constraint session_requests_no_self check (initiator_id != recipient_id)
);

comment on table public.session_requests is
  'Bilateral session invitations. One active pending request per '
  '(conversation, channel) at a time. Providers may only initiate with '
  'prior-session members or members with an open unanswered request. ADR-0020.';

-- One active pending request per (conversation, channel)
create unique index session_requests_one_pending
  on public.session_requests (conversation_id, channel)
  where status = 'pending';

create index session_requests_recipient_status
  on public.session_requests (recipient_id, status, created_at desc);

alter table public.session_requests enable row level security;

-- Both parties can read their own requests
create policy "Participants read session requests"
  on public.session_requests
  for select to authenticated
  using (initiator_id = auth.uid() or recipient_id = auth.uid());

revoke all on public.session_requests from anon, authenticated;
grant select on public.session_requests to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Paid sessions — authoritative billing record
-- ---------------------------------------------------------------------------
-- Billing starts when status transitions to 'active' (both leases present).
-- rate_tokens_per_min and provider_share_percent are snapshotted at
-- activation and are immutable thereafter. ADR-0020, ADR-0021.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'paid_session_status') then
    create type public.paid_session_status as enum (
      'pending_leases',  -- accepted; waiting for both live leases
      'active',          -- billing
      'warning',         -- inactivity warning (30 s before auto-end)
      'grace',           -- disconnect grace (30 s after lease lost)
      'ended',
      'reported_hold'    -- purge deferred for evidence copy
    );
  end if;
end
$$;

create table public.paid_sessions (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id),
  request_id       uuid        references public.session_requests(id),
  channel          public.session_channel not null,
  status           public.paid_session_status not null default 'pending_leases',
  member_id        uuid        not null references public.profiles(id),
  provider_id      uuid        not null references public.profiles(id),
  -- Billing snapshot: immutable once set (ADR-0020). The economics version id
  -- lets billing history be audited against the exact config that was active.
  rate_tokens_per_min        integer,
  provider_share_percent     integer,
  payout_hold_days           integer,
  economics_config_version_id uuid references admin.config_versions(id),
  -- Lifecycle timestamps
  accepted_at      timestamptz,
  started_at       timestamptz,    -- both leases present → active
  warning_at       timestamptz,    -- inactivity warning issued
  ended_at         timestamptz,
  last_activity_at timestamptz,
  end_reason       text check (end_reason in (
    'manual', 'inactivity', 'background', 'disconnect_grace',
    'balance_exhausted', 'blocked', 'suspended', 'system'
  )),
  -- call_id links an audio/video session to its calls row. FK added below
  -- after the table exists to make the dependency explicit.
  call_id          uuid,
  created_at       timestamptz not null default now(),
  constraint paid_sessions_member_not_provider check (member_id != provider_id)
);

comment on table public.paid_sessions is
  'Authoritative paid session record. Billing starts when status=active '
  '(both leases present). rate_tokens_per_min and provider_share_percent are '
  'snapshotted at activation and immutable thereafter. ADR-0020, ADR-0021.';

comment on column public.paid_sessions.economics_config_version_id is
  'Points at the admin.config_versions row active at session acceptance. '
  'Immutable once set: billing history must be auditable against the exact '
  'config that determined the rate. ADR-0023.';

comment on column public.paid_sessions.call_id is
  'Links an audio/video paid session to its public.calls row. '
  'Null for chat sessions. Set at acceptance when the calls row is created.';

-- FK for call_id. calls was created in migration 011.
alter table public.paid_sessions
  add constraint paid_sessions_call_fk
  foreign key (call_id) references public.calls(id);

-- One live session per conversation at a time. Partial index over non-terminal
-- states so two concurrent sessions on the same thread cannot coexist.
create unique index paid_sessions_one_live
  on public.paid_sessions (conversation_id)
  where status not in ('ended', 'reported_hold');

create index paid_sessions_member   on public.paid_sessions (member_id,   created_at desc);
create index paid_sessions_provider on public.paid_sessions (provider_id, created_at desc);
create index paid_sessions_status   on public.paid_sessions (status)
  where status not in ('ended', 'reported_hold');

alter table public.paid_sessions enable row level security;

create policy "Participants read own sessions"
  on public.paid_sessions
  for select to authenticated
  using (member_id = auth.uid() or provider_id = auth.uid());

revoke all on public.paid_sessions from anon, authenticated;
grant select on public.paid_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Participant leases — per-participant liveness tokens
-- ---------------------------------------------------------------------------
-- Billing begins only when both member and provider hold a foreground lease.
-- Audio and video sessions additionally require kind=connected from both
-- parties before status advances to active. Heartbeat interval: 10 s on the
-- client, 30 s grace before billing is suspended. ADR-0020.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lease_kind') then
    create type public.lease_kind as enum (
      'foreground',  -- app is in foreground
      'connected'    -- WebRTC media connected (required for audio/video billing)
    );
  end if;
end
$$;

create table public.session_leases (
  session_id        uuid        not null references public.paid_sessions(id) on delete cascade,
  user_id           uuid        not null references public.profiles(id),
  kind              public.lease_kind not null default 'foreground',
  last_heartbeat_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

comment on table public.session_leases is
  'Liveness leases for paid session participants. Billing begins only when '
  'both member and provider have a foreground lease. Calls additionally '
  'require kind=connected for both. Heartbeat: 10 s client, 30 s grace. '
  'ADR-0020.';

alter table public.session_leases enable row level security;

create policy "Participants read own leases"
  on public.session_leases
  for select to authenticated
  using (user_id = auth.uid());

create policy "Participants upsert own lease"
  on public.session_leases
  for all to authenticated
  using    (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.session_leases from anon, authenticated;
grant select, insert, update, delete on public.session_leases to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Conversation thread metadata
-- ---------------------------------------------------------------------------
-- Used by the Home/inbox list view. Intentionally contains no message
-- content: Recent Chats shows peer, date, channel, duration, and spend —
-- never message text. This replaces the last_body subqueries in
-- conversation_summaries (migration 031 rebuilds that view). ADR-0020.

create table public.conversation_thread_meta (
  conversation_id              uuid    primary key
    references public.conversations(id) on delete cascade,
  last_session_at              timestamptz,
  last_session_channel         public.session_channel,
  last_session_duration_seconds integer,
  last_preview_kind            text
    check (last_preview_kind in ('text', 'voice', 'image', 'call', 'session')),
  -- Deliberately no last_body or last_message_text. Ephemeral session content
  -- must never be surfaced in list views; the privacy boundary is architectural,
  -- not a UI choice the next engineer could accidentally revert. ADR-0020.
  unread_count_member   integer not null default 0,
  unread_count_provider integer not null default 0,
  updated_at            timestamptz not null default now()
);

comment on table public.conversation_thread_meta is
  'Thread metadata for Home/inbox lists. Contains no message content by '
  'design — ephemeral session content must not be surfaced in list views. '
  'Recent Chats shows peer, date, channel, duration, and spend only. '
  'ADR-0020.';

comment on column public.conversation_thread_meta.last_preview_kind is
  'Enum of what kind of event was last in the thread (text, voice, image, '
  'call, session). Used by the inbox row to choose the right icon. '
  'Never carries content.';

alter table public.conversation_thread_meta enable row level security;

-- RLS checks participation via the conversations table directly.
-- conversation_peers is SECURITY DEFINER=false and has no user_id column;
-- the conversations join is the canonical pattern for participation checks.
create policy "Participants read thread meta"
  on public.conversation_thread_meta
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where  c.id        = conversation_thread_meta.conversation_id
        and  (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

revoke all on public.conversation_thread_meta from anon, authenticated;
grant select on public.conversation_thread_meta to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Add session_id to messages
-- ---------------------------------------------------------------------------
-- Sessions scope messages so they can be purged atomically when the session
-- ends. Messages without a session_id are legacy rows from before this
-- migration; they will be purged during the cutover migration.

alter table public.messages
  add column if not exists session_id uuid references public.paid_sessions(id);

comment on column public.messages.session_id is
  'The paid session this message belongs to. Null only for pre-migration '
  'legacy rows which will be purged at cutover. New messages must carry a '
  'session_id so purge_session_content can delete them atomically. ADR-0020.';

create index if not exists messages_session_id on public.messages (session_id);

-- ---------------------------------------------------------------------------
-- 6. create_session_request RPC
-- ---------------------------------------------------------------------------
-- Enforces role and relationship rules before inserting a session invitation.
-- Policy acceptance is gated here (via user_has_accepted_current_policies)
-- for the same reason it is gated in send_message: UGC must not flow without
-- it, and a session invitation is UGC. ADR-0020.

create or replace function public.create_session_request(
  p_conversation_id uuid,
  p_channel         public.session_channel
)
returns uuid  -- session_request.id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id   uuid;
  v_provider_id uuid;
  v_is_member   boolean;
  v_recipient   uuid;
  v_initiator   uuid;
  v_expires_at  timestamptz;
  v_req_id      uuid;
begin
  -- Get conversation parties; auth.uid() must be one of them.
  select member_id, provider_id, (member_id = auth.uid())
  into   v_member_id, v_provider_id, v_is_member
  from   public.conversations
  where  id = p_conversation_id;

  if not found then
    raise exception 'Conversation not found' using errcode = 'P0001';
  end if;

  if auth.uid() not in (v_member_id, v_provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  -- Policy acceptance is required before any UGC operation (ADR-0022).
  if not public.user_has_accepted_current_policies(auth.uid()) then
    raise exception 'Policy acceptance required' using errcode = 'P0005';
  end if;

  -- A provider may only initiate if they have a prior ended session with
  -- this member OR if the member already has an open pending request. This
  -- prevents cold-call initiations from the provider side. ADR-0020.
  if not v_is_member then
    if not exists (
      select 1 from public.paid_sessions ps
      where  ps.provider_id = auth.uid()
        and  ps.member_id   = v_member_id
        and  ps.status      = 'ended'
    ) and not exists (
      select 1 from public.session_requests sr
      where  sr.conversation_id = p_conversation_id
        and  sr.initiator_id    = v_member_id
        and  sr.status          = 'pending'
    ) then
      raise exception 'Provider may not initiate with this member'
        using errcode = 'P0006';
    end if;
  end if;

  v_initiator := auth.uid();
  v_recipient := case when v_is_member then v_provider_id else v_member_id end;

  -- Expiry rules (ADR-0020): member chat = 24 h; provider return invite = 30 m;
  -- call requests = 30 s (handled by meter_active_calls in migration 011).
  v_expires_at := case
    when  v_is_member and p_channel = 'chat' then now() + interval '24 hours'
    when  not v_is_member                    then now() + interval '30 minutes'
    else  now() + interval '30 seconds'
  end;

  -- A member must hold enough balance for at least one minute before the
  -- phone of the other party rings. A ring that cannot connect is harassment.
  if v_is_member then
    declare
      v_snapshot record;
    begin
      select * into v_snapshot
      from   public.get_session_billing_snapshot(p_channel::text);

      if (select token_balance from public.profiles where id = auth.uid())
         < v_snapshot.rate_tokens_per_min
      then
        raise exception 'Insufficient balance for session' using errcode = 'P0003';
      end if;
    end;
  end if;

  insert into public.session_requests (
    conversation_id, channel, initiator_id, recipient_id, expires_at
  ) values (
    p_conversation_id, p_channel, v_initiator, v_recipient, v_expires_at
  )
  returning id into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.create_session_request(uuid, public.session_channel)
  from public, anon, service_role;
grant execute on function public.create_session_request(uuid, public.session_channel)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. accept_session_request RPC
-- ---------------------------------------------------------------------------
-- Accepts a pending request and creates the paid_session row. The session
-- starts in 'pending_leases'; billing begins only once both parties send a
-- live lease heartbeat (claim_session_lease). ADR-0020.

create or replace function public.accept_session_request(p_request_id uuid)
returns uuid  -- paid_session.id
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
  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found or v_req.status != 'pending' then
    raise exception 'Request not found or not pending' using errcode = 'P0001';
  end if;

  if v_req.recipient_id != auth.uid() then
    raise exception 'Not the recipient' using errcode = 'P0001';
  end if;

  if v_req.expires_at < now() then
    update public.session_requests
    set    status = 'expired'
    where  id     = p_request_id;
    raise exception 'Request has expired' using errcode = 'P0007';
  end if;

  -- Mark request accepted before creating the session row, so the partial
  -- unique index (one pending per conversation+channel) is freed immediately.
  update public.session_requests
  set    status       = 'accepted',
         responded_at = now()
  where  id           = p_request_id;

  select member_id, provider_id
  into   v_member_id, v_provider_id
  from   public.conversations
  where  id = v_req.conversation_id;

  -- Snapshot billing parameters from the currently active economics config.
  -- These columns are immutable once set; all future billing for this session
  -- uses these exact numbers even if the admin later changes the config.
  select * into v_snapshot
  from   public.get_session_billing_snapshot(v_req.channel::text);

  -- Status starts at pending_leases; claim_session_lease advances it to
  -- active once both participants have sent heartbeats. ADR-0020.
  insert into public.paid_sessions (
    conversation_id, request_id, channel,
    member_id, provider_id,
    rate_tokens_per_min, provider_share_percent,
    payout_hold_days, economics_config_version_id,
    accepted_at
  ) values (
    v_req.conversation_id, p_request_id, v_req.channel,
    v_member_id, v_provider_id,
    v_snapshot.rate_tokens_per_min, v_snapshot.provider_share_percent,
    v_snapshot.payout_hold_days,    v_snapshot.economics_version_id,
    now()
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke all on function public.accept_session_request(uuid)
  from public, anon, service_role;
grant execute on function public.accept_session_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. claim_session_lease RPC
-- ---------------------------------------------------------------------------
-- Heartbeat + lease upsert. When a pending_leases session receives fresh
-- leases from both participants, it advances to active and the first minute
-- is debited. For audio/video sessions, at least one party must hold a
-- 'connected' lease (WebRTC media up) before activation. ADR-0020.

create or replace function public.claim_session_lease(
  p_session_id uuid,
  p_kind       public.lease_kind default 'foreground'
)
returns text  -- new session status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session     public.paid_sessions%rowtype;
  v_both_leases boolean;
begin
  select * into v_session
  from   public.paid_sessions
  where  id = p_session_id
  for update;

  if not found or v_session.status in ('ended', 'reported_hold') then
    raise exception 'Session not active' using errcode = 'P0008';
  end if;

  if auth.uid() not in (v_session.member_id, v_session.provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  -- Upsert this user's lease. ON CONFLICT updates the heartbeat and kind so
  -- a foreground→connected upgrade arrives cleanly.
  insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
  values (p_session_id, auth.uid(), p_kind, now())
  on conflict (session_id, user_id) do update
    set kind              = excluded.kind,
        last_heartbeat_at = excluded.last_heartbeat_at;

  -- Both participants must have sent a heartbeat within the 30 s grace window.
  select count(*) = 2 into v_both_leases
  from   public.session_leases
  where  session_id         = p_session_id
    and  last_heartbeat_at  > now() - interval '30 seconds';

  -- Activate if pending and both leases are present.
  if v_session.status = 'pending_leases' and v_both_leases then
    -- Audio/video additionally require a connected (WebRTC up) lease from at
    -- least one party. Chat sessions activate on foreground leases alone.
    if v_session.channel != 'chat' then
      if not exists (
        select 1 from public.session_leases
        where  session_id        = p_session_id
          and  kind              = 'connected'
          and  last_heartbeat_at > now() - interval '30 seconds'
      ) then
        return 'pending_leases';  -- wait for WebRTC media to connect
      end if;
    end if;

    -- Debit minute 1 prepaid, same pattern as answer_call in migration 011.
    -- One code path: the first minute is billed at activation, subsequent
    -- minutes by meter_active_sessions (migration 031).
    perform public.deduct_tokens(
      v_session.member_id,
      v_session.rate_tokens_per_min,
      p_session_id,
      v_session.economics_config_version_id
    );

    update public.paid_sessions
    set    status           = 'active',
           started_at       = now(),
           last_activity_at = now()
    where  id = p_session_id;

    return 'active';
  end if;

  -- Refresh last_activity_at to prevent inactivity timeout while the member
  -- is actively in the session.
  if v_session.status = 'active' then
    update public.paid_sessions
    set    last_activity_at = now()
    where  id = p_session_id;
  end if;

  return v_session.status::text;
end;
$$;

revoke all on function public.claim_session_lease(uuid, public.lease_kind)
  from public, anon, service_role;
grant execute on function public.claim_session_lease(uuid, public.lease_kind)
  to authenticated;
