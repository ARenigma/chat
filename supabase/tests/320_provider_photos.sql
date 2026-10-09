-- pgTAP for migration 070: a provider's gallery, and which photo is the face.
--
--  1. the first photo is primary without the client saying so
--  2. ...and profiles.avatar_url mirrors it, written in SQL and not by the app
--  3. a second photo is not primary, and the face does not move
--  4. promoting the second is ONE statement: the old primary is demoted and
--     avatar_url follows, with no window in which two rows are primary
--  5. a provider cannot rewrite the url of a photo already published
--  6. ...nor clear is_primary, which would leave a gallery with no face
--  7. a member cannot insert a photo into somebody else's gallery
--  8. ...nor delete one
--  9. an authenticated member CAN read a LISTED provider's gallery
-- 10. ...and sees nothing at all for a provider who is not listed
-- 11. the seventh photo is refused by the database, not by the client
-- 12. deleting the primary promotes a survivor, and avatar_url follows it
-- 13. a live provider cannot empty the gallery (188; it used to null avatar_url)

\set ON_ERROR_STOP on
begin;
select plan(14);

insert into auth.users (id) values
  ('cc070000-0000-4070-8000-000000000001'),  -- member
  ('cc070000-0000-4070-8000-000000000002'),  -- provider, listed
  ('cc070000-0000-4070-8000-000000000003'); -- provider, unlisted later

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider070',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'cc070000-0000-4070-8000-000000000002';

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider070b',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'cc070000-0000-4070-8000-000000000003';

update public.profiles set display_name = 'Member070'
where  id = 'cc070000-0000-4070-8000-000000000001';

select test.accept_current_policies('cc070000-0000-4070-8000-000000000001');
select test.accept_current_policies('cc070000-0000-4070-8000-000000000002');
select test.accept_current_policies('cc070000-0000-4070-8000-000000000003');

-- ---------------------------------------------------------------------------
-- The provider's own gallery
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc070000-0000-4070-8000-000000000002","role":"authenticated"}';

with ins as (
  insert into public.provider_photos (provider_id, url)
  values (
    'cc070000-0000-4070-8000-000000000002',
    'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/1.jpg'
  )
  returning id
)
insert into test.fixture (k, v) select 'photo070a', id from ins;

select ok(
  (select is_primary from public.provider_photos
   where id = (select v from test.fixture where k = 'photo070a')),
  '1. the first photo is primary without the client saying so'
);

select is(
  (select avatar_url from public.profiles
   where id = 'cc070000-0000-4070-8000-000000000002'),
  'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/1.jpg',
  '2. profiles.avatar_url mirrors the primary, written in SQL'
);

with ins as (
  insert into public.provider_photos (provider_id, url)
  values (
    'cc070000-0000-4070-8000-000000000002',
    'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/2.jpg'
  )
  returning id
)
insert into test.fixture (k, v) select 'photo070b', id from ins;

select ok(
  not (select is_primary from public.provider_photos
       where id = (select v from test.fixture where k = 'photo070b'))
  and (select avatar_url from public.profiles
       where id = 'cc070000-0000-4070-8000-000000000002')
      = 'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/1.jpg',
  '3. a second photo is not primary, and the face does not move'
);

-- One statement. The BEFORE trigger demotes the old primary and the AFTER
-- trigger rewrites avatar_url, so the client never issues a second write that
-- could race, and the partial unique index never sees two primaries.
select lives_ok(
  $$update public.provider_photos set is_primary = true
    where id = (select v from test.fixture where k = 'photo070b')$$,
  '4a. promoting another photo is one statement'
);

select ok(
  (select count(*) = 1 from public.provider_photos
   where provider_id = 'cc070000-0000-4070-8000-000000000002' and is_primary)
  and (select avatar_url from public.profiles
       where id = 'cc070000-0000-4070-8000-000000000002')
      = 'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/2.jpg',
  '4. exactly one primary remains, and avatar_url followed it'
);

select throws_ok(
  $$update public.provider_photos
    set url = 'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/9.jpg'
    where id = (select v from test.fixture where k = 'photo070a')$$,
  '42501', null,
  '5. a provider cannot rewrite the url of a published photo'
);

select throws_ok(
  $$update public.provider_photos set is_primary = false
    where id = (select v from test.fixture where k = 'photo070b')$$,
  '42501', null,
  '6. ...nor clear is_primary, which would leave a gallery with no face'
);

-- A gallery for the second provider, while they are still listed.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc070000-0000-4070-8000-000000000003","role":"authenticated"}';

insert into public.provider_photos (provider_id, url)
values (
  'cc070000-0000-4070-8000-000000000003',
  'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000003/1.jpg'
);

-- ---------------------------------------------------------------------------
-- What a member may and may not do
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc070000-0000-4070-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$insert into public.provider_photos (provider_id, url)
    values (
      'cc070000-0000-4070-8000-000000000002',
      'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/evil.jpg'
    )$$,
  '42501', null,
  '7. a member cannot insert a photo into somebody else''s gallery'
);

-- RLS filters a DELETE rather than raising, so the assertion is that the row
-- survives: a policy that silently deleted nothing and a policy that deleted
-- the row look identical from the client's error handling.
delete from public.provider_photos
where id = (select v from test.fixture where k = 'photo070a');

select ok(
  exists (select 1 from public.provider_photos
          where id = (select v from test.fixture where k = 'photo070a')),
  '8. ...nor delete one'
);

select ok(
  (select count(*) = 2 from public.provider_photos
   where provider_id = 'cc070000-0000-4070-8000-000000000002'),
  '9. an authenticated member can read a listed provider''s gallery'
);

reset role;
update public.profiles set identity_verified_at = null
where  id = 'cc070000-0000-4070-8000-000000000003';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc070000-0000-4070-8000-000000000001","role":"authenticated"}';

select ok(
  (select count(*) = 0 from public.provider_photos
   where provider_id = 'cc070000-0000-4070-8000-000000000003'),
  '10. ...and sees nothing for a provider who is not listed'
);

-- ---------------------------------------------------------------------------
-- The ceiling, and what a delete does to the face
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc070000-0000-4070-8000-000000000002","role":"authenticated"}';

insert into public.provider_photos (provider_id, url)
values
  ('cc070000-0000-4070-8000-000000000002',
   'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/3.jpg'),
  ('cc070000-0000-4070-8000-000000000002',
   'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/4.jpg'),
  ('cc070000-0000-4070-8000-000000000002',
   'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/5.jpg'),
  ('cc070000-0000-4070-8000-000000000002',
   'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/6.jpg');

select throws_ok(
  $$insert into public.provider_photos (provider_id, url)
    values (
      'cc070000-0000-4070-8000-000000000002',
      'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/7.jpg'
    )$$,
  'P0010', null,
  '11. the seventh photo is refused by the database'
);

delete from public.provider_photos
where id = (select v from test.fixture where k = 'photo070b');

select ok(
  (select count(*) = 1 from public.provider_photos
   where provider_id = 'cc070000-0000-4070-8000-000000000002' and is_primary)
  and (select avatar_url from public.profiles
       where id = 'cc070000-0000-4070-8000-000000000002')
      = 'https://x.supabase.co/storage/v1/object/public/avatars/cc070000-0000-4070-8000-000000000002/1.jpg',
  '12. deleting the primary promotes the oldest survivor, and avatar_url follows'
);

-- 188: a live provider keeps at least three photos, so emptying the gallery
-- is refused rather than nulling the face (it used to null avatar_url here).
select throws_ok(
  $$delete from public.provider_photos
    where provider_id = 'cc070000-0000-4070-8000-000000000002'$$,
  '22023', null,
  '13. a live provider cannot empty the gallery (188)'
);

select * from finish();
rollback;
