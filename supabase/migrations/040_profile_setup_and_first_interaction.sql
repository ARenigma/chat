-- ===========================================================================
-- 040  Profile setup, conversation openers, permissions config
-- ===========================================================================
-- First-interaction UX: members claim a username + clay avatar before entering
-- the app; seeded provider openers greet an empty thread; runtime permission
-- policy is admin-configurable.

-- ---------------------------------------------------------------------------
-- 1. Profile completion marker
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists profile_completed_at timestamptz;

comment on column public.profiles.profile_completed_at is
  'Set when a member completes first-run profile setup (username + avatar). '
  'Null means the profile gate must run before the main app.';

-- Case-insensitive unique display names among non-empty values.
create unique index if not exists profiles_display_name_lower_unique
  on public.profiles (lower(display_name))
  where display_name is not null and btrim(display_name) <> '';

-- ---------------------------------------------------------------------------
-- 2. Username validation
-- ---------------------------------------------------------------------------

create or replace function public.check_display_name(p_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trimmed text := btrim(coalesce(p_name, ''));
begin
  if length(v_trimmed) < 3 or length(v_trimmed) > 24 then
    return jsonb_build_object(
      'status', 'invalid',
      'message', 'Use 3–24 characters.'
    );
  end if;

  if v_trimmed !~ '^[a-zA-Z0-9_]+$' then
    return jsonb_build_object(
      'status', 'invalid',
      'message', 'Letters, numbers, and underscores only.'
    );
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.display_name) = lower(v_trimmed)
      and btrim(coalesce(p.display_name, '')) <> ''
  ) then
    return jsonb_build_object(
      'status', 'taken',
      'message', 'Oops! already taken'
    );
  end if;

  return jsonb_build_object(
    'status', 'available',
    'message', 'Yay! great choice'
  );
end;
$$;

comment on function public.check_display_name(text) is
  'Validates a member username (profiles.display_name): 3–24 [a-zA-Z0-9_], '
  'case-insensitive unique. Returns {status, message}.';

revoke all on function public.check_display_name(text) from public;
grant execute on function public.check_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Claim member profile (username + clay avatar)
-- ---------------------------------------------------------------------------

create or replace function public.claim_member_profile(
  p_display_name text,
  p_avatar_seed text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_completed timestamptz;
  v_check jsonb;
  v_seed text := btrim(coalesce(p_avatar_seed, ''));
  v_allowed text[] := array[
    'ada', 'bloom', 'coral', 'dusk', 'ember', 'fern',
    'glow', 'haze', 'iris', 'jade', 'kiwi', 'luna'
  ];
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select role, profile_completed_at
  into v_role, v_completed
  from public.profiles
  where id = v_uid;

  if v_role is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_role <> 'member' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if v_completed is not null then
    raise exception 'PROFILE_ALREADY_COMPLETED' using errcode = '22023';
  end if;

  v_check := public.check_display_name(p_display_name);
  if (v_check ->> 'status') <> 'available' then
    return v_check;
  end if;

  if not (v_seed = any (v_allowed)) then
    return jsonb_build_object(
      'status', 'invalid',
      'message', 'Pick one of the avatars shown.'
    );
  end if;

  update public.profiles
  set display_name = btrim(p_display_name),
      avatar_url = 'clay:' || v_seed,
      profile_completed_at = now()
  where id = v_uid;

  return jsonb_build_object(
    'status', 'ok',
    'message', 'Profile saved.',
    'display_name', btrim(p_display_name),
    'avatar_url', 'clay:' || v_seed
  );
end;
$$;

comment on function public.claim_member_profile(text, text) is
  'Member first-run setup: set display_name, clay: avatar_url, profile_completed_at. '
  'Idempotent guard: raises if already completed.';

revoke all on function public.claim_member_profile(text, text) from public;
grant execute on function public.claim_member_profile(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Seed provider openers on chat open (idempotent)
-- ---------------------------------------------------------------------------

create or replace function public.seed_conversation_openers(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
  v_count int;
  v_openers text[] := array[
    'Hey — glad you''re here.',
    'How are you doing right now?',
    'I''m here to listen. No rush.'
  ];
  v_body text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  v_conv_id := public.open_conversation(p_provider_id);

  select count(*)::int into v_count
  from public.messages m
  where m.conversation_id = v_conv_id;

  if v_count > 0 then
    return jsonb_build_object(
      'conversation_id', v_conv_id,
      'seeded', false,
      'message_count', v_count
    );
  end if;

  foreach v_body in array v_openers loop
    insert into public.messages (conversation_id, sender_id, body)
    values (v_conv_id, p_provider_id, v_body);
  end loop;

  return jsonb_build_object(
    'conversation_id', v_conv_id,
    'seeded', true,
    'message_count', array_length(v_openers, 1)
  );
end;
$$;

comment on function public.seed_conversation_openers(uuid) is
  'Opens (or reuses) a member↔provider conversation and, if empty, inserts '
  'three provider opener messages. Idempotent once any message exists.';

revoke all on function public.seed_conversation_openers(uuid) from public;
grant execute on function public.seed_conversation_openers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Permissions admin config domain + seeds (staging + prod)
-- ---------------------------------------------------------------------------

insert into admin.config_domains (key, description)
values ('permissions', 'Runtime device permission policy by environment')
on conflict (key) do nothing;

do $$
declare
  v_payload jsonb := '{
    "environment_mode": "internal",
    "notification_internal": "optional",
    "notification_production": "required",
    "microphone_internal": "required",
    "microphone_production": "required",
    "camera_internal": "required",
    "camera_production": "required"
  }';
  v_env text;
  v_id uuid;
  v_sha text;
begin
  v_sha := encode(sha256(v_payload::text::bytea), 'hex');

  foreach v_env in array array['staging', 'prod'] loop
    v_id := gen_random_uuid();

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'permissions', v_env, 1, 'active',
       v_payload, v_sha, now(),
       'migration_040', 'migration_040', now(),
       'Initial permissions policy seed');

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
      ('published_staging', 'permissions', v_id, 'migration_040',
       'Initial permissions seed for ' || v_env);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Extend get_public_config allowlist
-- ---------------------------------------------------------------------------

create or replace function public.get_public_config(p_domain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, admin
as $$
declare
  v_payload jsonb;
begin
  if p_domain not in ('kill_switches', 'auth_ui', 'permissions') then
    raise exception 'Domain % is not publicly accessible', p_domain
      using errcode = 'insufficient_privilege';
  end if;

  select payload into v_payload
  from admin.config_active
  where domain      = p_domain
    and environment = 'prod';

  return v_payload;
end;
$$;

comment on function public.get_public_config(text) is
  'Publicly accessible config for safe domains: kill_switches, auth_ui, permissions.';

grant execute on function public.get_public_config(text) to anon, authenticated;
