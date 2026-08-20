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

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now()
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
create or replace function test.apply_supabase_grants()
returns void language plpgsql as $$
begin
  grant usage on schema public to anon, authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public
    to anon, authenticated;
end;
$$;
