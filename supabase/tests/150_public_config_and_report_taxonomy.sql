-- 150_public_config_and_report_taxonomy.sql
-- pgTAP tests for migration 035:
--   1. get_public_config RPC raises for domains outside the allowlist.
--      Migration 035 uses RAISE with errcode insufficient_privilege (42501),
--      not RETURN NULL, so assertions use throws_ok not is(…, null).
--   2. is_valid_report_reason validates slugs against the active config.
--      Migration 026 seeds report_taxonomy (reasons as a jsonb array); these
--      tests rely on that seeded config being present after the migrations run.
--
-- Run with: supabase test db

\set ON_ERROR_STOP on
begin;

select plan(12);

-- ──────────────────────────────────────────────────────────────────────────────
-- get_public_config: raises for non-allowlisted domains
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. get_public_config raises (errcode 42501) for the auth-only 'economics' domain.
select throws_ok(
  $$ select get_public_config('economics') $$,
  '42501', null,
  'get_public_config raises for auth-only domain economics'
);

-- 2. get_public_config raises for a completely unknown domain.
select throws_ok(
  $$ select get_public_config('__nonexistent__') $$,
  '42501', null,
  'get_public_config raises for unknown domain'
);

-- 3. get_public_config accepts kill_switches (allowlisted in migration 035).
-- We only check it does NOT throw (result may be null if no active version).
select lives_ok(
  $$ select get_public_config('kill_switches') $$,
  'get_public_config does not throw for kill_switches'
);

-- 4. get_public_config accepts auth_ui (allowlisted in migration 035).
select lives_ok(
  $$ select get_public_config('auth_ui') $$,
  'get_public_config does not throw for auth_ui'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- is_valid_report_reason: allowlist validation against the seeded config
-- Migration 026 seeds report_taxonomy with known slugs as a jsonb array.
-- Slugs not present in that array return false; known slugs return true.
-- ──────────────────────────────────────────────────────────────────────────────

-- 5. is_valid_report_reason rejects an empty string.
select is(
  is_valid_report_reason(''),
  false,
  'is_valid_report_reason returns false for empty string'
);

-- 6. is_valid_report_reason rejects a string with spaces.
select is(
  is_valid_report_reason('not a slug'),
  false,
  'is_valid_report_reason returns false for string with spaces'
);

-- 7. is_valid_report_reason rejects a too-long string.
select is(
  is_valid_report_reason(repeat('a', 65)),
  false,
  'is_valid_report_reason returns false for string > 64 chars'
);

-- 8. is_valid_report_reason accepts a well-formed slug.
select is(
  is_valid_report_reason('harassment'),
  true,
  'is_valid_report_reason returns true for harassment'
);

-- 9. is_valid_report_reason accepts underscore-delimited slug.
select is(
  is_valid_report_reason('sexual_content'),
  true,
  'is_valid_report_reason returns true for sexual_content'
);

-- 10. is_valid_report_reason rejects double underscores.
select is(
  is_valid_report_reason('has__double'),
  false,
  'is_valid_report_reason returns false for double underscores'
);

-- 11. is_valid_report_reason rejects leading underscore.
select is(
  is_valid_report_reason('_leading'),
  false,
  'is_valid_report_reason returns false for leading underscore'
);

-- 12. is_valid_report_reason rejects trailing underscore.
select is(
  is_valid_report_reason('trailing_'),
  false,
  'is_valid_report_reason returns false for trailing underscore'
);

select * from finish();

rollback;
