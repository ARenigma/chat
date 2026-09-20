-- ===========================================================================
-- 123  In-place audio↔video media upgrade with peer consent
-- ===========================================================================
--
-- Instead of ending the audio call and starting a fresh video one (which rings
-- the other party again, drops billing continuity, and unmounts the call UI),
-- the upgrade flows through the live `calls` row:
--
--   INITIATOR  request_media_upgrade(callId, 'video')
--              → calls.upgrade_requested_by   = initiator_id
--              → calls.upgrade_to_medium      = 'video'
--              → calls.upgrade_requested_at   = now()
--
--   PEER       respond_media_upgrade(callId, true)
--              → clears upgrade columns
--              → updates calls.medium to the new value
--
-- Both sides hold a Realtime subscription on the calls row (useCallEnded already
-- subscribes to *), so the upgrade prompt and the confirmed state arrive without
-- a new channel.
--
-- Billing: the paid_session rate_tokens_per_min is updated in the same
-- respond_media_upgrade transaction. The next cron tick (meter_active_calls)
-- picks up the new rate, so billing changes at the next whole-minute boundary.
-- A partial-minute delta is NOT charged on upgrade — it is the simpler, safer
-- policy and it is consistent with how the first minute is always pre-paid.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Upgrade state columns on calls
-- ---------------------------------------------------------------------------

alter table public.calls
  add column if not exists upgrade_requested_by  uuid  references public.profiles(id),
  add column if not exists upgrade_to_medium      text  check (upgrade_to_medium in ('audio','video')),
  add column if not exists upgrade_requested_at   timestamptz;

comment on column public.calls.upgrade_requested_by is
  'User who initiated the in-place media upgrade request (123). Null when idle.';
comment on column public.calls.upgrade_to_medium is
  'Target medium of the in-place upgrade (123). Null when idle.';
comment on column public.calls.upgrade_requested_at is
  'When the upgrade was requested; used to expire the request after 30s (123).';

-- ---------------------------------------------------------------------------
-- 2. request_media_upgrade
-- ---------------------------------------------------------------------------

create or replace function public.request_media_upgrade(
  p_call_id  uuid,
  p_to_medium text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_call public.calls%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if p_to_medium not in ('audio', 'video') then
    return jsonb_build_object('success', false, 'error', 'INVALID_MEDIUM');
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

  if v_call.medium = p_to_medium then
    return jsonb_build_object('success', false, 'error', 'ALREADY_IN_MEDIUM');
  end if;

  if v_call.upgrade_requested_at is not null
    and v_call.upgrade_requested_at > now() - interval '30 seconds' then
    return jsonb_build_object('success', false, 'error', 'UPGRADE_PENDING');
  end if;

  update public.calls
  set upgrade_requested_by = v_uid,
      upgrade_to_medium    = p_to_medium,
      upgrade_requested_at = now()
  where id = p_call_id;

  return jsonb_build_object('success', true);
end;
$$;

comment on function public.request_media_upgrade(uuid, text) is
  'Ask the other party to switch media in the live call (123). No billing change '
  'until the peer accepts. Expires in 30 s.';

revoke all on function public.request_media_upgrade(uuid, text) from public;
grant execute on function public.request_media_upgrade(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. respond_media_upgrade
-- ---------------------------------------------------------------------------

create or replace function public.respond_media_upgrade(
  p_call_id uuid,
  p_accept  boolean
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_call    public.calls%rowtype;
  v_session public.paid_sessions%rowtype;
  v_new_rate integer;
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

  -- Expired: clear state and reject.
  if v_call.upgrade_requested_at < now() - interval '30 seconds' then
    update public.calls
    set upgrade_requested_by = null,
        upgrade_to_medium    = null,
        upgrade_requested_at = null
    where id = p_call_id;
    return jsonb_build_object('success', false, 'error', 'EXPIRED');
  end if;

  if not p_accept then
    -- Decline: just clear upgrade state.
    update public.calls
    set upgrade_requested_by = null,
        upgrade_to_medium    = null,
        upgrade_requested_at = null
    where id = p_call_id;
    return jsonb_build_object('success', true, 'accepted', false);
  end if;

  -- Accept: update medium on the calls row.
  update public.calls
  set medium               = v_call.upgrade_to_medium,
      upgrade_requested_by = null,
      upgrade_to_medium    = null,
      upgrade_requested_at = null
  where id = p_call_id;

  -- Update the rate on the live paid_session so the NEXT billing minute uses
  -- the new rate. We look up the configured rate for the new medium from the
  -- admin economics config. A null session (call never billed) is fine.
  select * into v_session
  from public.paid_sessions
  where call_id = p_call_id
    and status in ('pending_leases','active','warning','grace')
  limit 1;

  if found then
    -- Read the new rate from admin config; fall back to the existing rate on
    -- error so we never write a zero rate.
    begin
      select (
        case v_call.upgrade_to_medium
          when 'video' then (payload ->> 'tokens_per_minute_video')::integer
          else              (payload ->> 'tokens_per_minute_audio')::integer
        end
      )
      into v_new_rate
      from admin.config_active
      where domain = 'economics';
    exception when others then
      v_new_rate := null;
    end;

    if v_new_rate is not null and v_new_rate > 0 then
      update public.paid_sessions
      set rate_tokens_per_min = v_new_rate
      where id = v_session.id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'accepted', true, 'new_medium', v_call.upgrade_to_medium);
end;
$$;

comment on function public.respond_media_upgrade(uuid, boolean) is
  'Accept or decline an in-place media upgrade request (123). On accept: updates '
  'calls.medium and paid_sessions.rate_tokens_per_min for the next billing tick. '
  'No partial-minute delta is charged — the full minute at the new rate starts '
  'at the next cron tick.';

revoke all on function public.respond_media_upgrade(uuid, boolean) from public;
grant execute on function public.respond_media_upgrade(uuid, boolean) to authenticated;
