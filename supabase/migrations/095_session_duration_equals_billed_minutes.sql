-- 095_session_duration_equals_billed_minutes.sql
--
-- Display / usage / wallet / billing must be one coherent chain — no two may
-- ever disagree. end_session was writing conversation_thread_meta
-- .last_session_duration_seconds from WALL-CLOCK time (v_minutes =
-- floor((now() - started_at)/60)), which can exceed the minutes actually
-- billed when a session had grace or lease gaps. The wallet debit and the
-- provider accrual both ride on paid_sessions.minutes_billed (the on-end
-- trigger accrue_ended_paid_session uses new.minutes_billed); the inbox
-- duration must ride on the SAME number.
--
-- This migration re-creates end_session VERBATIM from migration 045, changing
-- exactly one line: the duration written to thread metadata now uses
-- v_session.minutes_billed (locked FOR UPDATE at the top of the function, so it
-- is the final billed value) instead of the wall-clock v_minutes. No other
-- behaviour changes.

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

  -- Report path: copy evidence BEFORE the content is hidden. Evidence has its
  -- own separate, longer retention (migration 031) and is never affected by the
  -- 30-day content purge.
  if p_report_reason is not null then
    select public.submit_report(
      v_session.conversation_id,
      null,
      p_report_reason,
      p_report_statement
    ) into v_report_id;

    if p_report_message_ids is not null then
      insert into public.moderation_cases (report_id)
      values (v_report_id)
      returning id into v_case_id;

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

      if p_report_statement is not null then
        insert into public.report_evidence (
          case_id, kind, body, captured_at, retain_until
        ) values (
          v_case_id, 'statement', p_report_statement,
          now(), now() + interval '1 year'
        );
      end if;
    end if;

    -- Fence the session in reported_hold while evidence commits, exactly as
    -- migration 031 did.
    update public.paid_sessions
    set    status     = 'reported_hold',
           ended_at   = now(),
           end_reason = p_end_reason
    where  id = p_session_id;
  end if;

  -- Hide (not delete) all relevant content. It leaves both participants' apps
  -- immediately (RLS) and is retained server-side for 30 days, then purged by
  -- purge_expired_hidden_content(). A later session in the same conversation
  -- carries a different non-null session_id and is excluded.
  update public.messages
  set    hidden_at   = now(),
         purge_after = now() + interval '30 days'
  where  conversation_id = v_session.conversation_id
    and  hidden_at is null
    and  created_at <= now()
    and  (session_id = p_session_id or session_id is null);

  -- Terminal state for the session row.
  update public.paid_sessions
  set    status     = 'ended',
         ended_at   = now(),
         end_reason = p_end_reason
  where  id = p_session_id;

  -- Release both participant leases.
  delete from public.session_leases where session_id = p_session_id;

  -- Record provider accrual for any minutes that were billed.
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

  -- Update thread metadata (content-free): the inbox still shows peer, date,
  -- channel, duration. last_preview_kind maps chat→'session', calls→'call'.
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
    v_session.minutes_billed * 60,
    case v_session.channel
      when 'chat' then 'session'
      else             'call'
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
