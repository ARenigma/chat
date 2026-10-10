-- pgTAP for 194: profile saves lock their row; photo deletes are serialized
--   1. a save that resends the unchanged name right after a rename succeeds
--   2. and writes the other fields
--   3. without moving the rename stamp
--   4. a real second rename inside the cooldown is still refused
--   5. the photo delete guard takes the per-provider lock before counting
--      (the race itself needs two sessions; the lock is what closes it)

\set ON_ERROR_STOP on
begin;
select plan(5);

insert into auth.users (id) values
  ('c9400000-0000-4940-8000-000000000001');

update public.profiles
set role                 = 'provider',
    display_name         = 'Before194',
    headline             = 'Here to listen',
    about                = 'Provider for the 194 suite.',
    languages            = array['English'],
    date_of_birth        = (current_date - interval '30 years')::date,
    identity_verified_at = now()
where id = 'c9400000-0000-4940-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c9400000-0000-4940-8000-000000000001","role":"authenticated"}';

-- A rename stamps the cooldown.
select public.update_provider_profile('Here to listen', 'Provider for the 194 suite.',
       array['English'], 'After194');

reset role;
create temp table stamp194 as
  select display_name_changed_at as at from public.profiles
  where id = 'c9400000-0000-4940-8000-000000000001';
grant select on stamp194 to authenticated;

set local role authenticated;
select lives_ok(
  $$ select public.update_provider_profile('A new headline', 'Provider for the 194 suite.',
       array['English'], 'After194') $$,
  '1. resending the unchanged name inside the cooldown does not fail the save');

reset role;
select is(
  (select headline from public.profiles where id = 'c9400000-0000-4940-8000-000000000001'),
  'A new headline',
  '2. the other fields are written');

select is(
  (select display_name_changed_at from public.profiles
    where id = 'c9400000-0000-4940-8000-000000000001'),
  (select at from stamp194),
  '3. the rename stamp does not move');

set local role authenticated;
select throws_ok(
  $$ select public.update_provider_profile('A new headline', 'Provider for the 194 suite.',
       array['English'], 'Third194') $$,
  '22023',
  'display names can only change once every 30 days',
  '4. a real second rename inside the cooldown is still refused');

reset role;
select matches(
  pg_get_functiondef('public.provider_photos_delete_guard()'::regprocedure),
  'pg_advisory_xact_lock\(hashtextextended\(''provider_photos:'' \|\| old\.provider_id::text, 0\)\);\s+select count\(\*\) into v_count',
  '5. the photo delete guard locks per provider before it counts');

select * from finish();
rollback;
