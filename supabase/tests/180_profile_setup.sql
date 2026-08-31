-- 180_profile_setup.sql
-- pgTAP tests for migration 040 profile setup RPCs.

\set ON_ERROR_STOP on
begin;

select plan(6);

-- ── check_display_name ───────────────────────────────────────────────────────

select is(
  (check_display_name('ab') ->> 'status'),
  'invalid',
  'check_display_name rejects too-short names'
);

select is(
  (check_display_name('valid_name') ->> 'status'),
  'available',
  'check_display_name accepts a fresh valid name'
);

select is(
  (check_display_name('valid_name with space') ->> 'status'),
  'invalid',
  'check_display_name rejects spaces'
);

-- ── claim_member_profile guard ───────────────────────────────────────────────

select throws_ok(
  $$ select claim_member_profile('takenlater', 'ada') $$,
  '42501',
  null,
  'claim_member_profile requires auth'
);

select is(
  (check_display_name('') ->> 'status'),
  'invalid',
  'check_display_name rejects empty'
);

select throws_ok(
  $$ select seed_conversation_openers(gen_random_uuid()) $$,
  '42501',
  null,
  'seed_conversation_openers requires auth'
);

select * from finish();
rollback;
