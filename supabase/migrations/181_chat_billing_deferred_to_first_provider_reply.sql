-- ===========================================================================
-- 181  Chat billing deferred to first provider reply
-- ===========================================================================
-- Prior state (139/107): claim_session_lease debited minute 1 the moment both
-- session_leases arrived for a chat session, regardless of whether the provider
-- had said anything.  meter_active_sessions then billed subsequent minutes.
-- Verified on session a2ea9455-0074-4ae4-b60a-716eef4c1ed2: provider vanished
-- ~60 s in with zero in-session messages yet 3 minutes were billed.
--
-- Approved rule — CHAT channel only; voice/video (audio/video) unchanged:
--
--  1. No charge until the provider replies.
--     claim_session_lease activates a chat session (status → active,
--     started_at = now()) but writes minutes_billed = 0, tokens_debited = 0,
--     next_bill_at = null — no deduct_tokens call.  The first debit is
--     triggered by the first in-session message from the provider: the
--     touch_session_activity trigger (messages AFTER INSERT) acquires a
--     SELECT FOR UPDATE on paid_sessions, re-confirms next_bill_at IS NULL
--     after the lock (preventing a concurrent message from double-billing),
--     calls deduct_tokens for minute 1, and sets
--     next_bill_at = now() + 1 minute.  meter_active_sessions then takes
--     over for subsequent minutes exactly as today.
--     If the session ends before any provider message: 0 tokens debited,
--     minutes_billed = 0, record_provider_accrual finds 0 usage_debit rows
--     and writes no earnings row (existing idempotency in that function).
--
--  2. Never bill past a disconnect.
--     end_session called with end_reason = 'disconnect_grace' now captures
--     min(last_heartbeat_at) across both participant leases BEFORE deleting
--     them, then refuses to enter the flush loop for any minute whose
--     next_bill_at > that cutoff.  The meter already issues `continue` before
--     its own billing loop when a lease is stale (so the meter itself never
--     bills an extra minute for the session it is disconnecting), meaning only
--     end_session needed this guard.
--
--  3. All existing invariants preserved.
--     deduct_tokens remains the sole debit path; every balance change has a
--     token_transactions row; provider accrual counts actual usage_debit rows
--     (record_provider_accrual, 037) so a 0-debit chat session writes no
--     earnings; the double-charge guard in record_provider_accrual (session_id
--     check in provider_earnings_ledger) is unaffected.  Grants for the three
--     rewritten functions are copied verbatim from their last definition.
--
-- Functions rewritten: claim_session_lease (from 139), touch_session_activity
-- (from 037), end_session (from 107).  meter_active_sessions is NOT changed.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. claim_session_lease — chat activation no longer debits minute 1
-- ---------------------------------------------------------------------------
-- Body copied from migration 139 with one change: the activation branch is
-- split on channel.  For 'chat' the deduct_tokens + fallback block is removed;
-- minutes_billed, tokens_debited, and next_bill_at start at 0 / null.
-- For audio/video the path is unchanged (minute 1 prepaid at activation).
-- The call-lock-before-session-lock order (139) is preserved.

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
  v_voice_rate  integer;
  v_call_id     uuid;
begin
  -- Lock order: call → session (139). Taking the session first and the call
  -- later could deadlock against end_call / answer_call / respond_media_upgrade,
  -- which all lock in this order. The call_id read is unlocked; the call row
  -- lock is then taken before the session lock.
  select call_id into v_call_id
  from public.paid_sessions
  where id = p_session_id;
  if v_call_id is not null then
    perform 1 from public.calls where id = v_call_id for update;
  end if;

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

  -- Narrowed to the session's own two participants (118): stray / planted rows
  -- for this session_id no longer count toward "present".
  select count(*) = 2 into v_both_leases
  from public.session_leases
  where session_id = p_session_id
    and user_id in (v_session.member_id, v_session.provider_id)
    and last_heartbeat_at > now() - interval '30 seconds';

  select count(*) = 2 into v_both_media
  from public.session_leases
  where session_id = p_session_id
    and user_id in (v_session.member_id, v_session.provider_id)
    and kind = 'connected'
    and last_heartbeat_at > now() - interval '30 seconds';

  if v_session.status = 'pending_leases'
     and v_both_leases
     and (v_session.channel = 'chat' or v_both_media)
  then
    -- 181: Chat billing is deferred to the provider's first in-session
    -- message (touch_session_activity trigger).  No deduct_tokens call here;
    -- next_bill_at starts null so the meter never bills an un-started session.
    if v_session.channel = 'chat' then
      update public.paid_sessions
      set status           = 'active',
          started_at       = now(),
          last_activity_at = now(),
          minutes_billed   = 0,
          tokens_debited   = 0,
          next_bill_at     = null
      where id = p_session_id;

    else
      -- Audio / video: minute 1 is prepaid at activation (unchanged from 139).
      begin
        perform public.deduct_tokens(
          v_session.member_id,
          v_session.rate_tokens_per_min,
          p_session_id,
          v_session.economics_config_version_id
        );
      exception when sqlstate 'P0003' then
        -- 136: a call switched to video BEFORE its session started may no
        -- longer afford the video rate. Fall back to voice, keep the call.
        if v_session.channel = 'video'
           and exists (
             select 1 from public.calls
             where id = v_session.call_id
               and medium = 'video'::public.call_medium
               and upgrade_result = 'accepted'
           )
        then
          v_voice_rate := public.session_voice_rate(p_session_id);
          begin
            perform public.deduct_tokens(
              v_session.member_id,
              v_voice_rate,
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
          set rate_tokens_per_min = v_voice_rate,
              channel             = 'audio'
          where id = p_session_id;

          -- Call row already locked (taken first, above).
          update public.calls
          set medium              = 'voice'::public.call_medium,
              upgrade_result      = 'insufficient_balance',
              upgrade_resolved_at = now()
          where id = v_session.call_id;
        else
          perform public.end_session(
            p_session_id, 'balance_exhausted', null, null, null
          );
          return 'ended';
        end if;
      end;

      update public.paid_sessions
      set status           = 'active',
          started_at       = now(),
          last_activity_at = now(),
          minutes_billed   = 1,
          tokens_debited   = rate_tokens_per_min,
          next_bill_at     = now() + interval '1 minute'
      where id = p_session_id;
    end if;

    -- A call just became real. The chat session it supersedes ends NOW.
    -- (Only possible when channel is audio/video — the channel = 'chat' branch
    -- above cannot reach this block.)
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

  -- Call heartbeat as activity (115): a lease claim on a non-chat session
  -- that is already billing counts as activity.
  if v_session.channel <> 'chat' and v_session.status in ('active', 'warning', 'grace') then
    update public.paid_sessions
    set last_activity_at = now(),
        status = case
          when status in ('warning', 'grace') then 'active'::public.paid_session_status
          else status
        end,
        warning_at = null
    where id = p_session_id;
  end if;

  return v_session.status::text;
end;
$$;

comment on function public.claim_session_lease(uuid, public.lease_kind) is
  'Upserts a per-user session_leases heartbeat and activates a pending session '
  'once both sides hold a live lease (both media leases for non-chat channels). '
  'For chat (181): activation sets next_bill_at = null and minutes_billed = 0; '
  'minute 1 is debited in touch_session_activity when the provider first replies. '
  'For audio/video: minute 1 is prepaid at activation as before (139). '
  'Lock order: call then session (139), matching end_call / answer_call / '
  'respond_media_upgrade. Presence restricted to session''s own participants (118).';


-- ---------------------------------------------------------------------------
-- 2. touch_session_activity — first provider message starts chat billing
-- ---------------------------------------------------------------------------
-- Body extended from migration 037. A SELECT FOR UPDATE on paid_sessions is
-- taken up-front so that concurrent message inserts in the same session cannot
-- race to double-bill minute 1. After acquiring the lock the billing gate is
-- re-confirmed: channel = 'chat' AND next_bill_at IS NULL AND sender =
-- provider_id. Only the first message that wins the lock bills; subsequent
-- messages find next_bill_at already set and fall through to the activity touch.
-- On P0003 (balance exhausted at minute 1) the session is ended immediately
-- inside the trigger; auth.uid() = the sending provider at this point.

create or replace function public.touch_session_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.paid_sessions%rowtype;
begin
  if new.session_id is null then
    return new;
  end if;

  -- Acquire a row lock before reading billing state. This is the race-safety
  -- guarantee: only the transaction that wins the lock can see next_bill_at IS
  -- NULL and proceed to debit; every other concurrent insert sees the updated
  -- next_bill_at and falls through to the plain activity touch.
  select * into v_session
  from public.paid_sessions
  where id = new.session_id
    and status in ('active', 'warning', 'grace')
  for update;

  if not found then
    return new;
  end if;

  -- 181: First in-session message from the provider starts billing for chat.
  -- Conditions (all must hold after the lock):
  --   • channel is 'chat'
  --   • next_bill_at is still null (billing not yet started; re-checked after lock)
  --   • minutes_billed = 0 — belt-and-suspenders: next_bill_at alone could be
  --     null on a pre-migration session that already billed (minutes_billed > 0
  --     but next_bill_at was never set correctly), or on test fixtures that
  --     intentionally model mid-session state. Either way, if minutes_billed > 0
  --     billing has already occurred and we must not re-bill.
  --   • the message sender is the provider
  if v_session.channel = 'chat'
     and v_session.next_bill_at is null
     and v_session.minutes_billed = 0
     and new.sender_id = v_session.provider_id
  then
    begin
      perform public.deduct_tokens(
        v_session.member_id,
        v_session.rate_tokens_per_min,
        v_session.id,
        v_session.economics_config_version_id
      );

      update public.paid_sessions
      set last_activity_at = now(),
          status           = case
            when status in ('warning', 'grace') then 'active'::public.paid_session_status
            else status
          end,
          warning_at       = null,
          minutes_billed   = 1,
          tokens_debited   = rate_tokens_per_min,
          next_bill_at     = now() + interval '1 minute'
      where id = v_session.id;

      return new;
    exception when sqlstate 'P0003' then
      -- Balance exhausted exactly at the first-message billing point.
      -- end_session is re-entrant under our FOR UPDATE lock (same transaction,
      -- same lock holder). auth.uid() is the provider_id here (send_message is
      -- authenticated), satisfying end_session's participant check.
      perform public.end_session(v_session.id, 'balance_exhausted', null, null, null);
      return new;
    end;
  end if;

  -- Default path (unchanged from 037): touch last_activity_at and clear
  -- warning/grace for any active session, regardless of channel.
  update public.paid_sessions
  set last_activity_at = now(),
      status = case
        when status in ('warning', 'grace') then 'active'::public.paid_session_status
        else status
      end,
      warning_at = null
  where id = new.session_id
    and status in ('active', 'warning', 'grace');

  return new;
end;
$$;

-- Trigger already exists from 037; recreate to pick up the new function body.
drop trigger if exists messages_touch_session_activity on public.messages;
create trigger messages_touch_session_activity
after insert on public.messages
for each row execute function public.touch_session_activity();


-- ---------------------------------------------------------------------------
-- 3. end_session — disconnect_grace flush stops at the stale heartbeat cutoff
-- ---------------------------------------------------------------------------
-- Body copied from migration 107 with one targeted addition:
--   • A v_stale_cutoff timestamptz variable.
--   • When p_end_reason = 'disconnect_grace', the minimum last_heartbeat_at
--     across both participant leases is captured BEFORE the leases are deleted.
--   • The flush loop exits early when next_bill_at > v_stale_cutoff, so a
--     minute that began after one party's last heartbeat is never collected.
-- All other paths (manual end, balance_exhausted, inactivity, etc.) are
-- unchanged: v_stale_cutoff remains null and the loop guard is never active.

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
  v_session       public.paid_sessions%rowtype;
  v_minutes       integer;
  v_report_id     uuid;
  v_case_id       uuid;
  v_stale_cutoff  timestamptz;  -- 181: earliest stale heartbeat for disconnect_grace
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

  -- 181: For disconnect_grace ends, determine the earliest stale heartbeat
  -- across both participants before the leases are deleted.  The flush loop
  -- below will not collect any minute whose next_bill_at is later than this
  -- cutoff — i.e. a minute that began after one party's connection died.
  -- For all other end_reason values v_stale_cutoff remains null and the guard
  -- in the loop condition is never active (existing behaviour preserved).
  if p_end_reason = 'disconnect_grace' then
    select min(last_heartbeat_at)
    into   v_stale_cutoff
    from   public.session_leases
    where  session_id = p_session_id
      and  user_id in (v_session.member_id, v_session.provider_id);
  end if;

  -- Flush owed-but-uncollected minutes before ending (107). The same loop
  -- meter_active_sessions (037) runs: any minute whose next_bill_at has already
  -- passed is billed now, so a session ending between a bill boundary and the
  -- next cron tick still charges the started minute.
  -- 181 addition: when v_stale_cutoff is set (disconnect_grace), the loop exits
  -- the moment next_bill_at exceeds the cutoff — no charge for time after the
  -- disconnect. A never-started chat session has next_bill_at = null and skips
  -- the loop entirely (null comparison is false, not true).
  while v_session.next_bill_at is not null
        and v_session.next_bill_at <= now()
        and (v_stale_cutoff is null or v_session.next_bill_at <= v_stale_cutoff)
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
      -- Balance exhausted mid-flush: stop billing and let the session end on
      -- the minutes already collected. Not a recursive end_session — we are
      -- inside it.
      exit;
    end;
  end loop;

  -- Billed minutes: only active time counts. A session that never started
  -- (pending_leases) or whose billing never began (chat, no provider message)
  -- has zero billed minutes.
  v_minutes := case
    when v_session.started_at is null then 0
    else greatest(
      0,
      floor(extract(epoch from (now() - v_session.started_at)) / 60)::integer
    )
  end;

  -- Report path: copy evidence BEFORE the content is hidden.
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

    update public.paid_sessions
    set    status     = 'reported_hold',
           ended_at   = now(),
           end_reason = p_end_reason
    where  id = p_session_id;
  end if;

  -- Hide (not delete) all relevant content.
  update public.messages
  set    hidden_at   = now(),
         purge_after = now() + interval '30 days'
  where  conversation_id = v_session.conversation_id
    and  hidden_at is null
    and  created_at <= now()
    and  (session_id = p_session_id or session_id is null);

  -- Terminal state.
  update public.paid_sessions
  set    status     = 'ended',
         ended_at   = now(),
         end_reason = p_end_reason
  where  id = p_session_id;

  -- Release both participant leases.
  delete from public.session_leases where session_id = p_session_id;

  -- Record provider accrual for any minutes that were billed.
  -- record_provider_accrual counts actual usage_debit rows (037), so a
  -- 0-debit chat session (no provider message) writes no earnings row.
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

  -- Update thread metadata.
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
    set last_session_at               = excluded.last_session_at,
        last_session_channel          = excluded.last_session_channel,
        last_session_duration_seconds = excluded.last_session_duration_seconds,
        last_preview_kind             = excluded.last_preview_kind,
        updated_at                    = excluded.updated_at;
end;
$$;

-- Grants are unchanged from 107/139: authenticated callers can end their own
-- session; the function's own participant check enforces the restriction.
-- No new grants added (153: new functions start closed).
revoke all on function public.end_session(uuid, text, public.report_reason, uuid[], text)
  from public, anon;
grant execute on function public.end_session(uuid, text, public.report_reason, uuid[], text)
  to authenticated, service_role;

revoke all on function public.claim_session_lease(uuid, public.lease_kind)
  from public, anon;
grant execute on function public.claim_session_lease(uuid, public.lease_kind)
  to authenticated;
