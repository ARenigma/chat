-- ===========================================================================
-- 121  Disable scheduled engagement nudges; notifications become opt-in
-- ===========================================================================
-- Product decision, 2026-09-19:
--   1. Stop the daily 13:00 UTC / 18:30 IST re-engagement push.
--   2. Notification permission is optional in every environment.
--
-- Keep the send-engagement function and dispatch RPC intact. This migration
-- disables only the automatic schedule, so an explicitly initiated future
-- campaign remains a separate product decision.

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  if exists (
    select 1
    from cron.job
    where jobname = 'dispatch-engagement-nudges'
  ) then
    perform cron.unschedule('dispatch-engagement-nudges');
  end if;
end
$$;

-- Config history is append-only (ADR-0023): supersede the active version,
-- publish a new one, and move the active pointer atomically.
do $$
declare
  v_env text;
  v_id uuid;
  v_old uuid;
  v_ver bigint;
  v_payload jsonb;
  v_sha text;
begin
  foreach v_env in array array['staging', 'prod'] loop
    select version_id, payload
      into v_old, v_payload
    from admin.config_active
    where domain = 'permissions'
      and environment = v_env;

    v_payload := coalesce(
      v_payload,
      '{
        "environment_mode": "internal",
        "microphone_internal": "required",
        "microphone_production": "required",
        "camera_internal": "required",
        "camera_production": "required"
      }'::jsonb
    );
    v_payload := jsonb_set(v_payload, '{notification_internal}', '"optional"', true);
    v_payload := jsonb_set(v_payload, '{notification_production}', '"optional"', true);

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded',
          superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1
      into v_ver
    from admin.config_versions
    where domain = 'permissions'
      and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_payload::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'permissions', v_env, v_ver, 'active',
       v_payload, v_sha, now(),
       'migration_121', 'migration_121', now(),
       'Make notification permission opt-in');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('permissions', v_env, v_id, v_payload, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', 'permissions', v_id, 'migration_121',
       'Notifications optional in ' || v_env);
  end loop;
end
$$;
