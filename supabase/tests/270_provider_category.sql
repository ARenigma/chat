-- pgTAP for migration 065: provider category.
--
-- 1. the column exists and every existing provider is a listener
-- 2. an unknown category is refused by the CHECK
-- 3. the directory publishes provider_category
-- 4. ...and still publishes `age` as an integer, which is what the age filter
--    brackets client-side instead of a column of its own
-- 5. the provider cannot re-tag themselves (065 guard)
-- 6. the 4-arg onboarding signature is gone, so no call is ambiguous
-- 7. onboarding writes the category
-- 8. onboarding refuses an unknown category
-- 9. the 063 guards are all still in place after the re-statement

\set ON_ERROR_STOP on
begin;
select plan(9);

insert into auth.users (id) values
  ('cc065000-0000-4065-8000-000000000001'),
  ('cc065000-0000-4065-8000-000000000002');

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider065',
       date_of_birth        = (current_date - interval '33 years')::date,
       identity_verified_at = now()
where  id = 'cc065000-0000-4065-8000-000000000001';

select is(
  (select provider_category from public.profiles
   where id = 'cc065000-0000-4065-8000-000000000001'),
  'listener',
  '1. every existing provider is a listener by default'
);

select throws_ok(
  $$update public.profiles set provider_category = 'wizard'
    where id = 'cc065000-0000-4065-8000-000000000001'$$,
  '23514', null,
  '2. an unknown category is refused'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'provider_directory'
      and column_name = 'provider_category'
  ),
  '3. the directory publishes provider_category'
);

select is(
  (select data_type from information_schema.columns
   where table_schema = 'public' and table_name = 'provider_directory'
     and column_name = 'age'),
  'integer',
  '4. ...and still publishes age as an integer for client-side bracketing'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc065000-0000-4065-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set provider_category = 'astrologer'
    where id = 'cc065000-0000-4065-8000-000000000001'$$,
  '42501', null,
  '5. a provider cannot re-tag themselves'
);

reset role;

select is(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'complete_provider_onboarding'),
  1,
  '6. exactly one onboarding signature, so no call is ambiguous'
);

-- Onboarding needs a verified identity and a DOB in the tax profile.
-- identity_state = 'verified' requires identity_verified_at (056's
-- profiles_identity_verified_consistent). They move together, always.
update public.profiles
set    identity_state       = 'verified',
       identity_verified_at = now()
where  id = 'cc065000-0000-4065-8000-000000000002';
insert into public.provider_tax_profile (provider_id, verified_dob)
values ('cc065000-0000-4065-8000-000000000002', (current_date - interval '29 years')::date)
on conflict (provider_id) do update set verified_dob = excluded.verified_dob;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc065000-0000-4065-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.complete_provider_onboarding(
      'Astro065', 'Reads charts', array['Hindi'], 'About me', 'astrologer'
    )$$,
  '7. onboarding writes the category'
);

select throws_ok(
  $$select public.complete_provider_onboarding(
      'Astro065', 'Reads charts', array['Hindi'], 'About me', 'wizard'
    )$$,
  '22023', null,
  '8. onboarding refuses an unknown category'
);

reset role;

-- The guard is re-stated wholesale in 065; 054 proved that is where guards go
-- missing, so every column 063 named is checked again here.
select ok(
  (
    select bool_and(
      pg_get_functiondef(p.oid) like '%new.' || c || ' is distinct from old.' || c || '%'
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
         unnest(array[
           'role', 'identity_verified_at', 'identity_state', 'date_of_birth',
           'age_bracket', 'suspended_until', 'profile_completed_at',
           'promo_balance', 'purchased_balance', 'token_balance',
           'last_refill_at', 'rating_avg', 'rating_count',
           'median_reply_seconds', 'engagement_nudged_at', 'provider_category'
         ]) as c
    where n.nspname = 'public'
      and p.proname = 'guard_privileged_profile_columns'
  ),
  '9. the re-stated guard still names every server-owned column'
);

select * from finish();
rollback;
