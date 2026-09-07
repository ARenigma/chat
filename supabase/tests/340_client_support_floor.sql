-- pgTAP for migration 080: the server's minimum supported client.
--
-- Assertion 5 is the one that earns this file. 080 re-creates
-- `get_public_config` in full in order to add one value to its allowlist, and
-- reproducing a function body to change one line is exactly how migration 054
-- silently dropped four guards. So the other three public domains are asserted
-- individually here: if a future edit to that allowlist loses one, the app
-- stops being able to read its kill switches pre-auth and nothing else in the
-- suite would notice.
--
-- 1. the domain is registered
-- 2. prod has an active payload, and it carries min_version_code
-- 3. the floor seeds to 0 — "no floor" — rather than to a version
-- 4. anon can read it, which is the whole point of a pre-auth gate
-- 5. the three pre-existing public domains still resolve for anon
-- 6. a domain outside the allowlist is still refused
-- 7. an authenticated-only domain is still refused through the public door

\set ON_ERROR_STOP on
begin;
select plan(9);

-- ---------------------------------------------------------------------------
-- Registration and seed
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from admin.config_domains where key = 'client_support'),
  '1. the client_support domain is registered'
);

select ok(
  exists (
    select 1 from admin.config_active
    where domain = 'client_support'
      and environment = 'prod'
      and payload ? 'min_version_code'
  ),
  '2. prod has an active payload carrying min_version_code'
);

-- Seeding a real version here would read as protection that does not exist:
-- only a client that HAS the gate can honour it, and the gate ships in 10111,
-- which is already above any floor we could name today. Raising it is a
-- deliberate act, documented in 080's runbook.
select is(
  (select (payload ->> 'min_version_code')::int from admin.config_active
   where domain = 'client_support' and environment = 'prod'),
  0,
  '3. the floor seeds to 0, meaning no floor'
);

-- ---------------------------------------------------------------------------
-- Reachable before sign-in
-- ---------------------------------------------------------------------------
-- The gate fails OPEN on an unreadable config (src/lib/clientSupport.ts), so a
-- broken grant would not raise anywhere — it would silently disable the gate.
-- That is the same class of invisible failure 080 exists to end, so the anon
-- read is asserted rather than assumed.
set local role anon;

select is(
  (public.get_public_config('client_support') ->> 'min_version_code')::int,
  0,
  '4. anon can read the floor'
);

-- ---------------------------------------------------------------------------
-- The allowlist 080 rewrote, item by item
-- ---------------------------------------------------------------------------
select isnt(
  public.get_public_config('kill_switches'),
  null,
  '5. kill_switches is still publicly readable'
);

select isnt(
  public.get_public_config('auth_ui'),
  null,
  '6. auth_ui is still publicly readable'
);

select isnt(
  public.get_public_config('permissions'),
  null,
  '7. permissions is still publicly readable'
);

-- ---------------------------------------------------------------------------
-- And the door is still shut on everything else
-- ---------------------------------------------------------------------------
-- `economics` carries the rates. Widening the allowlist by accident is the
-- failure mode in the other direction, and it would leak commercial config to
-- anon.
select throws_ok(
  $$select public.get_public_config('economics')$$,
  '42501', null,
  '8. an authenticated-only domain is still refused at the public door'
);

select throws_ok(
  $$select public.get_public_config('not_a_domain')$$,
  '42501', null,
  '9. an unknown domain is refused rather than returning null'
);

select * from finish();
rollback;
