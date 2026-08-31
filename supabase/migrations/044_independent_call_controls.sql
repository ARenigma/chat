-- ===========================================================================
-- 044  Independent voice/video controls, enforced at the call boundary
-- ===========================================================================
-- `calls_enabled` was one client-side UI gate for two different products. It
-- could not stop one medium independently, and start_call never read it, so a
-- stale or modified client could still create a call after an operator stop.
--
-- Publish two ON-by-default controls in both environments, preserving every
-- unrelated kill switch, then enforce the selected medium inside start_call.
-- Missing new keys fall back to the legacy `calls_enabled`, then true, so a
-- rolling app/database deploy never turns calling off by accident.

do $$
declare
  v_env  text;
  v_id   uuid;
  v_old  uuid;
  v_ver  bigint;
  v_sha  text;
  v_kill jsonb;
begin
  foreach v_env in array array['staging', 'prod'] loop
    select version_id, payload
      into v_old, v_kill
    from admin.config_active
    where domain = 'kill_switches'
      and environment = v_env;

    v_kill := (coalesce(v_kill, '{}'::jsonb) - 'calls_enabled')
      || jsonb_build_object(
        'voice_calls_enabled', true,
        'video_calls_enabled', true
      );

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded', superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1
      into v_ver
    from admin.config_versions
    where domain = 'kill_switches'
      and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_kill::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'kill_switches', v_env, v_ver, 'active',
       v_kill, v_sha, now(),
       'migration_044', 'migration_044', now(),
       'Enable independent voice and video call controls');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('kill_switches', v_env, v_id, v_kill, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', 'kill_switches', v_id, 'migration_044',
       'voice_calls_enabled=true and video_calls_enabled=true (' || v_env || ')');
  end loop;
end;
$$;

create or replace function public.start_call(
  p_conversation_id uuid,
  p_medium public.call_medium
)
returns json
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_uid       uuid := auth.uid();
  v_member    uuid;
  v_provider  uuid;
  v_other     uuid;
  v_suspended timestamptz;
  v_recent    integer;
  v_request   uuid;
  v_call      public.calls%rowtype;
  v_controls jsonb;
  v_enabled  boolean;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  -- This is the authoritative feature gate. Android surfaces read the same
  -- public config to disable their buttons promptly, but clients are not the
  -- security boundary.
  select payload into v_controls
  from admin.config_active
  where domain = 'kill_switches'
    and environment = 'prod';

  v_enabled := coalesce(
    case p_medium
      when 'voice' then (v_controls ->> 'voice_calls_enabled')::boolean
      when 'video' then (v_controls ->> 'video_calls_enabled')::boolean
    end,
    (v_controls ->> 'calls_enabled')::boolean,
    true
  );

  if not v_enabled then
    return json_build_object(
      'success', false,
      'error', case p_medium
        when 'voice' then 'VOICE_CALLS_DISABLED'
        else 'VIDEO_CALLS_DISABLED'
      end
    );
  end if;

  select member_id, provider_id
  into v_member, v_provider
  from public.conversations
  where id = p_conversation_id;

  if not found then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid not in (v_member, v_provider) then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  v_other := case when v_uid = v_member then v_provider else v_member end;

  select suspended_until into v_suspended
  from public.profiles
  where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  select count(*)::integer into v_recent
  from public.calls
  where caller_id = v_uid
    and created_at > now() - interval '1 hour';
  if v_recent >= 10 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  if exists (
    select 1 from public.calls
    where status in ('ringing', 'active')
      and (caller_id in (v_uid, v_other) or callee_id in (v_uid, v_other))
  ) or exists (
    select 1 from public.paid_sessions
    where status in ('pending_leases', 'active', 'warning', 'grace')
      and (member_id in (v_uid, v_other) or provider_id in (v_uid, v_other))
  ) then
    return json_build_object('success', false, 'error', 'BUSY');
  end if;

  begin
    v_request := public.create_session_request(
      p_conversation_id,
      case p_medium
        when 'voice' then 'audio'::public.session_channel
        else 'video'::public.session_channel
      end
    );
  exception
    when sqlstate 'P0003' then
      return json_build_object(
        'success', false, 'error', 'INSUFFICIENT_BALANCE'
      );
    when sqlstate 'P0005' then
      return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
    when others then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
  end;

  insert into public.calls (
    conversation_id, caller_id, callee_id, medium, session_request_id
  ) values (
    p_conversation_id, v_uid, v_other, p_medium, v_request
  )
  returning * into v_call;

  return json_build_object(
    'success', true,
    'call_id', v_call.id,
    'session_request_id', v_request,
    'medium', v_call.medium
  );
end;
$$;

revoke all on function public.start_call(uuid, public.call_medium)
  from public, anon;
grant execute on function public.start_call(uuid, public.call_medium)
  to authenticated;

comment on function public.start_call(uuid, public.call_medium) is
  'Starts a metered voice/video call after enforcing the matching active '
  'kill_switches control and all participant, policy, balance and busy gates.';
