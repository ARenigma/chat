-- pgTAP for migration 188: provider cannot delete below 3 photos.
--
--  1. provider at 3 photos cannot delete (22023, 'keep at least 3 photos')
--  2. provider at 4 photos CAN delete (lives_ok)
--  3. provider is at 3 after deleting from 4 (sanity)
--  4. member can delete freely (role check skips the guard)
--  5. account deletion succeeds even when provider has exactly 3 photos
--     (cascade guard is skipped when profile row is gone first)

\set ON_ERROR_STOP on
begin;
select plan(5);

-- ─── provider at exactly 3 photos ────────────────────────────────────────────
insert into auth.users (id) values ('cc188000-0000-4188-8000-000000000001');

-- Promote to provider so the trigger's role check applies.
update public.profiles
set    role                 = 'provider',
       display_name         = 'Guard188',
       headline             = 'Test headline',
       languages            = array['Hindi'],
       about                = 'About guard test',
       identity_state       = 'verified',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'cc188000-0000-4188-8000-000000000001';

insert into public.provider_photos (provider_id, url)
select 'cc188000-0000-4188-8000-000000000001',
       'https://example.test/storage/v1/object/public/avatars/cc188a/' || n || '.jpg'
from   generate_series(1, 3) n;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc188000-0000-4188-8000-000000000001","role":"authenticated"}';

-- 1. At 3 photos the trigger refuses.
select throws_ok(
  $$delete from public.provider_photos
    where provider_id = 'cc188000-0000-4188-8000-000000000001'
      and id = (
        select id from public.provider_photos
         where provider_id = 'cc188000-0000-4188-8000-000000000001'
         order by created_at asc limit 1
      )$$,
  '22023', 'keep at least 3 photos',
  '1. provider at 3: delete refused'
);

-- ─── provider at 4 photos ────────────────────────────────────────────────────
insert into public.provider_photos (provider_id, url)
values ('cc188000-0000-4188-8000-000000000001',
        'https://example.test/storage/v1/object/public/avatars/cc188a/4.jpg');

-- 2. At 4 photos one delete is allowed.
select lives_ok(
  $$delete from public.provider_photos
    where provider_id = 'cc188000-0000-4188-8000-000000000001'
      and id = (
        select id from public.provider_photos
         where provider_id = 'cc188000-0000-4188-8000-000000000001'
           and not is_primary
         order by created_at asc limit 1
      )$$,
  '2. provider at 4: one delete allowed'
);

reset role;

-- 3. Now back to 3 — the next delete would be refused.
select is(
  (select count(*)::int from public.provider_photos
   where provider_id = 'cc188000-0000-4188-8000-000000000001'),
  3,
  '3. provider has 3 photos after deleting from 4'
);

-- ─── member can delete freely ────────────────────────────────────────────────
insert into auth.users (id) values ('cc188000-0000-4188-8000-000000000002');

insert into public.provider_photos (provider_id, url)
select 'cc188000-0000-4188-8000-000000000002',
       'https://example.test/storage/v1/object/public/avatars/cc188b/' || n || '.jpg'
from   generate_series(1, 2) n;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc188000-0000-4188-8000-000000000002","role":"authenticated"}';

-- 4. Member (role='member') with 2 photos: trigger skips, delete succeeds.
select lives_ok(
  $$delete from public.provider_photos
    where provider_id = 'cc188000-0000-4188-8000-000000000002'
      and id = (
        select id from public.provider_photos
         where provider_id = 'cc188000-0000-4188-8000-000000000002'
         order by created_at asc limit 1
      )$$,
  '4. member can delete freely (role check skips guard)'
);

-- ─── account deletion succeeds with 3 photos ────────────────────────────────
-- delete_user_account runs as the caller's security definer context; the
-- cascade (auth.users → profiles → provider_photos) removes the profile row
-- BEFORE the trigger fires on provider_photos, so NOT FOUND → guard skips.
reset role;

insert into auth.users (id) values ('cc188000-0000-4188-8000-000000000003');

update public.profiles
set    role                 = 'provider',
       display_name         = 'DeleteMe188',
       headline             = 'Test',
       languages            = array['Tamil'],
       about                = 'Delete me',
       identity_state       = 'verified',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'cc188000-0000-4188-8000-000000000003';

insert into public.provider_photos (provider_id, url)
select 'cc188000-0000-4188-8000-000000000003',
       'https://example.test/storage/v1/object/public/avatars/cc188c/' || n || '.jpg'
from   generate_series(1, 3) n;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc188000-0000-4188-8000-000000000003","role":"authenticated"}';

-- 5. Account deletion cascades through photos without the guard blocking it.
select lives_ok(
  $$select public.delete_user_account()$$,
  '5. account deletion succeeds even with exactly 3 photos'
);

select * from finish();
rollback;
