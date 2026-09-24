-- ===========================================================================
-- 137  The video kill switch stops a switch that is already in flight
-- ===========================================================================
--
-- Greptile on 135 (2026-09-24): request_media_upgrade checks
-- video_calls_enabled, but acceptance did not, so turning video off in admin
-- could not stop a request made moments earlier. Acceptance now re-checks it
-- and resolves the request as declined with VIDEO_DISABLED. The rest of the
-- function is 135's body unchanged.
-- ---------------------------------------------------------------------------

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
        upgrade_result       = 'declined',
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
  'The other party accepts or declines a voice → video switch (132, 134, 135, '
  '137). Refused while video is kill-switched. A started session is charged '
  'only (video − voice) for the prepaid current minute; a pending one starts '
  'at the video rate if the member can afford it.';

revoke all on function public.respond_media_upgrade(uuid, boolean) from public, anon;
grant execute on function public.respond_media_upgrade(uuid, boolean) to authenticated;
