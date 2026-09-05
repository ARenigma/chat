-- ===========================================================================
-- 052  Server-owned call media assignment and restricted QoE evidence
-- ===========================================================================
-- The calls row is the authority for both endpoints. Test overrides are
-- one-shot, expire quickly, and require both participants to be explicitly
-- allowlisted. Normal assignment is sticky to a conversation.

create type public.call_media_backend as enum ('current', 'livekit', 'agora');

alter table public.calls
  add column media_backend public.call_media_backend not null default 'current',
  add column media_experiment_id text,
  add column media_run_id uuid,
  add column media_assignment_kind text not null default 'sticky'
    check (media_assignment_kind in ('sticky', 'harness'));

create table public.call_media_test_allowlist (
  user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  added_at timestamptz not null default now()
);

create table public.call_media_overrides (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  backend public.call_media_backend not null,
  experiment_id text not null check (length(experiment_id) between 1 and 80),
  run_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id)
);

alter table public.call_media_test_allowlist enable row level security;
alter table public.call_media_overrides enable row level security;
revoke all on public.call_media_test_allowlist, public.call_media_overrides
  from public, anon, authenticated;

create or replace function public.set_next_call_media_backend(
  p_conversation_id uuid,
  p_backend public.call_media_backend,
  p_experiment_id text,
  p_run_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
begin
  if v_uid is null then
    raise exception 'Unauthenticated' using errcode = 'P0001';
  end if;
  if length(p_experiment_id) not between 1 and 80 or p_run_id is null then
    raise exception 'Invalid experiment metadata' using errcode = '22023';
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations
  where id = p_conversation_id
    and v_uid in (member_id, provider_id);
  if not found then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.call_media_test_allowlist
    where user_id = v_member and expires_at > now()
  ) or not exists (
    select 1 from public.call_media_test_allowlist
    where user_id = v_provider and expires_at > now()
  ) then
    raise exception 'Participants are not allowlisted' using errcode = 'P0001';
  end if;

  -- One conversation has one pending "next call" assignment. Either
  -- allowlisted endpoint may schedule it, and the next caller consumes it.
  delete from public.call_media_overrides
  where conversation_id = p_conversation_id;

  insert into public.call_media_overrides (
    conversation_id, requested_by, backend, experiment_id, run_id, expires_at
  ) values (
    p_conversation_id, v_uid, p_backend, p_experiment_id, p_run_id,
    now() + interval '5 minutes'
  )
  on conflict (conversation_id) do update
    set requested_by = excluded.requested_by,
        backend = excluded.backend,
        experiment_id = excluded.experiment_id,
        run_id = excluded.run_id,
        expires_at = excluded.expires_at,
        created_at = now();
end;
$$;

revoke all on function public.set_next_call_media_backend(
  uuid, public.call_media_backend, text, uuid
) from public, anon;
grant execute on function public.set_next_call_media_backend(
  uuid, public.call_media_backend, text, uuid
) to authenticated;

create or replace function public.assign_call_media_backend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override public.call_media_overrides%rowtype;
  v_bucket integer;
begin
  delete from public.call_media_overrides
  where conversation_id = new.conversation_id
    and expires_at > now()
  returning * into v_override;

  if found then
    new.media_backend := v_override.backend;
    new.media_experiment_id := v_override.experiment_id;
    new.media_run_id := v_override.run_id;
    new.media_assignment_kind := 'harness';
    return new;
  end if;

  -- One conversation remains in one arm across role rotation and repeat calls.
  v_bucket := get_byte(decode(md5(new.conversation_id::text), 'hex'), 0) % 3;
  new.media_backend := case v_bucket
    when 0 then 'current'::public.call_media_backend
    when 1 then 'livekit'::public.call_media_backend
    else 'agora'::public.call_media_backend
  end;
  new.media_experiment_id := 'media-v1';
  new.media_run_id := null;
  new.media_assignment_kind := 'sticky';
  return new;
end;
$$;

revoke all on function public.assign_call_media_backend()
  from public, anon, authenticated;

create trigger calls_assign_media_backend
before insert on public.calls
for each row execute function public.assign_call_media_backend();

-- Keep backend identity on foreground Realtime and killed-app FCM paths.
create or replace view public.pending_call_pushes
with (security_invoker = true) as
  select
    c.id as call_id,
    c.conversation_id,
    c.caller_id as peer_id,
    c.medium,
    coalesce(d.display_name, public.member_handle(c.caller_id)) as caller_display_name,
    t.token,
    t.platform,
    c.created_at,
    d.avatar_url as caller_avatar_url,
    c.media_backend,
    c.media_experiment_id
  from public.calls c
  join public.push_tokens t on t.user_id = c.callee_id
  left join public.provider_directory d on d.id = c.caller_id
  where c.status = 'ringing'
    and c.notified_at is null
    and c.created_at > now() - interval '2 minutes';

revoke all on public.pending_call_pushes from anon, authenticated;

create table public.call_quality_runs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  backend public.call_media_backend not null,
  experiment_id text,
  harness_run_id uuid,
  app_version text,
  sdk_version text,
  device_model text,
  android_api integer,
  codec text,
  target_width integer,
  target_height integer,
  target_fps integer,
  target_bitrate_kbps integer,
  carrier text,
  transport text,
  scenario text,
  role text check (role in ('caller', 'callee')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  termination_reason text,
  crashed boolean not null default false,
  anr boolean not null default false,
  battery_start_percent numeric,
  battery_end_percent numeric,
  unique (call_id, user_id)
);

create table public.call_quality_samples (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.call_quality_runs(id) on delete cascade,
  captured_at timestamptz not null,
  connection_state text,
  network_transport text,
  selected_route text,
  relay boolean,
  bytes_sent bigint,
  bytes_received bigint,
  packets_lost bigint,
  packets_received bigint,
  jitter_ms numeric,
  rtt_ms numeric,
  bitrate_kbps numeric,
  frames_per_second numeric,
  frame_width integer,
  frame_height integer,
  frames_dropped bigint,
  freeze_duration_ms numeric,
  nack_count bigint,
  pli_count bigint,
  audio_concealed_samples bigint,
  cpu_percent numeric,
  rss_bytes bigint,
  thermal_status integer,
  quality integer check (quality between 0 and 6)
);

create index call_quality_samples_run_time_idx
  on public.call_quality_samples (run_id, captured_at);

alter table public.call_quality_runs enable row level security;
alter table public.call_quality_samples enable row level security;
revoke all on public.call_quality_runs, public.call_quality_samples
  from public, anon, authenticated;

create or replace function public.record_call_quality_samples(
  p_call_id uuid,
  p_samples jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_call public.calls%rowtype;
  v_run uuid;
  v_sample jsonb;
  v_count integer := 0;
  v_allowed constant text[] := array[
    'capturedAtMs', 'backend', 'connectionState', 'networkTransport',
    'selectedRoute', 'relay', 'bytesSent', 'bytesReceived', 'packetsLost',
    'packetsReceived', 'jitterMs', 'rttMs', 'bitrateKbps',
    'framesPerSecond', 'frameWidth', 'frameHeight', 'framesDropped',
    'freezeDurationMs', 'nackCount', 'pliCount', 'audioConcealedSamples',
    'cpuPercent', 'rssBytes', 'thermalStatus', 'quality'
  ];
begin
  if v_uid is null or jsonb_typeof(p_samples) <> 'array'
     or jsonb_array_length(p_samples) not between 1 and 10 then
    raise exception 'Invalid quality batch' using errcode = '22023';
  end if;

  select * into v_call from public.calls
  where id = p_call_id
    and v_uid in (caller_id, callee_id)
    and status in ('ringing', 'active', 'ended', 'failed');
  if not found then
    raise exception 'Not a call participant' using errcode = 'P0001';
  end if;

  insert into public.call_quality_runs (
    call_id, user_id, backend, experiment_id, harness_run_id, role
  ) values (
    v_call.id, v_uid, v_call.media_backend, v_call.media_experiment_id,
    v_call.media_run_id,
    case when v_uid = v_call.caller_id then 'caller' else 'callee' end
  )
  on conflict (call_id, user_id) do update
    set backend = excluded.backend
  returning id into v_run;

  for v_sample in select value from jsonb_array_elements(p_samples) loop
    if jsonb_typeof(v_sample) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_sample) as key
         where key <> all(v_allowed)
       )
       or v_sample ->> 'backend' is distinct from v_call.media_backend::text
    then
      raise exception 'Invalid quality sample' using errcode = '22023';
    end if;

    insert into public.call_quality_samples (
      run_id, captured_at, connection_state, network_transport,
      selected_route, relay, bytes_sent, bytes_received, packets_lost,
      packets_received, jitter_ms, rtt_ms, bitrate_kbps, frames_per_second,
      frame_width, frame_height, frames_dropped, freeze_duration_ms, nack_count,
      pli_count, audio_concealed_samples, cpu_percent, rss_bytes, thermal_status,
      quality
    ) values (
      v_run,
      to_timestamp((v_sample ->> 'capturedAtMs')::double precision / 1000),
      v_sample ->> 'connectionState',
      v_sample ->> 'networkTransport',
      v_sample ->> 'selectedRoute',
      (v_sample ->> 'relay')::boolean,
      (v_sample ->> 'bytesSent')::bigint,
      (v_sample ->> 'bytesReceived')::bigint,
      (v_sample ->> 'packetsLost')::bigint,
      (v_sample ->> 'packetsReceived')::bigint,
      (v_sample ->> 'jitterMs')::numeric,
      (v_sample ->> 'rttMs')::numeric,
      (v_sample ->> 'bitrateKbps')::numeric,
      (v_sample ->> 'framesPerSecond')::numeric,
      (v_sample ->> 'frameWidth')::integer,
      (v_sample ->> 'frameHeight')::integer,
      (v_sample ->> 'framesDropped')::bigint,
      (v_sample ->> 'freezeDurationMs')::numeric,
      (v_sample ->> 'nackCount')::bigint,
      (v_sample ->> 'pliCount')::bigint,
      (v_sample ->> 'audioConcealedSamples')::bigint,
      (v_sample ->> 'cpuPercent')::numeric,
      (v_sample ->> 'rssBytes')::bigint,
      (v_sample ->> 'thermalStatus')::integer,
      (v_sample ->> 'quality')::integer
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.record_call_quality_samples(uuid, jsonb)
  from public, anon;
grant execute on function public.record_call_quality_samples(uuid, jsonb)
  to authenticated;

