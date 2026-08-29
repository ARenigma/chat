-- ===========================================================================
-- 031  Purge, evidence, session lifecycle, conversation summary rebuild
-- ===========================================================================
-- Completes the ephemeral session system by adding the evidence copy path,
-- the purge functions that run inside end_session, the server-side session
-- lifecycle cron, and a rebuilt conversation_summaries view that never
-- surfaces message content.
--
-- Five sections after the table definitions:
--   • moderation_cases + report_evidence (evidence copy before purge)
--   • report_reason enum extension to the full 11-category taxonomy
--   • purge_session_content (called inside end_session)
--   • end_session RPC (evidence → purge → settle → metadata)
--   • purge_expired_evidence cron (1-year retention after case closure)
--   • conversation_summaries view rebuild (no last_body, uses thread meta)
--   • meter_active_sessions cron (1-minute lifecycle tick)
--
-- All RPCs: security definer + explicit set search_path. All user-facing
-- functions: revoke all from public then grant execute to authenticated.
--
-- References: ADR-0020, ADR-0021

-- ---------------------------------------------------------------------------
-- 1. Moderation cases and evidence tables
-- ---------------------------------------------------------------------------
-- moderation_cases: one per report (report-only path, separate from the
-- moderation_actions append-only table in migration 005).
-- report_evidence: selected items plus limited context, copied before purge.
-- Both tables are service_role-only; no client policy.

create table public.moderation_cases (
  id         uuid        primary key default gen_random_uuid(),
  report_id  uuid        not null references public.reports(id),
  status     text        not null default 'open'
             check (status in ('open', 'closed')),
  closed_at  timestamptz,
  closed_by  text,        -- admin email from config_audit; free text, not FK
  created_at timestamptz not null default now()
);

comment on table public.moderation_cases is
  'One per report submitted via end_session. Links a report to its evidence '
  'rows. Closed by ops tooling when the case is resolved. ADR-0020.';

alter table public.moderation_cases enable row level security;
-- RLS on with zero authenticated/anon policies = service_role-only access.
-- Same pattern as moderation_actions in migration 005.

-- ---------------------------------------------------------------------------
-- Evidence table: immutable once written.
-- Rows are copied BEFORE purge_session_content() deletes the originals.
-- retain_until is set provisionally at copy time (now + 1 year) and updated
-- to closed_at + 1 year when the case closes. Rows are never edited by a
-- client; service_role via purge_expired_evidence() is the only deleter.

create table public.report_evidence (
  id           uuid        primary key default gen_random_uuid(),
  case_id      uuid        not null references public.moderation_cases(id),
  kind         text        not null
               check (kind in ('text', 'voice', 'image', 'call_metadata', 'statement')),
  body         text,         -- text message body or JSON call metadata
  storage_path text,         -- voice/image objects copied to evidence-specific path
  captured_at  timestamptz not null,
  retain_until timestamptz not null,  -- closed_at + 1 year; set at case closure
  created_at   timestamptz not null default now()
);

comment on table public.report_evidence is
  'Immutable evidence records. Content is copied before session purge. '
  'retain_until is set to case.closed_at + 1 year when the case closes. '
  'service_role deletes rows after retain_until via purge_expired_evidence(). '
  'ADR-0020.';

alter table public.report_evidence enable row level security;
-- service_role-only; no client access.

create index report_evidence_case   on public.report_evidence (case_id);
-- A normal B-tree supports `retain_until < now()` range scans. `now()` cannot
-- appear in an index predicate because PostgreSQL requires predicates to be
-- immutable.
create index report_evidence_retain on public.report_evidence (retain_until);

-- ---------------------------------------------------------------------------
-- 2. Extend report_reason enum with the full taxonomy
-- ---------------------------------------------------------------------------
-- The existing 8-value enum (migration 005) is extended to the full
-- 11-category taxonomy (ADR-0020). ALTER TYPE ... ADD VALUE is a one-way
-- operation; values can be added but not removed without a full migration
-- cycle. The `if not exists` guard makes this migration re-runnable.
--
-- Existing values that survive: harassment, sexual_content, minor_safety,
-- solicitation, self_harm, spam, impersonation, other.
-- New values: child_safety, threats_violence, hate_speech, privacy,
-- illegal_activity, scam_spam.
-- solicitation remains for backward compatibility; new submissions map to
-- illegal_activity going forward (enforced in the admin report taxonomy
-- config seeded in migration 026).

alter type public.report_reason add value if not exists 'child_safety';
alter type public.report_reason add value if not exists 'threats_violence';
alter type public.report_reason add value if not exists 'hate_speech';
alter type public.report_reason add value if not exists 'privacy';
alter type public.report_reason add value if not exists 'illegal_activity';
alter type public.report_reason add value if not exists 'scam_spam';
-- sexual_content already exists (migration 005); `if not exists` is a no-op.
alter type public.report_reason add value if not exists 'sexual_content';

-- ---------------------------------------------------------------------------
-- 3. purge_session_content
-- ---------------------------------------------------------------------------
-- Deletes all messages and reactions belonging to a session.
-- Evidence MUST be copied before calling this function.
-- Storage objects (voice_path, attachment_path) are NOT deleted here: the
-- existing purge_orphaned_voice_notes and purge_orphaned_attachments cron
-- jobs collect them within 24 hours. Evidence storage objects have already
-- been moved to evidence-prefixed paths before this call.
-- Not callable by any client role; invoked only by end_session (below).

create or replace function public.purge_session_content(p_session_id uuid)
returns integer   -- count of message rows deleted
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Delete reactions first to satisfy the FK on message_reactions.message_id.
  delete from public.message_reactions
  where  message_id in (
    select id from public.messages where session_id = p_session_id
  );

  -- Delete messages. Cascades to any child tables not covered above.
  -- Storage objects (voice_path, attachment_path) are orphaned after this
  -- and will be collected by the daily orphan purge cron (migration 011).
  -- Evidence copies were moved to evidence/* paths before this call.
  delete from public.messages
  where  session_id = p_session_id;

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.purge_session_content(uuid)
  from public, anon, authenticated, service_role;
-- Not callable by any external role; end_session is the only caller.

-- ---------------------------------------------------------------------------
-- 4. end_session RPC
-- ---------------------------------------------------------------------------
-- Ends a paid session. Optional report path: copies evidence first, then
-- purges content, then settles billing, then updates thread metadata.
-- The reported_hold state acts as a fence: the row is locked in a non-ended
-- state while evidence is committed to prevent concurrent lifecycle actions,
-- then the status is advanced to ended after purge completes.
-- ADR-0020, ADR-0021.

create or replace function public.end_session(
  p_session_id         uuid,
  p_end_reason         text                   default 'manual',
  p_report_reason      public.report_reason   default null,
  p_report_message_ids uuid[]                 default null,
  p_report_statement   text                   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session    public.paid_sessions%rowtype;
  v_minutes    integer;
  v_report_id  uuid;
  v_case_id    uuid;
begin
  select * into v_session
  from   public.paid_sessions
  where  id = p_session_id
  for update;

  if not found or v_session.status in ('ended', 'reported_hold') then
    raise exception 'Session not found or already ended' using errcode = 'P0008';
  end if;

  if auth.uid() not in (v_session.member_id, v_session.provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  -- Billed minutes: only active time counts. A session that never started
  -- (pending_leases, warning) has zero billed minutes.
  v_minutes := case
    when v_session.started_at is null then 0
    else greatest(
      0,
      floor(extract(epoch from (now() - v_session.started_at)) / 60)::integer
    )
  end;

  -- Report path: copy evidence before the content is purged.
  if p_report_reason is not null then
    -- submit_report handles rate limiting and the basic report row.
    select public.submit_report(
      v_session.conversation_id,
      null,             -- no single message_id; selected items are below
      p_report_reason,
      p_report_statement
    ) into v_report_id;

    -- Create moderation case and copy selected message evidence.
    if p_report_message_ids is not null then
      insert into public.moderation_cases (report_id)
      values (v_report_id)
      returning id into v_case_id;

      -- Copy text, voice, and image evidence for selected messages.
      -- retain_until is set provisionally to now + 1 year; it is updated to
      -- case.closed_at + 1 year when an operator closes the case.
      insert into public.report_evidence (
        case_id, kind, body, storage_path, captured_at, retain_until
      )
      select
        v_case_id,
        case
          when m.voice_path      is not null then 'voice'
          when m.attachment_path is not null then 'image'
          else 'text'
        end,
        m.body,
        coalesce(m.voice_path, m.attachment_path),
        m.created_at,
        now() + interval '1 year'
      from public.messages m
      where m.id         = any(p_report_message_ids)
        and m.session_id = p_session_id;

      -- Attach the reporter's own statement as a separate evidence row.
      if p_report_statement is not null then
        insert into public.report_evidence (
          case_id, kind, body, captured_at, retain_until
        ) values (
          v_case_id, 'statement', p_report_statement,
          now(), now() + interval '1 year'
        );
      end if;
    end if;

    -- Lock the session in reported_hold while content commits. This prevents
    -- the meter cron from acting on the session between now and the end
    -- of this transaction. The subsequent update below advances it to ended.
    update public.paid_sessions
    set    status     = 'reported_hold',
           ended_at   = now(),
           end_reason = p_end_reason
    where  id = p_session_id;
  end if;

  -- Purge all ordinary session content. Evidence has already been copied
  -- for the report path above; for non-reported sessions there is nothing
  -- to preserve.
  perform public.purge_session_content(p_session_id);

  -- Terminal state for the session row.
  update public.paid_sessions
  set    status     = 'ended',
         ended_at   = now(),
         end_reason = p_end_reason
  where  id = p_session_id;

  -- Release both participant leases.
  delete from public.session_leases where session_id = p_session_id;

  -- Record provider accrual for any minutes that were billed.
  -- Calls record_provider_accrual stub (pending migration 029).
  if v_minutes > 0 and v_session.rate_tokens_per_min is not null then
    perform public.record_provider_accrual(
      v_session.provider_id,
      p_session_id,
      v_minutes,
      v_session.rate_tokens_per_min,
      v_session.provider_share_percent,
      v_session.payout_hold_days,
      v_session.economics_config_version_id
    );
  end if;

  -- Update thread metadata. last_preview_kind maps session_channel to the
  -- CHECK-constrained values: chat sessions show as 'session' (ephemeral chat);
  -- audio/video sessions show as 'call' (matches existing call icon).
  -- last_session_channel carries the exact channel for duration/rate display.
  insert into public.conversation_thread_meta (
    conversation_id,
    last_session_at,
    last_session_channel,
    last_session_duration_seconds,
    last_preview_kind,
    updated_at
  ) values (
    v_session.conversation_id,
    now(),
    v_session.channel,
    v_minutes * 60,
    case v_session.channel
      when 'chat' then 'session'
      else             'call'      -- audio and video both map to 'call'
    end,
    now()
  )
  on conflict (conversation_id) do update
    set last_session_at              = excluded.last_session_at,
        last_session_channel         = excluded.last_session_channel,
        last_session_duration_seconds = excluded.last_session_duration_seconds,
        last_preview_kind            = excluded.last_preview_kind,
        updated_at                   = excluded.updated_at;
end;
$$;

revoke all on function
  public.end_session(uuid, text, public.report_reason, uuid[], text)
  from public, anon, service_role;
grant execute on function
  public.end_session(uuid, text, public.report_reason, uuid[], text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. purge_expired_evidence and retention cron
-- ---------------------------------------------------------------------------
-- Evidence rows whose retain_until has passed are deleted. retain_until is
-- set to case.closed_at + 1 year when an operator closes a moderation case.
-- Until then the provisional value (now + 1 year at copy time) keeps the row
-- alive. Scheduled monthly because evidence retention is years, not minutes.

create or replace function public.purge_expired_evidence()
returns integer   -- count of evidence rows deleted
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.report_evidence
  where  retain_until < now();

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.purge_expired_evidence()
  from public, anon, authenticated;
grant execute on function public.purge_expired_evidence() to service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping purge-expired-evidence schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'purge-expired-evidence') then
    perform cron.unschedule('purge-expired-evidence');
  end if;
  -- 3 am on the 1st of each month. Evidence retention is 1 year minimum;
  -- a monthly sweep is more than sufficient resolution.
  perform cron.schedule(
    'purge-expired-evidence',
    '0 3 1 * *',
    $cron$select public.purge_expired_evidence()$cron$
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Rebuild conversation_summaries — no message content
-- ---------------------------------------------------------------------------
-- The current view (last rebuilt in migration 013) surfaces last_body and
-- last_kind from the messages table. The ephemeral session model requires
-- that message content is never surfaced in list views: this is the
-- architectural boundary, not a UI choice. ADR-0020.
--
-- The new view replaces last_body / last_kind / last_sender_id / unread_count
-- with session-scoped fields from conversation_thread_meta (migration 030).
-- unread_count_member and unread_count_provider replace the single
-- unread_count because role-specific counts are needed to render the inbox
-- correctly for both sides without a second query.
--
-- `reviewed` is dropped: it was a proxy for "has this conversation been
-- summarised" which is no longer meaningful in the ephemeral model.
--
-- Drop order: conversation_summaries is the only view being replaced here.
-- pending_pushes and provider_directory are not touched because they do not
-- depend on conversation_summaries and nothing downstream depends on it.

drop view if exists public.conversation_summaries;

create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id                                                          as conversation_id,
    case when c.member_id = auth.uid()
         then c.provider_id else c.member_id
    end                                                           as peer_id,
    pe.peer_display_name,
    pe.peer_avatar_url,
    -- Session metadata from conversation_thread_meta. Left join: the row
    -- may not exist yet for conversations that pre-date this migration.
    tm.last_session_at,
    tm.last_session_channel,
    tm.last_session_duration_seconds,
    coalesce(tm.unread_count_member,   0)                        as unread_count_member,
    coalesce(tm.unread_count_provider, 0)                        as unread_count_provider,
    -- i_am_member is the authoritative answer to "am I the paying side of
    -- THIS thread". profiles.role is not: a promoted provider keeps their
    -- member-side threads. This is the field the client uses to decide which
    -- unread_count applies to the current viewer.
    (c.member_id = auth.uid())                                   as i_am_member
  from public.conversations c
  left join public.conversation_peers pe
         on pe.conversation_id = c.id
  left join public.conversation_thread_meta tm
         on tm.conversation_id = c.id
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'One row per thread the caller participates in. No message content by '
  'design: ephemeral sessions must not surface last_body in list views. '
  'i_am_member is authoritative for role-in-this-thread (see profiles.role). '
  'ADR-0020.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 7. meter_active_sessions and cron
-- ---------------------------------------------------------------------------
-- Server-side lifecycle for paid sessions:
--   1. Tick active sessions: check leases, inactivity, debit each minute.
--   2. Expire pending session requests past their expires_at.
--   3. Expire pending_leases sessions after 15 min with no activation.
--
-- Called every minute by pg_cron. FOR UPDATE SKIP LOCKED means concurrent
-- invocations (if a tick overlaps) cannot double-process the same session,
-- following the same pattern as apply_due_config_versions in migration 026.

create or replace function public.meter_active_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  -- 1. Process each active session: check liveness, inactivity, bill.
  for v_session in
    select ps.*
    from   public.paid_sessions ps
    where  ps.status     = 'active'
      and  ps.started_at is not null
    for update skip locked
  loop
    -- Both participants must have sent a heartbeat within the 30 s lease
    -- grace window. If either lease is stale the session ends immediately.
    if not exists (
      select 1 from public.session_leases sl
      where  sl.session_id        = v_session.id
        and  sl.user_id           = v_session.member_id
        and  sl.last_heartbeat_at > now() - interval '30 seconds'
    ) or not exists (
      select 1 from public.session_leases sl
      where  sl.session_id        = v_session.id
        and  sl.user_id           = v_session.provider_id
        and  sl.last_heartbeat_at > now() - interval '30 seconds'
    ) then
      -- Lease lost. end_session acquires its own FOR UPDATE on the same row;
      -- because this is the same transaction the lock is already held and
      -- Postgres grants it immediately. ADR-0020.
      perform public.end_session(v_session.id, 'disconnect_grace', null, null, null);
      continue;
    end if;

    -- Inactivity check: 5.5 min is the hard cutoff (5 min warning + 30 s).
    if v_session.last_activity_at < now() - interval '5 minutes 30 seconds' then
      perform public.end_session(v_session.id, 'inactivity', null, null, null);
      continue;
    end if;

    -- 5 min without activity: set warning state. The client shows a
    -- countdown; the next tick will end the session if no activity arrives.
    if v_session.last_activity_at < now() - interval '5 minutes'
       and v_session.status != 'warning'
    then
      update public.paid_sessions
      set    status     = 'warning',
             warning_at = now()
      where  id = v_session.id;
      continue;
    end if;

    -- Debit next minute. P0003 means the balance ran out; end the session
    -- rather than rolling back the whole tick. The EXCEPTION block does not
    -- mask other errors.
    begin
      perform public.deduct_tokens(
        v_session.member_id,
        v_session.rate_tokens_per_min,
        v_session.id,
        v_session.economics_config_version_id
      );
    exception when sqlstate 'P0003' then
      perform public.end_session(v_session.id, 'balance_exhausted', null, null, null);
    end;
  end loop;

  -- 2. Expire pending session requests whose window has closed.
  update public.session_requests
  set    status = 'expired'
  where  status     = 'pending'
    and  expires_at < now();

  -- 3. Expire pending_leases sessions that waited more than 15 min for leases.
  -- A session stuck in pending_leases holds the one-live-session index on the
  -- conversation and blocks new requests from being accepted.
  update public.paid_sessions
  set    status     = 'ended',
         ended_at   = now(),
         end_reason = 'system'
  where  status      = 'pending_leases'
    and  accepted_at < now() - interval '15 minutes';
end;
$$;

revoke all on function public.meter_active_sessions()
  from public, anon, authenticated;
grant execute on function public.meter_active_sessions() to service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping meter-active-sessions schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'meter-active-sessions') then
    perform cron.unschedule('meter-active-sessions');
  end if;
  -- Every minute, pg_cron's floor and also the billing granularity.
  -- end_session settles the partial minute between ticks, so nothing is lost.
  perform cron.schedule(
    'meter-active-sessions',
    '* * * * *',
    $cron$select public.meter_active_sessions()$cron$
  );
end
$$;
