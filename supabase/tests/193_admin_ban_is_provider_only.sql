-- pgTAP for 193: admin_ban_provider bans providers only
--   1. a member id is refused with 'provider not found'
--   2. and the member is left unsuspended
--   3. a provider id is still banned to 2999
--   4. with one 'ban' audit row

\set ON_ERROR_STOP on
begin;
select plan(4);

insert into auth.users (id) values
  ('19300000-0000-4193-8000-000000000001'),  -- provider P
  ('19300000-0000-4193-8000-000000000099');  -- member M

update public.profiles
set role                 = 'provider',
    display_name         = 'Ban193',
    date_of_birth        = date '1990-06-15',
    languages            = array['en'],
    identity_verified_at = now()
where id = '19300000-0000-4193-8000-000000000001';

select throws_ok(
  $$ select public.admin_ban_provider(
       '19300000-0000-4193-8000-000000000099'::uuid, 'typo', 'ops@test') $$,
  'P0002',
  'provider not found',
  '1. a member id is refused');

select is(
  (select suspended_until from public.profiles
    where id = '19300000-0000-4193-8000-000000000099'),
  null,
  '2. the member is left unsuspended');

select public.admin_ban_provider(
  '19300000-0000-4193-8000-000000000001'::uuid, 'contact sharing', 'ops@test');

select is(
  (select suspended_until from public.profiles
    where id = '19300000-0000-4193-8000-000000000001'),
  timestamptz '2999-01-01 00:00:00+00',
  '3. a provider is banned to 2999');

select is(
  (select count(*)::int from admin.audit_log
    where action = 'ban' and target_id = '19300000-0000-4193-8000-000000000001'),
  1,
  '4. one ban audit row is written');

select * from finish();
rollback;
