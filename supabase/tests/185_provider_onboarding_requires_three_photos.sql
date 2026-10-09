-- pgTAP for migration 185: going live needs at least three photos.
--
--  1. no photos            -> refused (22023)
--  2. two photos           -> refused (22023): the floor is three, not "some"
--  3. the member is still a member after the refusals (nothing half-applied)
--  4. three photos         -> onboarding succeeds
--  5. ...and the caller is now a provider
--  6. exactly one of the three is the primary (070's trigger), so "one
--     primary" needs no check of its own in the RPC
--  7. while still a MEMBER, owning photos does not put a real photo on the
--     profile (the avatar mirror is provider-only)
--  8. going live sets the avatar to the main photo

\set ON_ERROR_STOP on
begin;
select plan(8);

insert into auth.users (id) values ('cc185000-0000-4185-8000-000000000001');

update public.profiles
set    identity_state       = 'verified',
       identity_verified_at = now()
where  id = 'cc185000-0000-4185-8000-000000000001';
insert into public.provider_tax_profile (provider_id, verified_dob)
values ('cc185000-0000-4185-8000-000000000001', (current_date - interval '30 years')::date);

-- 189: accept terms, privacy AND the provider agreement so those gates don't
-- interfere with what this suite is actually testing (the photo floor).
select test.accept_current_policies('cc185000-0000-4185-8000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc185000-0000-4185-8000-000000000001","role":"authenticated"}';

select public.accept_current_provider_agreement();

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Photos185', 'Here to listen', array['Hindi'], 'About me', 'listener', 'female')$$,
  '22023', 'add at least 3 photos of yourself',
  '1. no photos: refused'
);

insert into public.provider_photos (provider_id, url)
select 'cc185000-0000-4185-8000-000000000001',
       'https://example.test/storage/v1/object/public/avatars/cc185/' || n || '.jpg'
from   generate_series(1, 2) n;

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Photos185', 'Here to listen', array['Hindi'], 'About me', 'listener', 'female')$$,
  '22023', 'add at least 3 photos of yourself',
  '2. two photos: refused'
);

reset role;
select is(
  (select role from public.profiles where id = 'cc185000-0000-4185-8000-000000000001'),
  'member',
  '3. still a member after the refusals'
);
select is(
  (select count(*)::int from public.profiles
   where id = 'cc185000-0000-4185-8000-000000000001'
     and avatar_url like '%example.test%'),
  0,
  '7. a member with photos does not get a real photo as their avatar'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc185000-0000-4185-8000-000000000001","role":"authenticated"}';
insert into public.provider_photos (provider_id, url)
values ('cc185000-0000-4185-8000-000000000001',
        'https://example.test/storage/v1/object/public/avatars/cc185/3.jpg');

select lives_ok(
  $$select public.complete_provider_onboarding(
      'Photos185', 'Here to listen', array['Hindi'], 'About me', 'listener', 'female')$$,
  '4. three photos: onboarding succeeds'
);

reset role;
select is(
  (select role from public.profiles where id = 'cc185000-0000-4185-8000-000000000001'),
  'provider',
  '5. and the caller is a provider'
);
select is(
  (select count(*)::int from public.provider_photos
   where provider_id = 'cc185000-0000-4185-8000-000000000001' and is_primary),
  1,
  '6. exactly one of the photos is primary'
);

select is(
  (select avatar_url from public.profiles where id = 'cc185000-0000-4185-8000-000000000001'),
  (select url from public.provider_photos
   where provider_id = 'cc185000-0000-4185-8000-000000000001' and is_primary),
  '8. going live sets the avatar to the main photo'
);

select * from finish();
rollback;
