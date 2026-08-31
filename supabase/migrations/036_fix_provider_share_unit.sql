-- Correct legacy provider_share_percent payloads without rewriting immutable
-- config history. The canonical unit is integer percent: 60 means 60%.

do $$
declare
  v_active  admin.config_active%rowtype;
  v_payload jsonb;
  v_id      uuid;
  v_version bigint;
begin
  select * into v_active
  from admin.config_active
  where domain = 'economics'
    and environment = 'prod'
  for update;

  if not found
     or (v_active.payload->>'provider_share_percent')::integer <> 6000
  then
    return;
  end if;

  v_payload := jsonb_set(
    v_active.payload,
    '{provider_share_percent}',
    '60'::jsonb
  );
  v_id := gen_random_uuid();

  select coalesce(max(version_number), 0) + 1
  into v_version
  from admin.config_versions
  where domain = 'economics'
    and environment = 'prod';

  update admin.config_versions
  set status = 'superseded',
      superseded_at = now()
  where id = v_active.version_id
    and status = 'active';

  insert into admin.config_versions (
    id, domain, environment, version_number, status,
    payload, payload_sha256, effective_at,
    created_by, published_by, published_at, publish_reason
  ) values (
    v_id, 'economics', 'prod', v_version, 'active',
    v_payload, encode(sha256(v_payload::text::bytea), 'hex'), now(),
    'migration_036', 'migration_036', now(),
    'Correct provider share from basis points to integer percent'
  );

  update admin.config_active
  set version_id = v_id,
      payload = v_payload,
      effective_from = now(),
      updated_at = now()
  where domain = 'economics'
    and environment = 'prod';

  insert into admin.config_audit (
    action, domain, version_id, actor, reason, metadata
  ) values (
    'rollback',
    'economics',
    v_id,
    'migration_036',
    'Correct provider_share_percent unit to integer percent',
    jsonb_build_object(
      'previous_version_id', v_active.version_id,
      'previous_value', 6000,
      'corrected_value', 60
    )
  );
end;
$$;
