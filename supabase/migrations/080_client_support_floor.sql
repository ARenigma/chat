-- ===========================================================================
-- 080  The server says which clients it will still talk to
-- ===========================================================================
-- Amit, 2026-09-08, after two testers spent an evening on a build that could
-- not work: "why is this not working? any tool to use here for easy production
-- checks like these and bug fixes".
--
-- ---------------------------------------------------------------------------
-- The incident this exists for
-- ---------------------------------------------------------------------------
-- Migrations 077-079 changed the chat session contract. A provider's reply now
-- sets `responded_at` and leaves the request `pending`; the MEMBER completes it
-- by calling `confirm_chat_session` from a consent sheet. That sheet shipped in
-- versionCode 10110.
--
-- Two testers were on 10109, whose ChatScreen contains no such sheet — verified
-- rather than assumed: `git show 5a2daa5:src/screens/ChatScreen.tsx` has ZERO
-- occurrences of `awaitingMemberConsent`, against 5 at HEAD. So their requests
-- sat `pending` with `responded_at` set and nothing could ever advance them. No
-- session, so no timer and no ticks; and calls stayed blocked behind an
-- active-session check that could not be satisfied. One live example is still in
-- the table: request e859e4b0, created 2026-09-07 18:26:31Z, responded 49
-- seconds later, still pending.
--
-- **Nothing was broken.** The client did what 10109 says, the server did what
-- 079 says, RLS allowed the read, the row was in the realtime publication, and
-- `get_pending_session_request` returned the row correctly when called as that
-- member. Every layer was right and the composition was a deadlock, with no
-- exception thrown anywhere — so no error on the device, none in the logs, and
-- nothing in Sentry. No amount of code review on either side would have found
-- it, because neither side is wrong.
--
-- An old client against a migrated server is not a bug to catch. It is a state
-- to refuse, out loud, at boot. That is what this domain is for.
--
-- ---------------------------------------------------------------------------
-- Why the seeded value is 0 and not 10110
-- ---------------------------------------------------------------------------
-- Only a client that HAS the gate can honour it, and the gate ships in 10111.
-- Every 10111+ client is already above 10110, so seeding 10110 would change
-- nothing for anybody while reading like protection that exists. It does not:
-- this migration cannot rescue the two phones currently stuck on 10109, and
-- nothing in the database can. Only a Play update reaches them.
--
-- So the floor starts at 0, meaning "no floor", and raising it is a deliberate
-- operational act:
--
--   RUNBOOK — when a migration changes an RPC contract the old app cannot meet,
--   publish a new `client_support` version with `min_version_code` set to the
--   first build that speaks the new contract. Clients below it then get an
--   honest "time for an update" screen instead of a silent deadlock. Raise it in
--   the SAME change that ships the migration, not afterwards.
--
-- ---------------------------------------------------------------------------
-- Why a domain of its own, and why public
-- ---------------------------------------------------------------------------
-- Not a field on `kill_switches`, because the two have opposite failure modes:
-- a kill switch failing open leaves a feature on, which is recoverable, while
-- this one decides whether the app opens at all. It is worth its own name so
-- nobody edits it while meaning to toggle something else.
--
-- Public (`get_public_config`) rather than authenticated, because an
-- unsupported build must be told before it signs in. The only thing it cannot
-- do is satisfy the RPC contract, so authenticating first just carries it
-- deeper into a tree where nothing works. A version floor is not a secret.
--
-- The CLIENT fails OPEN on an unreachable config (`FALLBACK_CLIENT_SUPPORT` is
-- `min_version_code: 0`), and that asymmetry is deliberate — see
-- `src/lib/clientSupport.ts`. A gate that fails closed turns "no network for
-- ten seconds" into a brick, and the update it demands needs the network the
-- person does not have.

-- ---------------------------------------------------------------------------
-- 1. Register the domain
-- ---------------------------------------------------------------------------
insert into admin.config_domains (key, description)
values (
  'client_support',
  'Lowest app versionCode this server will serve. 0 = no floor. Raise it in '
  'the same change as a migration that breaks the client contract.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Seed an active version for both environments
-- ---------------------------------------------------------------------------
-- Same shape as 059's media_cogs seed, including the `continue` guard so a
-- re-run cannot publish a second version 1 over a floor an operator has since
-- raised by hand. That guard is the only reason this is safe to keep in the
-- migration list after someone edits the value in the admin UI.
do $$
declare
  v_payload jsonb := '{
    "min_version_code": 0
  }';
  v_env text;
  v_id uuid;
  v_sha text;
begin
  v_sha := encode(sha256(v_payload::text::bytea), 'hex');

  foreach v_env in array array['staging', 'prod'] loop
    if exists (
      select 1 from admin.config_active
      where domain = 'client_support' and environment = v_env
    ) then
      continue;
    end if;

    v_id := gen_random_uuid();

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'client_support', v_env, 1, 'active',
       v_payload, v_sha, now(),
       'migration_080', 'migration_080', now(),
       'Initial client support floor: 0, meaning no floor');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('client_support', v_env, v_id, v_payload, now(), now());

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', 'client_support', v_id, 'migration_080',
       'Initial client_support seed for ' || v_env);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Make it readable before sign-in
-- ---------------------------------------------------------------------------
-- 040's version of this function is reproduced with one more domain in the
-- allowlist. Reproducing a whole function body to add one value is normally the
-- mistake 054 made and 063's header warns about — it is acceptable here only
-- because the entire body is these two statements and the allowlist IS the
-- function. There is no second behaviour that could be silently dropped.
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
  if p_domain not in ('kill_switches', 'auth_ui', 'permissions', 'client_support') then
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
  'Publicly accessible config for safe domains: kill_switches, auth_ui, '
  'permissions, client_support (080). client_support is deliberately readable '
  'pre-auth: a build too old to satisfy the current RPC contract has to be told '
  'so before it signs in, and a version floor is not a secret.';

grant execute on function public.get_public_config(text) to anon, authenticated;
