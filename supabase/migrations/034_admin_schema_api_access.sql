-- ===========================================================================
-- 034  Admin schema API access for the server-only control plane
-- ===========================================================================
-- `admin` is listed in config.toml's exposed PostgREST schemas because the
-- Next.js control plane uses `.schema('admin')`. Exposure is not authorization:
-- anon and authenticated receive no schema privileges, while service_role is
-- confined to server code and bypasses the RLS-enabled admin tables.

grant usage on schema admin to service_role;
grant all on all tables in schema admin to service_role;
grant all on all sequences in schema admin to service_role;
grant all on all routines in schema admin to service_role;

alter default privileges for role postgres in schema admin
  grant all on tables to service_role;
alter default privileges for role postgres in schema admin
  grant all on sequences to service_role;
alter default privileges for role postgres in schema admin
  grant all on routines to service_role;
