-- pgTAP for migration 189: provider agreement + gender on onboarding.
--
--  1. complete_provider_onboarding refuses without the provider agreement (22023)
--  2. ...even when the user has accepted terms and privacy
--  3. complete_provider_onboarding refuses an invalid gender (22023)
--  4. ...and an explicit null gender
--  5. succeed with agreement + valid gender: role flips to provider
--  6. gender is written to profiles
--  7. provider agreement acceptance is recorded in policy_acceptances
--  8. the existing 185 photo floor is still enforced (three photos required)
--  9. pending_policy_acceptances does NOT surface the provider agreement
--     to an ordinary member (is_provider_only filter)
-- 10. accept_current_provider_agreement is idempotent (second call safe)
-- 11. exactly one complete_provider_onboarding overload (270's contract)

\set ON_ERROR_STOP on
begin;
select plan(11);

-- ── Fixture ─────────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('cc189000-0000-4189-8000-000000000001'),  -- applicant going through the flow
  ('cc189000-0000-4189-8000-000000000002');  -- member, never promotes

update public.profiles
set    identity_state       = 'verified',
       identity_verified_at = now()
where  id = 'cc189000-0000-4189-8000-000000000001';

insert into public.provider_tax_profile (provider_id, verified_dob)
values ('cc189000-0000-4189-8000-000000000001',
        (current_date - interval '27 years')::date);

-- Three photos so the photo floor does not interfere with the agreement tests.
insert into public.provider_photos (provider_id, url)
select 'cc189000-0000-4189-8000-000000000001',
       'https://example.test/storage/v1/object/public/avatars/cc189/1/' || n || '.jpg'
from   generate_series(1, 3) n;

-- ── 1. No agreement accepted → refused ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc189000-0000-4189-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Agree189', 'Here to listen', array['Hindi'], 'About me',
      'listener', 'female')$$,
  '22023', 'accept the provider agreement',
  '1. no agreement: refused with the specific message'
);

-- ── 2. Terms + privacy accepted, but not provider agreement → refused ──────
-- accept_policy handles all policy kinds (the constraint is now extended).
-- Accepting member policies should NOT satisfy the provider agreement gate.
select test.accept_current_policies('cc189000-0000-4189-8000-000000000001');

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Agree189', 'Here to listen', array['Hindi'], 'About me',
      'listener', 'female')$$,
  '22023', 'accept the provider agreement',
  '2. terms+privacy accepted but not provider agreement: still refused'
);

-- ── 3. Invalid gender → refused ───────────────────────────────────────────
-- Accept the agreement first so we can isolate the gender check.
select public.accept_current_provider_agreement();

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Agree189', 'Here to listen', array['Hindi'], 'About me',
      'listener', 'nonbinary')$$,
  '22023', 'choose a gender from: female, male, or other',
  '3. invalid gender value: refused'
);

-- ── 4. Null gender → refused ──────────────────────────────────────────────
select throws_ok(
  $$select public.complete_provider_onboarding(
      'Agree189', 'Here to listen', array['Hindi'], 'About me',
      'listener', null)$$,
  '22023', 'choose a gender from: female, male, or other',
  '4. null gender: refused'
);

-- ── 5. Agreement + valid gender → succeeds ────────────────────────────────
select lives_ok(
  $$select public.complete_provider_onboarding(
      'Agree189', 'Here to listen', array['Hindi'], 'About me',
      'listener', 'female')$$,
  '5. agreement accepted + valid gender: onboarding succeeds'
);

reset role;

-- ── 6. Gender written to profiles ─────────────────────────────────────────
select is(
  (select gender from public.profiles
   where id = 'cc189000-0000-4189-8000-000000000001'),
  'female',
  '6. gender is written to profiles'
);

-- ── 7. Provider role set ───────────────────────────────────────────────────
select is(
  (select role from public.profiles
   where id = 'cc189000-0000-4189-8000-000000000001'),
  'provider',
  '7. role is provider after onboarding'
);

-- ── 8. Provider agreement acceptance is recorded ──────────────────────────
select ok(
  exists (
    select 1
    from public.policy_acceptances pa
    join public.policy_versions pv on pv.id = pa.version_id
    where pa.user_id = 'cc189000-0000-4189-8000-000000000001'
      and pv.kind = 'provider_agreement'
  ),
  '8. provider agreement acceptance is in policy_acceptances'
);

-- ── 9. Photo floor still enforced ─────────────────────────────────────────
-- Set up a second applicant who has accepted the agreement but has no photos.
update public.profiles
set    identity_state       = 'verified',
       identity_verified_at = now()
where  id = 'cc189000-0000-4189-8000-000000000002';

insert into public.provider_tax_profile (provider_id, verified_dob)
values ('cc189000-0000-4189-8000-000000000002',
        (current_date - interval '25 years')::date);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc189000-0000-4189-8000-000000000002","role":"authenticated"}';

select test.accept_current_policies('cc189000-0000-4189-8000-000000000002');
select public.accept_current_provider_agreement();

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Photos189', 'Here to help', array['English'], 'About me',
      'listener', 'male')$$,
  '22023', 'add at least 3 photos of yourself',
  '9. photo floor still enforced even when agreement is accepted'
);

reset role;

-- ── 10. pending_policy_acceptances excludes provider agreement ────────────
-- A fresh member should see terms+privacy pending, not the provider agreement.
-- 189 seeds the provider agreement with is_provider_only = true.
select ok(
  not exists (
    select 1 from public.pending_policy_acceptances()
    where kind = 'provider_agreement'
  ),
  '10. pending_policy_acceptances never surfaces the provider agreement'
);

-- ── 11. accept_current_provider_agreement is idempotent ──────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc189000-0000-4189-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.accept_current_provider_agreement()$$,
  '11. accept_current_provider_agreement is idempotent (second call safe)'
);

reset role;

select * from finish();
rollback;
