-- pgTAP for migration 133: a client can neither delete its profile nor insert
-- one, so it cannot re-create itself with a balance, role, or verified phone.

\set ON_ERROR_STOP on
begin;
select plan(4);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  '1. authenticated has no INSERT on profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  '2. authenticated has no DELETE on profiles'
);

insert into auth.users (id) values ('aa530000-0000-4000-8000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa530000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ delete from public.profiles where id = 'aa530000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  '3. the owner cannot delete their own profile row'
);

select throws_ok(
  $$ insert into public.profiles (id, promo_balance)
     values ('aa530000-0000-4000-8000-000000000001', 100000) $$,
  '42501',
  null,
  '4. the owner cannot insert a profile with a balance'
);

select * from finish();
rollback;
