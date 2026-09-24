-- ===========================================================================
-- 141  A video switch request tells the requester when it was recorded
-- ===========================================================================
--
-- Greptile on 0354a33 (2026-09-24): every resolution clears
-- upgrade_requested_at, so an outcome cannot say which request it answered. A
-- late re-read of an earlier decline could land while the member's next
-- request was pending and cancel it on their screen. The requester now gets
-- the server's own request time back and ignores any outcome older than it;
-- both timestamps are the server clock, so no device skew enters. The rest of
-- the function is 132's body unchanged.
-- ---------------------------------------------------------------------------

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

  return jsonb_build_object('success', true, 'requested_at', now());
end;
$$;
