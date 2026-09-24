-- ===========================================================================
-- 138  Voice fallback can't deadlock a hang-up; kill switch has its own outcome
-- ===========================================================================
--
-- Greptile on 136/137 (2026-09-24):
--
-- 1. claim_session_lease holds the paid_sessions row lock and, in 136's voice
--    fallback, then updated the call. end_call takes the call and then the
--    session: opposite orders, so the two could deadlock and Postgres would
--    abort one. The fallback now takes the call lock with SKIP LOCKED.
--
-- 2. 137 recorded a kill-switch refusal as 'declined', so the requester was
--    told the peer would rather stay on voice. It is now 'video_disabled'.
--
-- Both functions are the previous bodies (136, 137) with only those lines
-- changed.
-- ---------------------------------------------------------------------------

alter table public.calls drop constraint if exists calls_upgrade_result_check;
alter table public.calls
  add constraint calls_upgrade_result_check
  check (upgrade_result in ('accepted', 'declined', 'expired', 'insufficient_balance', 'video_disabled'));

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

        -- SKIP LOCKED (138): end_call locks the call and then the session,
        -- the opposite order to this function. If a hang-up holds the call
        -- row, the call is ending anyway; skipping never waits, so the two
        -- can't deadlock.
        perform 1 from public.calls
        where id = v_session.call_id
        for update skip locked;
        if found then
          update public.calls
          set medium              = 'voice'::public.call_medium,
              upgrade_result      = 'insufficient_balance',
              upgrade_resolved_at = now()
          where id = v_session.call_id;
        end if;
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

create or replace function public.respond_media_upgrade(
  p_call_id uuid,
  p_accept  boolean
)
returns jsonb
language plpgsql security definer set search_path = public, admin
as $$
declare
  v_uid        uuid := auth.uid();
  v_call       public.calls%rowtype;
  v_session    public.paid_sessions%rowtype;
  v_video_rate integer;
  v_delta      integer := 0;
  v_controls   jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select * into v_call
  from public.calls
  where id = p_call_id
    and status = 'active'
    and (caller_id = v_uid or callee_id = v_uid)
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if v_call.upgrade_requested_by is null then
    return jsonb_build_object('success', false, 'error', 'NO_UPGRADE_PENDING');
  end if;

  -- Consent is the OTHER party's to give.
  if v_call.upgrade_requested_by = v_uid then
    return jsonb_build_object('success', false, 'error', 'NOT_YOUR_REQUEST');
  end if;

  if v_call.upgrade_requested_at < now() - interval '30 seconds' then
    update public.calls
    set upgrade_requested_by = null,
        upgrade_to_medium    = null,
        upgrade_requested_at = null,
        upgrade_result       = 'expired',
        upgrade_resolved_at  = now()
    where id = p_call_id;
    return jsonb_build_object('success', false, 'error', 'EXPIRED');
  end if;

  if not p_accept then
    update public.calls
    set upgrade_requested_by = null,
        upgrade_to_medium    = null,
        upgrade_requested_at = null,
        upgrade_result       = 'declined',
        upgrade_resolved_at  = now()
    where id = p_call_id;
    return jsonb_build_object('success', true, 'accepted', false);
  end if;

  -- The video kill switch applies to a switch in flight, not only to a new
  -- request (137): an admin turning video off stops pending acceptances.
  select payload into v_controls
  from admin.config_active
  where domain = 'kill_switches' and environment = 'prod';

  if not coalesce(
       (v_controls ->> 'video_calls_enabled')::boolean,
       (v_controls ->> 'calls_enabled')::boolean,
       true) then
    update public.calls
    set upgrade_requested_by = null,
        upgrade_to_medium    = null,
        upgrade_requested_at = null,
        upgrade_result       = 'video_disabled',
        upgrade_resolved_at  = now()
    where id = p_call_id;
    return jsonb_build_object('success', false, 'error', 'VIDEO_DISABLED');
  end if;

  select * into v_session
  from public.paid_sessions
  where call_id = p_call_id
    and status in ('pending_leases', 'active', 'warning', 'grace')
  for update;

  -- Not started yet (leases not both connected): nothing has been charged,
  -- so the session simply starts at the video rate — its first minute is
  -- charged by the start transition (118) at whatever rate the row holds.
  if found and v_session.status = 'pending_leases' then
    -- The start transition (118) charges the first minute at the row's rate
    -- and ENDS the session if that debit fails, so a member who can afford
    -- voice but not video must be refused here, not dropped at start.
    v_video_rate := public.session_video_rate(v_session.id);
    if (select promo_balance + purchased_balance
          from public.profiles where id = v_session.member_id)
       < greatest(v_session.rate_tokens_per_min, coalesce(v_video_rate, 0)) then
      update public.calls
      set upgrade_requested_by = null,
          upgrade_to_medium    = null,
          upgrade_requested_at = null,
          upgrade_result       = 'insufficient_balance',
          upgrade_resolved_at  = now()
      where id = p_call_id;
      return jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    end if;

    update public.paid_sessions
    set rate_tokens_per_min = greatest(rate_tokens_per_min, coalesce(public.session_video_rate(v_session.id), 0)),
        channel             = 'video'
    where id = v_session.id;
  elsif found then
    -- Bring the prepaid clock up to date at the VOICE rate first, exactly as
    -- end_session does (107). If the metering tick is lagging, the minute in
    -- progress is not yet paid; without this flush it would later be billed at
    -- the full video rate on top of the difference charged below.
    begin
      while v_session.next_bill_at is not null
            and v_session.next_bill_at <= now()
      loop
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
      end loop;
    exception when sqlstate 'P0003' then
      update public.calls
      set upgrade_requested_by = null,
          upgrade_to_medium    = null,
          upgrade_requested_at = null,
          upgrade_result       = 'insufficient_balance',
          upgrade_resolved_at  = now()
      where id = p_call_id;
      return jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    end;

    v_video_rate := public.session_video_rate(v_session.id);
    v_delta := greatest(0, coalesce(v_video_rate, 0) - v_session.rate_tokens_per_min);

    -- The current minute is already prepaid at the voice rate: charge only
    -- the difference for it. Later minutes bill at the video rate.
    if v_delta > 0 then
      begin
        perform public.deduct_tokens(
          v_session.member_id,
          v_delta,
          v_session.id,
          v_session.economics_config_version_id
        );
      exception when sqlstate 'P0003' then
        update public.calls
        set upgrade_requested_by = null,
            upgrade_to_medium    = null,
            upgrade_requested_at = null,
            upgrade_result       = 'insufficient_balance',
            upgrade_resolved_at  = now()
        where id = p_call_id;
        return jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
      end;
    end if;

    update public.paid_sessions
    set rate_tokens_per_min = greatest(rate_tokens_per_min, v_video_rate),
        tokens_debited      = tokens_debited + v_delta,
        channel             = 'video'
    where id = v_session.id;
  end if;

  update public.calls
  set medium               = 'video'::public.call_medium,
      upgrade_requested_by = null,
      upgrade_to_medium    = null,
      upgrade_requested_at = null,
      upgrade_result       = 'accepted',
      upgrade_resolved_at  = now()
  where id = p_call_id;

  return jsonb_build_object(
    'success', true,
    'accepted', true,
    'new_medium', 'video',
    'charged_now', v_delta
  );
end;
$$;

comment on function public.respond_media_upgrade(uuid, boolean) is
  'The other party accepts or declines a voice → video switch (132-138). '
  'Refused while video is kill-switched. A started session is charged only '
  '(video − voice) for the prepaid current minute; a pending one starts at the '
  'video rate if the member can afford it.';

revoke all on function public.respond_media_upgrade(uuid, boolean) from public, anon;
grant execute on function public.respond_media_upgrade(uuid, boolean) to authenticated;
