-- ===========================================================================
-- 041  Enable payments for first-interaction paywall (Cashfree)
-- ===========================================================================
-- First-send opens Recharge → PaymentSheet. That path is gated by
-- kill_switches.payments_enabled (still false from migration 026). Flip it on
-- and enable the Cashfree rail on recharge so internal/sandbox checkout can run.
-- Append-only: supersede active versions, publish new ones (ADR-0023).

do $$
declare
  v_env text;
  v_id uuid;
  v_sha text;
  v_ver bigint;
  v_old uuid;
  v_kill jsonb := '{
    "payments_enabled": true,
    "calls_enabled": true,
    "new_registrations_enabled": true,
    "mock_payments_allowed": true
  }';
  v_recharge jsonb := '{
    "packs_inr": [100, 300, 500, 1000, 2500, 5000],
    "play_product_ids": [],
    "cashfree_enabled": true,
    "play_ucb_enabled": false
  }';
begin
  foreach v_env in array array['staging', 'prod'] loop
    -- kill_switches ----------------------------------------------------------
    select version_id into v_old
    from admin.config_active
    where domain = 'kill_switches' and environment = v_env;

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded', superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1 into v_ver
    from admin.config_versions
    where domain = 'kill_switches' and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_kill::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'kill_switches', v_env, v_ver, 'active',
       v_kill, v_sha, now(),
       'migration_041', 'migration_041', now(),
       'Enable payments for first-send Cashfree paywall');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('kill_switches', v_env, v_id, v_kill, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit (action, domain, version_id, actor, reason)
    values (
      'published_staging', 'kill_switches', v_id, 'migration_041',
      'payments_enabled=true for first-interaction paywall (' || v_env || ')'
    );

    -- recharge ---------------------------------------------------------------
    select version_id into v_old
    from admin.config_active
    where domain = 'recharge' and environment = v_env;

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded', superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1 into v_ver
    from admin.config_versions
    where domain = 'recharge' and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_recharge::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'recharge', v_env, v_ver, 'active',
       v_recharge, v_sha, now(),
       'migration_041', 'migration_041', now(),
       'Enable Cashfree rail for recharge packs');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('recharge', v_env, v_id, v_recharge, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit (action, domain, version_id, actor, reason)
    values (
      'published_staging', 'recharge', v_id, 'migration_041',
      'cashfree_enabled=true for first-interaction paywall (' || v_env || ')'
    );
  end loop;
end;
$$;
