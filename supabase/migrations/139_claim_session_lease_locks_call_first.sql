-- ===========================================================================
-- 139  claim_session_lease takes the call lock before the session lock
-- ===========================================================================
--
-- Greptile on 138 (2026-09-24): SKIP LOCKED could skip the fallback's call
-- update while heartbeat_call (not only a hang-up) held the call row, leaving
-- a live call marked video while billed at the voice rate. The real fix is
-- lock ORDER: every other function touching both rows (end_call,
-- answer_call, respond_media_upgrade) locks the call and then the session.
-- claim_session_lease now does the same, so the fallback's call update never
-- waits on a lock held by a transaction that is itself waiting on the
-- session: no deadlock, and no skipped update. Body is 138's with only the
-- lock order and the fallback update changed. pgTAP asserts the order on the
-- live definition.
-- ---------------------------------------------------------------------------

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
  -- Lock order call → session (139), the order end_call, answer_call and
  -- respond_media_upgrade use. Taking the session first and the call later
  -- (136's fallback) could deadlock against them. The call_id read is
  -- unlocked; the call row lock is then taken before the session lock.
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

  -- M16: narrowed to the session's own two participants. Any other row for
  -- this session_id (planted or stale) no longer counts toward "present".
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
    begin
      perform public.deduct_tokens(
        v_session.member_id,
        v_session.rate_tokens_per_min,
        p_session_id,
        v_session.economics_config_version_id
      );
    exception when sqlstate 'P0003' then
      -- 136: a call switched to video BEFORE its session started may no
      -- longer afford the video rate at start (a chat minute in the same
      -- conversation can bill while the call connects). Fall back to voice,
      -- keep the call, and say why, rather than ending a call the member can
      -- still pay for.
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

        -- The call row is already locked (taken first, below), so this
        -- update never waits on another lock holder.
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

  -- Call heartbeat as activity (115): a lease claim on a non-chat session
  -- that is already billing counts as activity, unchanged by this migration.
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
  'Presence counts are restricted to the session''s own member_id/provider_id '
  '(migration 118) -- a stray or planted session_leases row for this session_id '
  'no longer counts as a participant. For an already-active call, also refreshes '
  'last_activity_at (115) -- the only activity signal a call-less-of-messages '
  'channel can produce. Migration 118, 2026-09-17.';
