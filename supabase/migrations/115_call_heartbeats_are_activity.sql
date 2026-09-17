-- Every call was force-ended at ~5m30s as "inactivity". Telegram-CTO audit,
-- 2026-09-17, confirmed CRITICAL by adversarial verification against
-- ADR-0020 itself.
--
-- meter_active_sessions (037, unchanged since) ends any active session whose
-- last_activity_at is older than 5m30s, with no channel predicate:
--
--   if v_session.last_activity_at < now() - interval '5 minutes 30 seconds'
--   then perform public.end_session(v_session.id, 'inactivity', ...);
--
-- last_activity_at had exactly two writers: claim_session_lease, once, at
-- activation (below); and touch_session_activity, an AFTER INSERT trigger on
-- `messages` (037). A call sends no messages -- CallScreen has no composer --
-- so the clock never advanced past the moment media connected. Migration 030
-- DID refresh last_activity_at on every lease claim; the 037 and 099
-- rewrites of claim_session_lease dropped that refresh, and nothing else
-- replaced it for a channel where "activity" cannot mean typing.
--
-- ADR-0020 already specifies the correct rule and this migration was
-- refuted-then-confirmed against it, not invented from scratch:
--
--   Text sessions: "5-minute inactivity timer; 30-second warning..."
--   Calls:         "90 seconds of silence (no audio detected on either side)."
--
-- Real per-side audio-silence detection is a bigger feature than this
-- migration -- it needs Agora's audio-volume callbacks wired through to the
-- server, which nothing here does yet. What this migration closes is the
-- immediate defect: a call was being held to the TEXT rule by accident, not
-- by design, and every call over ~6 minutes was cut off mid-sentence and
-- capped per-call revenue on a per-minute product. The fix ties
-- last_activity_at to the same 10-second heartbeat useSessionLease already
-- sends throughout a connected call (src/api/sessions.ts,
-- HEARTBEAT_INTERVAL_MS) -- the identical liveness signal the
-- disconnect_grace branch two lines above already trusts to decide whether a
-- call is still going. A call whose media has genuinely died stops
-- heartbeating and is caught by disconnect_grace's 30-second window, same as
-- today; a call that is simply quiet no longer looks inactive to a rule that
-- was only ever meant to watch typing.
--
-- Scoped to `channel <> 'chat'` so the text-session inactivity timer -- a
-- real, documented, ADR-specified 5-minute product decision -- is untouched.
-- A chat session's last_activity_at still only moves on a message.
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

    -- A CALL just became real. The chat session it supersedes ends NOW.
    -- (Unchanged from 099 -- see that migration for why this line is here.)
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

  -- THE FIX. A call heartbeat (any lease claim on a non-chat session that is
  -- already billing) counts as activity, exactly as ADR-0020 requires and as
  -- 030 used to do before 037/099 dropped it. Also clears a stale
  -- 'warning'/'grace' status the same way touch_session_activity does for
  -- chat (037): a heartbeat that arrives late but still arrives should
  -- un-warn the session, not leave it flagged until the next cron tick
  -- happens to notice last_activity_at moved.
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
  'Upserts a per-user session_leases heartbeat and activates a pending call once '
  'both sides hold a live lease (both media leases for a non-chat channel). '
  'For an already-active call, also refreshes last_activity_at -- the only '
  'activity signal a callless-of-messages channel can produce -- so '
  'meter_active_sessions'' 5m30s inactivity timer (built for chat, where '
  'activity means typing) does not end a call that is simply talking. '
  'Migration 115, 2026-09-17.';
