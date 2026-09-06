-- ===========================================================================
-- 064  Per-provider channels: a provider offers chat, audio and video, or not
-- ===========================================================================
-- Until now the only per-provider switch was `is_available`, which is all or
-- nothing: listed and reachable on every channel, or not listed at all. A
-- provider who is happy to type at 2am but does not want to be on camera had
-- to choose between being on video and being invisible (Amit, 2026-09-05,
-- goal item 7).
--
-- Three booleans on the profile, all on by default, and a CHECK that at least
-- one survives: a provider may switch off up to two of the three (Amit,
-- 2026-09-06 — "at least one stays on"). "Listed but unreachable on every
-- channel" is what `is_available = false` already means, and it says it
-- honestly, so the floor is a table constraint rather than a preference.
--
-- The columns are provider-owned and client-writable, exactly like
-- `is_available` (012) — they are deliberately NOT in
-- guard_privileged_profile_columns (063). Their names follow
-- public.session_channel ('chat','audio','video'; 030:42), not
-- public.call_medium ('voice','video'; 011:674), because a session request is
-- what they gate.
--
-- ---------------------------------------------------------------------------
-- Where this is enforced, and why there
-- ---------------------------------------------------------------------------
-- Every paid conversation on every channel begins with one row in
-- public.session_requests, but they are not all inserted by the same function:
-- start_call and the provider's return invite go through
-- create_session_request (030:319), while a member's first text INSERTS
-- DIRECTLY (037:216). Patching the callers would leave the direct insert open
-- and would mean re-stating a 330-line function to add one check — which is
-- exactly how 054 silently dropped four guards (see 063).
--
-- So the enforcement is a BEFORE INSERT trigger on session_requests. Every
-- path, present and future, passes through it. It raises P0009; start_call is
-- re-stated below with one added exception branch so the member reads
-- "CHANNEL_DISABLED_BY_PROVIDER" rather than a bare FORBIDDEN, and the diff
-- against 053 is that branch and nothing else.
--
-- What it does NOT touch, deliberately: sessions that are already live or
-- already requested. The trigger fires on INSERT only, so a session in flight
-- runs to its natural end and a pending request can still be accepted. Turning
-- a channel off is a statement about the next conversation, not a way to hang
-- up on the current one.

-- ---------------------------------------------------------------------------
-- 1. The columns and the floor
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists chat_enabled  boolean not null default true,
  add column if not exists audio_enabled boolean not null default true,
  add column if not exists video_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname  = 'profiles_at_least_one_channel'
  ) then
    alter table public.profiles
      add constraint profiles_at_least_one_channel
      check (chat_enabled or audio_enabled or video_enabled);
  end if;
end
$$;

comment on column public.profiles.chat_enabled is
  'Provider offers text chat. Client-writable by its owner, like is_available; '
  'at least one channel must stay on (profiles_at_least_one_channel). '
  'Enforced for new sessions by enforce_provider_channel on session_requests.';
comment on column public.profiles.audio_enabled is
  'Provider offers voice calls. call_medium ''voice'' maps here.';
comment on column public.profiles.video_enabled is
  'Provider offers video calls. call_medium ''video'' maps here.';

-- ---------------------------------------------------------------------------
-- 2. One readable predicate, used by the trigger and by anything later
-- ---------------------------------------------------------------------------
create or replace function public.provider_offers_channel(
  p_provider_id uuid,
  p_channel     public.session_channel
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- The coalesce wraps the SUBQUERY, not the case: with the fallback inside the
  -- select list a missing row returns no rows at all and the function answers
  -- NULL, which made the trigger below depend on `not null` being neither true
  -- nor false. Caught by pgTAP 260 test 7 at authoring time.
  select coalesce(
    (
      select case p_channel
        when 'chat'  then p.chat_enabled
        when 'audio' then p.audio_enabled
        when 'video' then p.video_enabled
      end
      from public.profiles p
      where p.id = p_provider_id
    ),
    true
  );
$$;

comment on function public.provider_offers_channel(uuid, public.session_channel) is
  'Whether this provider currently offers this channel. Defaults to true for '
  'an unknown id so a missing row can never silently block a session.';

revoke all on function public.provider_offers_channel(uuid, public.session_channel)
  from public, anon;
grant execute on function public.provider_offers_channel(uuid, public.session_channel)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The choke point every channel passes through
-- ---------------------------------------------------------------------------
create or replace function public.enforce_provider_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
begin
  select provider_id into v_provider
  from   public.conversations
  where  id = new.conversation_id;

  -- No conversation row is somebody else's error to raise, not this trigger's.
  if v_provider is null then
    return new;
  end if;

  if not public.provider_offers_channel(v_provider, new.channel) then
    raise exception 'Provider does not offer % right now', new.channel
      using errcode = 'P0009';
  end if;

  return new;
end;
$$;

comment on function public.enforce_provider_channel() is
  'BEFORE INSERT on session_requests: refuses a channel the provider has '
  'switched off, whichever side asked. The single choke point — start_call and '
  'the return invite come via create_session_request, a member''s first text '
  'inserts directly (037:216), and both land here. Raises P0009.';

drop trigger if exists enforce_provider_channel on public.session_requests;
create trigger enforce_provider_channel
  before insert on public.session_requests
  for each row
  execute function public.enforce_provider_channel();

-- ---------------------------------------------------------------------------
-- 4. The directory carries them, so the member's buttons can say so first
-- ---------------------------------------------------------------------------
-- Appended at the END of the 042 column list: create or replace cannot drop or
-- reorder columns other objects depend on, and grants survive the replace.
create or replace view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    case when p.presence_visible then p.last_active_at end as last_active_at,
    p.created_at,
    p.presence,
    p.avatar_url,
    p.about,
    p.chat_enabled,
    p.audio_enabled,
    p.video_enabled
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'Explicit-column privacy boundary over profiles: what a member may see about '
  'a provider. chat_enabled / audio_enabled / video_enabled (064) let the '
  'member''s buttons say a channel is not offered before they tap it; the '
  'trigger on session_requests is what actually enforces it.';

-- ---------------------------------------------------------------------------
-- 5. start_call, re-stated from 053 with ONE added exception branch
-- ---------------------------------------------------------------------------
-- The body below is 053's verbatim; the only change is the `when sqlstate
-- 'P0009'` branch, so a member who calls a provider who has switched that
-- medium off reads a reason they can act on instead of FORBIDDEN. Verified by
-- diffing the two bodies at authoring time.
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
  v_controls  jsonb;
  v_enabled   boolean;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

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
    -- The provider switched this channel off (migration 064). Distinct from
    -- FORBIDDEN, which the member cannot act on; this one they can, by
    -- choosing a channel the provider still offers.
    when sqlstate 'P0009' then
      return json_build_object(
        'success', false, 'error', 'CHANNEL_DISABLED_BY_PROVIDER'
      );
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
    'medium', v_call.medium,
    'media_backend', v_call.media_backend
  );
end;
$$;
