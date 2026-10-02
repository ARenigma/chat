-- ===========================================================================
-- 182  Provider presence push: a realtime-pushable shadow of the derived
--      online flag, written only on transitions.
-- ===========================================================================
-- Why this exists:
--   The views `provider_directory` and `conversation_peers` cannot be pushed
--   via postgres_changes (155's comment explains: views are excluded from
--   replication). The member client polls them every 30 s. This migration
--   adds a real table, `provider_presence`, that holds one row per provider
--   and is written ONLY when the derived `online` value transitions
--   (offline→online or online→offline). Members subscribe to postgres_changes
--   on this table and patch TanStack caches in place, making a server-side
--   presence event visible sub-second without any poll. The existing views
--   and their polls remain as a safety net and the authoritative read path.
--
-- Write points (in decreasing frequency):
--   1. presence_heartbeat(): restated here. After each profile write that
--      passes the 20 s rate limit, it computes the derived online value and
--      upserts provider_presence only on a transition.
--   2. sync_provider_presence_on_availability(): AFTER UPDATE trigger on
--      profiles.is_available. Toggling availability changes the derived
--      value without a heartbeat, so the push happens at once.
--   3. expire_provider_presence(): pg_cron function every 15 s that flips
--      rows to online=false for providers whose last_active_at has exceeded
--      the 75 s window.
--
-- last_seen_at follows 155's semantics: date_trunc('minute', last_active_at).
--
-- RLS: SELECT for authenticated viewers not in a blocked pair with the
-- provider. Symmetric, same predicate as the views in 155. No client writes.
-- Anon excluded. New functions start closed per 153's pattern.
--
-- No BEGIN/COMMIT: the Supabase CLI wraps each file in its own transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table public.provider_presence (
  provider_id  uuid        not null primary key
                           references public.profiles (id) on delete cascade,
  online       boolean     not null default false,
  -- date_trunc('minute', profiles.last_active_at) at the time of the write.
  -- Null while the provider has never heartbeated. Matches 155's last_seen_at.
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.provider_presence is
  'One row per provider, written ONLY on transitions of the derived online '
  'value (182). Members subscribe via postgres_changes for a sub-second push '
  'when a provider comes online or goes offline. Source of truth for the '
  'derived value stays in profiles; this is the pushable shadow only. '
  'online = is_available AND presence_online AND last_active_at within 75 s.';

comment on column public.provider_presence.online is
  'Derived online at the time of the last write. True = open + heartbeat '
  'within 75 s + no explicit offline. Never read in isolation; the views in '
  '155 remain the authoritative poll path.';

comment on column public.provider_presence.last_seen_at is
  'date_trunc(''minute'', profiles.last_active_at) at write time, matching '
  '155''s last_seen_at semantics. NULL while the provider has never '
  'heartbeated.';

-- ---------------------------------------------------------------------------
-- 2. REPLICA IDENTITY FULL
--    Required so postgres_changes UPDATE events carry the complete old row,
--    allowing the client to identify what changed without a pk-only payload.
--    https://supabase.com/docs/guides/realtime/postgres-changes#replica-identity
-- ---------------------------------------------------------------------------
alter table public.provider_presence replica identity full;

-- ---------------------------------------------------------------------------
-- 3. Publication
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.provider_presence;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.provider_presence enable row level security;

-- SELECT: authenticated viewers not in a blocked pair with this provider.
-- The block predicate is inlined (same reason as 155 §1): is_blocked_pair is
-- closed to clients (143), and a function inside a policy runs as the caller,
-- not the table owner. The EXISTS below is the same symmetric test as 005's.
create policy "authenticated can see unblocked provider presence"
  on public.provider_presence
  for select
  to authenticated
  using (
    not exists (
      select 1
      from   public.blocks b
      where  (b.blocker_id = auth.uid() and b.blocked_id = provider_presence.provider_id)
          or (b.blocker_id = provider_presence.provider_id and b.blocked_id = auth.uid())
    )
  );

-- No INSERT / UPDATE / DELETE for any client role. All writes are by definer
-- functions and triggers. service_role keeps its implicit all-tables grant.
revoke all on public.provider_presence from anon, authenticated;
grant select on public.provider_presence to authenticated;

-- ---------------------------------------------------------------------------
-- 5. presence_heartbeat: restated from 155 to also write provider_presence
--    on transitions of the derived online value.
--
--    The 155 body is reproduced in full so this file is the complete record,
--    matching the pattern set by 155 when it restated 011's guard in full.
--    `create or replace` keeps the ACL 153 closed.
-- ---------------------------------------------------------------------------
create or replace function public.presence_heartbeat(p_online boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid    := auth.uid();
  v_is_available boolean;
  v_derived      boolean;
  v_was_online   boolean;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_online is null then
    raise exception 'p_online must be true or false' using errcode = '22004';
  end if;

  -- Write profiles: same rate-limit and state-change semantics as 155.
  -- RETURNING captures is_available so the derived value is computable
  -- without a second round trip. If no row was updated (rate-limited or not
  -- a provider) v_is_available stays NULL and we return early.
  update public.profiles
  set    last_active_at  = now(),
         presence_online = p_online
  where  id = v_uid
    and  role = 'provider'
    and  (last_active_at is null
          or last_active_at <= now() - interval '20 seconds'
          or presence_online is distinct from p_online)
  returning is_available
  into   v_is_available;

  -- Rate-limited or not a provider: nothing to push.
  if v_is_available is null then
    return;
  end if;

  -- Derived online. last_active_at was just written as now(), so the 75 s
  -- window is trivially met when p_online is true.
  v_derived := coalesce(v_is_available and p_online, false);

  -- Read the previous pushed value.
  select online into v_was_online
  from   public.provider_presence
  where  provider_id = v_uid;

  -- Write only on a transition (or when no row exists yet).
  if v_was_online is null or v_was_online is distinct from v_derived then
    insert into public.provider_presence (provider_id, online, last_seen_at, updated_at)
    values (
      v_uid,
      v_derived,
      date_trunc('minute', now()),
      now()
    )
    on conflict (provider_id) do update
      set online       = excluded.online,
          last_seen_at = excluded.last_seen_at,
          updated_at   = now()
    -- Belt-and-suspenders: skip if the derived value has not changed (guards
    -- against a concurrent write that already applied the transition).
    where provider_presence.online is distinct from excluded.online;
  end if;
end;
$$;

comment on function public.presence_heartbeat(boolean) is
  'The provider app''s presence signal (155, restated 182): true on foreground '
  'and every 30 s while foregrounded, false on background. Providers only; a '
  'member''s call writes nothing. At most one profile write per 20 s unless the '
  'state changes. After each allowed profile write, upserts provider_presence '
  'only on a transition of the derived online value, so members receive an '
  'instant push rather than waiting for the next poll.';

-- ACL unchanged from 155: closed to public/anon, open to authenticated.
revoke all on function public.presence_heartbeat(boolean) from public, anon;
grant execute on function public.presence_heartbeat(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Trigger: sync provider_presence when is_available changes on profiles.
--    The heartbeat (above) already covers presence_online / last_active_at
--    transitions. is_available is the one remaining write point: a provider
--    closing themselves pushes online=false immediately without waiting for
--    a heartbeat to pass the rate limit or the cron to expire them.
-- ---------------------------------------------------------------------------
create or replace function public.sync_provider_presence_on_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_derived boolean;
begin
  -- Guards: providers only, is_available must have changed.
  if new.role is distinct from 'provider' then
    return new;
  end if;
  if new.is_available is not distinct from old.is_available then
    return new;
  end if;

  -- Derived online: is_available AND presence_online AND heartbeat within 75 s.
  v_derived := coalesce(
    new.is_available
    and new.presence_online
    and new.last_active_at is not null
    and new.last_active_at > now() - interval '75 seconds',
    false
  );

  insert into public.provider_presence (provider_id, online, last_seen_at, updated_at)
  values (
    new.id,
    v_derived,
    date_trunc('minute', new.last_active_at),
    now()
  )
  on conflict (provider_id) do update
    set online       = excluded.online,
        last_seen_at = excluded.last_seen_at,
        updated_at   = now()
  where provider_presence.online is distinct from excluded.online;

  return new;
end;
$$;

comment on function public.sync_provider_presence_on_availability() is
  'AFTER UPDATE trigger on profiles (182): when a provider''s is_available '
  'changes, recomputes the derived online value and upserts provider_presence '
  'if it differs. Ensures an availability toggle pushes instantly rather than '
  'waiting for the next heartbeat or cron sweep.';

-- AFTER UPDATE: fires only when is_available changes, keeping the trigger cost
-- invisible on all other profile writes (name, avatar, expertise, etc.).
create trigger sync_provider_presence_after_availability_change
  after update of is_available
  on public.profiles
  for each row
  execute function public.sync_provider_presence_on_availability();

-- Trigger functions are closed to client roles (153 § section 2 pattern):
-- privilege on a trigger function is checked at CREATE TRIGGER time, not when
-- the trigger fires, so a client row write still fires this trigger.
revoke all on function public.sync_provider_presence_on_availability()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. expire_provider_presence: the cron sweeper.
--    Flips rows to online=false for providers whose derived online has lapsed
--    (last_active_at > 75 s old, availability off, or explicit offline).
-- ---------------------------------------------------------------------------
create or replace function public.expire_provider_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_presence pp
  set    online     = false,
         updated_at = now()
  where  pp.online = true
    and  exists (
      select 1
      from   public.profiles p
      where  p.id = pp.provider_id
        and  (
          p.last_active_at is null
          or p.last_active_at <= now() - interval '75 seconds'
          or not p.presence_online
          or not p.is_available
        )
    );
end;
$$;

comment on function public.expire_provider_presence() is
  'Cron sweeper (182): flips provider_presence.online to false for providers '
  'whose last_active_at exceeds 75 s, or whose availability or presence_online '
  'flag is off. Called every 15 s by pg_cron. The cron is the safety net for '
  'providers whose app was killed without sending an explicit offline.';

-- Server-internal; no client or authenticated role should call this.
revoke all on function public.expire_provider_presence() from public, anon, authenticated;
grant execute on function public.expire_provider_presence() to service_role;

-- ---------------------------------------------------------------------------
-- 8. pg_cron schedule
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping expire-provider-presence schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'expire-provider-presence') then
    perform cron.unschedule('expire-provider-presence');
  end if;

  -- pg_cron 1.6.4 (deployed) supports second-granularity schedules.
  -- If an older instance does not, the exception falls back to every minute.
  begin
    perform cron.schedule(
      'expire-provider-presence',
      '15 seconds',
      $cron$select public.expire_provider_presence()$cron$
    );
  exception when others then
    raise notice 'pg_cron does not support second-granularity; falling back to every-minute schedule for expire-provider-presence';
    perform cron.schedule(
      'expire-provider-presence',
      '* * * * *',
      $cron$select public.expire_provider_presence()$cron$
    );
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Backfill: seed one row per existing provider from their current state.
-- ---------------------------------------------------------------------------
insert into public.provider_presence (provider_id, online, last_seen_at, updated_at)
select
  p.id                                                         as provider_id,
  coalesce(
    p.is_available
    and p.presence_online
    and p.last_active_at is not null
    and p.last_active_at > now() - interval '75 seconds',
    false
  )                                                            as online,
  date_trunc('minute', p.last_active_at)                       as last_seen_at,
  now()                                                        as updated_at
from   public.profiles p
where  p.role = 'provider'
on conflict (provider_id) do nothing;
