-- Minimal stand-in for the parts of Supabase the migrations depend on, so the
-- real migration files can be executed and asserted against a plain Postgres
-- container. Nothing here ships; it exists only for `npm run test:db`.

-- Platform roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- GoTrue's user table, reduced to the columns the schema references.
create schema if not exists auth;

-- The columns are the ones OUR code touches, not all of GoTrue's — but the set
-- grew on 2026-09-08 and the reason is worth keeping.
--
-- Migration 085 seeds provider accounts and writes the columns Supabase's real
-- auth.users has (`instance_id`, `aud`, `role`, `encrypted_password`,
-- `email_confirmed_at`, `updated_at`), copying the shape `scripts/seed-dev.sql`
-- already uses against a real project. This stub had five columns, so the
-- migration failed here and passed in production — the worst direction for a
-- harness to be wrong in, because it makes the test suite refuse code that
-- works and would have pushed the migration to be written thinner than the
-- database it runs on.
--
-- Nullable and defaulted throughout: nothing here is authenticating, and a NOT
-- NULL the real table does not have would fail a migration prod would accept,
-- which is the same mistake pointing the other way.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  instance_id uuid,
  aud text,
  role text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  updated_at timestamptz
);

-- Same contract as Supabase's: read `sub` out of the request's JWT claims.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
    ''
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;

-- Real Supabase ships this publication; a bare Postgres does not, and migration
-- 003 adds tables to it. Without this the migration fails in the test container
-- for a reason that has nothing to do with the schema under test.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Supabase Vault, reduced to the one view the push triggers read. On a real
-- project `vault.decrypted_secrets` is a view over `vault.secrets`; a bare
-- Postgres has neither. `dispatch_call_push` (migration 017) reads it
-- SYNCHRONOUSLY inside the `calls` insert trigger — unlike the message-push
-- path, which queues and reads vault only in a cron dispatcher guarded by
-- `to_regclass`. Without this stub the very first call insert throws
-- `relation "vault.decrypted_secrets" does not exist` and aborts the calls
-- suite. Empty on purpose: the triggers find no `*_sender_url`, so they return
-- before any `net.http_post`, exactly as they do on a project whose secrets are
-- unset. `vault.secrets` is deliberately NOT stubbed, so migration 009's
-- `to_regclass('vault.secrets')` guard keeps skipping its secret bootstrap.
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (
  name text,
  decrypted_secret text
);

-- ---------------------------------------------------------------------------
-- Test scaffolding
-- ---------------------------------------------------------------------------
create extension if not exists pgtap;

create schema if not exists test;
grant usage on schema test to public;

-- Somewhere to stash ids across role switches, since a non-owner cannot read
-- them back out of the RLS-protected tables.
create table if not exists test.fixture (k text primary key, v uuid);
grant select, insert on test.fixture to public;

-- Table grants Supabase applies by default; the RLS assertions need them.
-- Deferred to a function because the tables do not exist until the migrations
-- have run; the runner calls this afterwards.
-- Supabase's real behaviour is DEFAULT PRIVILEGES, applied when an object is
-- created, not a blanket grant afterwards. The difference is not academic: the
-- old version ran after every migration and therefore silently undid any
-- `revoke ... from authenticated` a migration had just performed, so the suite
-- would report a table as locked down while the harness had quietly reopened it.
--
-- Applied here, before any migration runs, so each CREATE picks it up and an
-- in-migration REVOKE survives.
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;

-- Retained as a no-op so an older db-test.mjs does not fail; the work now
-- happens above, at harness load.
create or replace function test.apply_supabase_grants()
returns void language plpgsql as $$
begin
  grant usage on schema public to anon, authenticated, service_role;
end;
$$;

-- Accept the currently effective Terms and Privacy for a fixture user. Defined
-- before migrations but compiled on first call, after migration 027 has created
-- the policy tables. Tests that exercise UGC must opt in explicitly so the
-- server-required policy gate remains covered rather than globally bypassed.
create or replace function test.accept_current_policies(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, test
as $$
begin
  insert into public.policy_acceptances (user_id, policy_kind, version_id)
  select p_user_id, current_policy.kind, current_policy.id
  from (
    select distinct on (kind) id, kind
    from public.policy_versions
    where effective_at <= now()
    order by kind, version desc
  ) as current_policy
  on conflict (user_id, policy_kind, version_id) do nothing;
end;
$$;
