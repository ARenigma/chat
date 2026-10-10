-- pgTAP for 192: the rename cooldown column is not client-writable
--   1. a provider cannot clear their own display_name_changed_at directly
--   2. a member cannot write display_name_changed_at directly either
--   3. update_provider_profile still stamps it on a real rename
--   4. and that stamp then blocks a second rename (the cooldown holds)
--   5. the write itself is refused inside the cooldown, so a second rename
--      that passed the RPC's earlier read (a concurrent call) still fails

\set ON_ERROR_STOP on
begin;
select plan(5);

insert into auth.users (id) values
  ('c9200000-0000-4920-8000-000000000001'),  -- provider
  ('c9200000-0000-4920-8000-000000000002');  -- member

update public.profiles
set role                 = 'provider',
    display_name         = 'Before192',
    headline             = 'Here to listen',
    about                = 'Provider for the 192 suite.',
    languages            = array['English'],
    date_of_birth        = (current_date - interval '30 years')::date,
    identity_verified_at = now()
where id = 'c9200000-0000-4920-8000-000000000001';

update public.profiles
set display_name = 'Member192'
where id = 'c9200000-0000-4920-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"c9200000-0000-4920-8000-000000000001","role":"authenticated"}';

-- A rename through the checked RPC stamps the cooldown.
select public.update_provider_profile('Here to listen', 'Provider for the 192 suite.',
       array['English'], 'After192');

select throws_ok(
  $$ update public.profiles set display_name_changed_at = null
     where id = 'c9200000-0000-4920-8000-000000000001' $$,
  '42501',
  'display_name_changed_at is server-managed; use update_provider_profile',
  '1. a provider cannot clear the rename cooldown directly');

set local request.jwt.claims = '{"sub":"c9200000-0000-4920-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set display_name_changed_at = now() - interval '1 year'
     where id = 'c9200000-0000-4920-8000-000000000002' $$,
  '42501',
  'display_name_changed_at is server-managed; use update_provider_profile',
  '2. a member cannot write the rename cooldown directly');

reset role;
select isnt(
  (select display_name_changed_at from public.profiles
    where id = 'c9200000-0000-4920-8000-000000000001'),
  null,
  '3. update_provider_profile stamped the cooldown on the rename');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c9200000-0000-4920-8000-000000000001","role":"authenticated"}';
select throws_like(
  $$ select public.update_provider_profile('Here to listen', 'Provider for the 192 suite.',
       array['English'], 'Again192') $$,
  '%30 days%',
  '4. the stamp blocks a second rename inside the cooldown');

-- 5. Write-time check, as the owner (as a SECURITY DEFINER caller would be):
-- a rename that stamps the column inside the cooldown is refused by the
-- trigger itself, which is what stops the second of two concurrent renames.
-- clock_timestamp(), not now(): now() is this transaction's start, equal to
-- the stamp above; a concurrent call's own transaction stamps a later time.
reset role;
select throws_ok(
  $$ update public.profiles
     set display_name = 'Race192', display_name_changed_at = clock_timestamp()
     where id = 'c9200000-0000-4920-8000-000000000001' $$,
  '22023',
  'display names can only change once every 30 days',
  '5. a stamped rename inside the cooldown is refused at write time');

select * from finish();
rollback;
