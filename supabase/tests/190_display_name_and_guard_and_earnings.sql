-- pgTAP for 190:
--   C6a — display name validation in update_provider_profile
--     1. reserved word (pappal) is refused
--     2. duplicate name (case-insensitive) is refused
--     3. a name changed less than 30 days ago is refused (cooldown)
--     4. a valid name change is accepted and written
--     5. too-short name (1 char) is refused
--     6. phone number in name is refused
--   C6b — direct client write guard on provider profile columns
--     7. authenticated direct PATCH of a provider's display_name is refused
--     8. authenticated direct PATCH of a provider's about is refused
--     9. authenticated direct PATCH of a member's display_name still works
--       (member rows are not guarded)
--   D1 — provider_earnings pending/paid split
--    10. pending_tokens counts status='pending' and 'cleared' rows only
--    11. paid_tokens counts status='paid' rows only
--    12. refunded rows are excluded from both
--   D2 — get_usage_ledger excludes refunded earnings
--    13. a refunded provider row returns tokens = 0
--    14. a paid provider row returns its actual tokens

\set ON_ERROR_STOP on
begin;
select plan(16);

-- -----------------------------------------------------------------
-- Test fixtures
-- -----------------------------------------------------------------

insert into auth.users (id) values
  ('c9000000-0000-4900-8000-000000000001'),  -- provider_a (the actor in most tests)
  ('c9000000-0000-4900-8000-000000000002'),  -- provider_b (holds 'TakenName' for dup test)
  ('c9000000-0000-4900-8000-000000000003');  -- member (for test 9)

-- Set up provider_a
update public.profiles
set role                 = 'provider',
    display_name         = 'OldName190',
    headline             = 'Here to listen',
    about                = 'Provider A for the 190 suite.',
    languages            = array['English'],
    date_of_birth        = (current_date - interval '30 years')::date,
    identity_verified_at = now()
where id = 'c9000000-0000-4900-8000-000000000001';

-- Set up provider_b with a name we will try to duplicate
update public.profiles
set role         = 'provider',
    display_name = 'TakenName',
    headline     = 'Here to listen',
    about        = 'Provider B holds TakenName.',
    languages    = array['English'],
    date_of_birth        = (current_date - interval '30 years')::date,
    identity_verified_at = now()
where id = 'c9000000-0000-4900-8000-000000000002';

-- Set up member
update public.profiles
set display_name = 'Member190'
where id = 'c9000000-0000-4900-8000-000000000003';

-- -----------------------------------------------------------------
-- C6a — display name validation
-- -----------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"c9000000-0000-4900-8000-000000000001","role":"authenticated"}';

-- 1. Reserved word is refused.
select throws_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'PappalGuru') $$,
  '22023', 'that name is not available',
  '1. a name containing a reserved word is refused');

-- 2. Duplicate name (case-insensitive) is refused.
select throws_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'takenname') $$,
  '22023', 'that name is already taken',
  '2. a name already held by another provider is refused');

-- 4. A valid name change is accepted. (Run before test 3 so there is a change
--    timestamp to test cooldown against.)
select lives_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'NewName190') $$,
  '4. a valid display name change is accepted');

-- Confirm the name was written.
select is(
  (select display_name from public.profiles
   where id = 'c9000000-0000-4900-8000-000000000001'),
  'NewName190',
  '4a. the new display name is stored on the profile');

-- Confirm display_name_changed_at was set.
select ok(
  (select display_name_changed_at is not null
   from public.profiles where id = 'c9000000-0000-4900-8000-000000000001'),
  '4b. display_name_changed_at is now set');

-- 3. A second change within 30 days is refused. (Name was just changed above.)
select throws_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'AnotherName') $$,
  '22023', 'display names can only change once every 30 days',
  '3. a name change within 30 days of the last one is refused');

-- 5. Too-short name (1 char) is refused.
-- Reset changed_at to simulate a name that is stale enough, then try a bad name.
reset role;
update public.profiles
set display_name_changed_at = now() - interval '31 days'
where id = 'c9000000-0000-4900-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"c9000000-0000-4900-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'A') $$,
  '22023', 'a display name is 2 to 30 characters',
  '5. a 1-character name is refused');

-- 6. Phone number in name is refused.
select throws_ok(
  $$ select public.update_provider_profile('Here to listen', 'Provider A for the 190 suite.',
       array['English'], 'Calm9876543210') $$,
  '22023', 'don''t put a phone number in your display name',
  '6. a name containing a phone number is refused');

-- -----------------------------------------------------------------
-- C6b — direct client write guard
-- -----------------------------------------------------------------

-- 7. Direct PATCH of a provider's display_name is refused.
select throws_ok(
  $$ update public.profiles set display_name = 'DirectPatch'
     where id = 'c9000000-0000-4900-8000-000000000001' $$,
  '42501',
  'direct writes to provider profile fields are not permitted; use update_provider_profile',
  '7. direct client PATCH of provider display_name is refused');

-- 8. Direct PATCH of a provider's about is refused.
select throws_ok(
  $$ update public.profiles set about = 'Patched about'
     where id = 'c9000000-0000-4900-8000-000000000001' $$,
  '42501',
  'direct writes to provider profile fields are not permitted; use update_provider_profile',
  '8. direct client PATCH of provider about is refused');

-- 9. Direct PATCH of a member's display_name still works (member rows are not guarded).
-- Note: in practice members go through claim_member_profile (SECURITY DEFINER),
-- but the column must remain technically writable for member rows so that guard
-- does not break them.
set local request.jwt.claims = '{"sub":"c9000000-0000-4900-8000-000000000003","role":"authenticated"}';
select lives_ok(
  $$ update public.profiles set display_name = 'MemberPatched'
     where id = 'c9000000-0000-4900-8000-000000000003' $$,
  '9. direct client PATCH of a member''s display_name is not blocked');

-- -----------------------------------------------------------------
-- D1 — provider_earnings pending/paid split
-- -----------------------------------------------------------------

reset role;

-- Seed three ledger rows for provider_a: pending, paid, refunded.
-- paid_sessions rows are needed for the view's LEFT JOIN.
insert into public.paid_sessions (
  id, provider_id, member_id, channel, started_at, accepted_at, ended_at,
  minutes_billed, tokens_debited, rate_tokens_per_min, status
) values
  ('d1000000-0000-4100-8000-000000000001',
   'c9000000-0000-4900-8000-000000000001',
   'c9000000-0000-4900-8000-000000000003',
   'chat', now() - interval '10 days', now() - interval '10 days',
   now() - interval '10 days' + interval '5 minutes', 5, 50, 10, 'ended'),
  ('d1000000-0000-4100-8000-000000000002',
   'c9000000-0000-4900-8000-000000000001',
   'c9000000-0000-4900-8000-000000000003',
   'chat', now() - interval '9 days', now() - interval '9 days',
   now() - interval '9 days' + interval '3 minutes', 3, 30, 10, 'ended'),
  ('d1000000-0000-4100-8000-000000000003',
   'c9000000-0000-4900-8000-000000000001',
   'c9000000-0000-4900-8000-000000000003',
   'chat', now() - interval '8 days', now() - interval '8 days',
   now() - interval '8 days' + interval '2 minutes', 2, 20, 10, 'ended');

insert into public.provider_earnings_ledger (
  id, provider_id, session_id, minutes_billed, gross_tokens, provider_tokens,
  rate_per_min, status, hold_until, transaction_id
) values
  ('e1000000-0000-4100-8000-000000000001',
   'c9000000-0000-4900-8000-000000000001',
   'd1000000-0000-4100-8000-000000000001',
   5, 50, 30, 10, 'pending', now() + interval '5 days', null),
  ('e1000000-0000-4100-8000-000000000002',
   'c9000000-0000-4900-8000-000000000001',
   'd1000000-0000-4100-8000-000000000002',
   3, 30, 18, 10, 'paid', now() - interval '2 days', null),
  ('e1000000-0000-4100-8000-000000000003',
   'c9000000-0000-4900-8000-000000000001',
   'd1000000-0000-4100-8000-000000000003',
   2, 20, 12, 10, 'refunded', now() - interval '1 day', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"c9000000-0000-4900-8000-000000000001","role":"authenticated"}';

-- 10. pending_tokens = 30 (the 'pending' row; refunded excluded, paid excluded).
select is(
  (select pending_tokens from public.provider_earnings),
  30::bigint,
  '10. pending_tokens counts pending (and cleared) rows only');

-- 11. paid_tokens = 18 (the 'paid' row; pending and refunded excluded).
select is(
  (select paid_tokens from public.provider_earnings),
  18::bigint,
  '11. paid_tokens counts paid rows only');

-- 12. provider_tokens (total net) = 30 + 18 = 48 (refunded excluded entirely).
select is(
  (select provider_tokens from public.provider_earnings),
  48::bigint,
  '12. provider_tokens excludes the refunded row');

-- -----------------------------------------------------------------
-- D2 — get_usage_ledger excludes refunded earnings (tokens = 0)
-- -----------------------------------------------------------------

-- 13. The refunded row appears with tokens = 0.
select is(
  (select (elem->>'tokens')::int
   from jsonb_array_elements(public.get_usage_ledger()) as elem
   where elem->>'session_id' = 'd1000000-0000-4100-8000-000000000003'),
  0,
  '13. a refunded provider row appears with tokens = 0 in get_usage_ledger');

-- 14. The paid row appears with its actual provider_tokens value.
select is(
  (select (elem->>'tokens')::int
   from jsonb_array_elements(public.get_usage_ledger()) as elem
   where elem->>'session_id' = 'd1000000-0000-4100-8000-000000000002'),
  18,
  '14. a paid provider row appears with its actual tokens in get_usage_ledger');

select * from finish();
rollback;
