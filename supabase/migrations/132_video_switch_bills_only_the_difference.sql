-- ===========================================================================
-- 132  Voice → video switch that works, and bills only the difference
-- ===========================================================================
--
-- 123 shipped an in-place upgrade that could never succeed and would have
-- mis-billed if it had:
--
--   * `calls.medium` is the enum call_medium ('voice','video') (011:674), but
--     123 compared it to a text parameter and wrote text into it, and used
--     'audio', which is not a call_medium value. Every request raised, and the
--     client showed nothing because NoticeBar was not mounted.
--   * The accept path looked up `tokens_per_minute_*` keys that do not exist;
--     the economics keys are `<chat|audio|video>_rate_tokens_per_min`
--     (029:143-145).
--   * The requester could accept their own request, skipping the peer's
--     consent.
--   * Changing `rate_tokens_per_min` mid-session broke provider accrual:
--     record_provider_accrual (037) paid `count(usage_debit rows) x FINAL rate`,
--     so every voice minute before the switch would have been paid out at the
--     video rate.
--
-- Billing rule (Amit, 2026-09-24): "don't double charge when switched, just
-- add the overhead to that minute and onwards." Minutes are PREPAID
-- (meter_active_sessions debits the next minute at next_bill_at), so at the
-- moment of the switch the current minute is already paid at the voice rate.
-- On accept we debit only (video_rate - voice_rate) for that minute, then the
-- session's rate becomes the video rate for every later minute. Total cost of
-- a call = voice minutes before the switch + video minutes from the switch
-- minute on; nothing is paid twice.
--
-- The video rate comes from the SAME economics config version the session
-- was priced with (ADR-0021: no mid-session drift from an admin publish),
-- falling back to the active config only if that version has no video rate.
--
-- Upgrades only go voice → video (074's product decision stands: video is
-- always an upgrade; turning the camera off is a local toggle, not a
-- renegotiation, and never lowers the rate).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Upgrade columns speak call_medium, and record the outcome
-- ---------------------------------------------------------------------------

-- No live request can be mid-flight: every request_media_upgrade call raised
-- before writing (the enum comparison fails first), so these are all null.
update public.calls
set upgrade_requested_by = null,
    upgrade_to_medium    = null,
    upgrade_requested_at = null
where upgrade_to_medium is not null;

alter table public.calls
  drop constraint if exists calls_upgrade_to_medium_check;

alter table public.calls
  alter column upgrade_to_medium type public.call_medium
  using (case upgrade_to_medium when 'audio' then 'voice' else upgrade_to_medium end)::public.call_medium;

-- The requester's device learns the outcome from these (Realtime UPDATE on
-- the calls row). 123 only told the recipient, so the requester's button sat
-- on "Requesting" forever.
alter table public.calls
  add column if not exists upgrade_result text
    check (upgrade_result in ('accepted', 'declined', 'expired', 'insufficient_balance')),
  add column if not exists upgrade_resolved_at timestamptz;

comment on column public.calls.upgrade_result is
  'Outcome of the last in-place media upgrade request (132). Cleared when a '
  'new request is made.';

-- ---------------------------------------------------------------------------
-- 2. The video rate for a live session
-- ---------------------------------------------------------------------------

create or replace function public.session_video_rate(p_session_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, admin
as $$
declare
  v_rate integer;
begin
  select (cv.payload ->> 'video_rate_tokens_per_min')::integer
  into v_rate
  from public.paid_sessions ps
  join admin.config_versions cv on cv.id = ps.economics_config_version_id
  where ps.id = p_session_id;

  if v_rate is null or v_rate <= 0 then
    select s.rate_tokens_per_min into v_rate
    from public.get_session_billing_snapshot('video') s;
  end if;

  return v_rate;
end;
$$;

comment on function public.session_video_rate(uuid) is
  'Video per-minute rate for a live session: from the economics config version '
  'the session was priced with, else the active config (132).';

revoke all on function public.session_video_rate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. request_media_upgrade — voice → video only
-- ---------------------------------------------------------------------------

drop function if exists public.request_media_upgrade(uuid, text);

create or replace function public.request_media_upgrade(
  p_call_id   uuid,
  p_to_medium text
)
returns jsonb
language plpgsql security definer set search_path = public, admin
as $$
declare
  v_uid      uuid := auth.uid();
  v_call     public.calls%rowtype;
  v_controls jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_to_medium is distinct from 'video' then
    return jsonb_build_object('success', false, 'error', 'INVALID_MEDIUM');
  end if;

  select payload into v_controls
  from admin.config_active
  where domain = 'kill_switches' and environment = 'prod';

  if not coalesce(
       (v_controls ->> 'video_calls_enabled')::boolean,
       (v_controls ->> 'calls_enabled')::boolean,
       true) then
    return jsonb_build_object('success', false, 'error', 'VIDEO_DISABLED');
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

  if v_call.medium = 'video'::public.call_medium then
    return jsonb_build_object('success', false, 'error', 'ALREADY_IN_MEDIUM');
  end if;

  if v_call.upgrade_requested_at is not null
     and v_call.upgrade_requested_at > now() - interval '30 seconds' then
    return jsonb_build_object('success', false, 'error', 'UPGRADE_PENDING');
  end if;

  update public.calls
  set upgrade_requested_by = v_uid,
      upgrade_to_medium    = 'video'::public.call_medium,
      upgrade_requested_at = now(),
      upgrade_result       = null,
      upgrade_resolved_at  = null
  where id = p_call_id;

  return jsonb_build_object('success', true);
end;
$$;

comment on function public.request_media_upgrade(uuid, text) is
  'Ask the other party to switch the live voice call to video (132). Nothing is '
  'billed until they accept. Expires after 30 s.';

revoke all on function public.request_media_upgrade(uuid, text) from public, anon;
grant execute on function public.request_media_upgrade(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. respond_media_upgrade — only the other party, bills the difference
-- ---------------------------------------------------------------------------

create or replace function public.respond_media_upgrade(
  p_call_id uuid,
  p_accept  boolean
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_call       public.calls%rowtype;
  v_session    public.paid_sessions%rowtype;
  v_video_rate integer;
  v_delta      integer := 0;
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

  select * into v_session
  from public.paid_sessions
  where call_id = p_call_id
    and status in ('active', 'warning', 'grace')
  for update;

  if found then
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
  'The other party accepts or declines a voice → video switch (132). On accept '
  'the member is charged only (video − voice) for the already-prepaid current '
  'minute, and the session bills at the video rate from the next minute.';

revoke all on function public.respond_media_upgrade(uuid, boolean) from public, anon;
grant execute on function public.respond_media_upgrade(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Provider accrual pays on what the member actually paid
-- ---------------------------------------------------------------------------
-- Was `count(usage_debit rows) x final rate` (037). With a mid-session rate
-- change that re-priced every earlier minute at the new rate, and it counted
-- the switch's difference debit as an extra minute. Gross is now the sum of the
-- session's usage debits; for a session whose rate never changed this is
-- exactly the old number (every row was one minute at the one rate).

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

  select coalesce(sum(-tokens_delta), 0)::integer
  into v_gross
  from public.token_transactions
  where session_id = p_session_id
    and kind = 'usage_debit'
    and status = 'succeeded';

  if v_gross <= 0 then return; end if;

  select minutes_billed into v_minutes
  from public.paid_sessions
  where id = p_session_id;
  v_minutes := coalesce(v_minutes, p_minutes_billed);

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
