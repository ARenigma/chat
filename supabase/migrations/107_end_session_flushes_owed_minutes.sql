-- 107_end_session_flushes_owed_minutes.sql
--
-- A call that ends a few seconds into a minute was under-billed by one minute.
--
-- Billing is two-phase (099 + 037): minute 1 is debited at media-connect by
-- claim_session_lease, which sets next_bill_at = now() + 1 minute; every later
-- minute is debited by meter_active_sessions, a pg_cron job that runs ONCE A
-- MINUTE on wall-clock boundaries. The product rule is started-minute (ceil): a
-- call running 1:10 has STARTED its second minute and owes 2.
--
-- The gap: when a session ends between its next_bill_at and the next cron tick,
-- end_session set status='ended' without collecting the owed minute, and
-- meter_active_sessions skips ended sessions (status in active/warning/grace). A
-- 1:10 call whose next_bill_at is at T+60s but whose cron tick had not yet landed
-- by the T+70s hangup lost minute 2 entirely. The race window is 0-60s, so it is
-- hit constantly.
--
-- Fix: before end_session sets the terminal state, run the SAME flush loop
-- meter_active_sessions runs — bill every minute whose next_bill_at has already
-- passed. This re-creates end_session VERBATIM from migration 095, adding exactly
-- that loop after the participant check. Everything downstream is already
-- correct and needs no change:
--   * record_provider_accrual (037) counts actual usage_debit rows, so it picks
--     up the flushed minute automatically.
--   * the accrue_ended_paid_session trigger reads new.minutes_billed AFTER this
--     function's UPDATE ... status='ended', which now runs after the flush.
--   * the thread duration (last_session_duration_seconds) rides on
--     v_session.minutes_billed, which the loop refreshes via `returning * into`.
--
-- On P0003 (insufficient balance) the loop simply exits — unlike
-- meter_active_sessions it does NOT call end_session (it is already inside it) —
-- and the session ends on whatever minutes were collected, which is the same
-- balance-exhausted outcome the meter produces.

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

  -- Flush owed-but-uncollected minutes before ending (107). The same loop
  -- meter_active_sessions (037) runs: any minute whose next_bill_at has already
  -- passed is billed now, so a call ending between a bill boundary and the next
  -- cron tick still charges the started minute. Loops at most a handful of times
  -- (one per un-metered minute), typically once. A never-started session has a
  -- null next_bill_at and skips the loop entirely.
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
          next_bill_at   = next_bill_at + interval '1 minute'
      where id = v_session.id
      returning * into v_session;
    exception when sqlstate 'P0003' then
      -- Balance exhausted: stop billing and let the session end on the minutes
      -- already collected. Not a recursive end_session — we are inside it.
      exit;
    end;
  end loop;

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
