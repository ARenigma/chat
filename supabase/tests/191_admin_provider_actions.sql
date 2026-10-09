-- pgTAP for 191: admin provider actions, retired paths, payout audit.
--
-- WHAT THIS IS GUARDING:
--   * Admin RPCs refuse a non-service-role caller (1-5).
--   * admin_suspend_provider sets suspended_until and writes admin.audit_log (6-8).
--   * admin_delist_provider sets delisted_at and the provider disappears from
--     provider_directory / provider_is_listed (9-12).
--   * approve_provider_application is callable by no product role (13).

\set ON_ERROR_STOP on
begin;
select plan(13);

-- Seed: one provider P, one ordinary member M.
insert into auth.users (id) values
  ('19100000-0000-4191-8000-000000000001'),  -- provider P
  ('19100000-0000-4191-8000-000000000099');  -- member M

update public.profiles
set role               = 'provider',
    display_name       = 'Test Provider',
    date_of_birth      = date '1990-06-15',
    languages          = array['en'],
    identity_verified_at = now()
where id = '19100000-0000-4191-8000-000000000001';

select test.accept_current_policies(id) from auth.users where id::text like '19100000-%';

-- ── 1-5. Admin RPCs are not callable by authenticated ─────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"19100000-0000-4191-8000-000000000099","role":"authenticated"}';

select throws_ok(
  $$ select public.admin_suspend_provider(
       '19100000-0000-4191-8000-000000000001'::uuid, 3, 'test', 'test') $$,
  '42501',
  null,
  '1. admin_suspend_provider refuses authenticated'
);

select throws_ok(
  $$ select public.admin_lift_suspension(
       '19100000-0000-4191-8000-000000000001'::uuid, 'test', 'test') $$,
  '42501',
  null,
  '2. admin_lift_suspension refuses authenticated'
);

select throws_ok(
  $$ select public.admin_ban_provider(
       '19100000-0000-4191-8000-000000000001'::uuid, 'test', 'test') $$,
  '42501',
  null,
  '3. admin_ban_provider refuses authenticated'
);

select throws_ok(
  $$ select public.admin_delist_provider(
       '19100000-0000-4191-8000-000000000001'::uuid, 'test', 'test') $$,
  '42501',
  null,
  '4. admin_delist_provider refuses authenticated'
);

select throws_ok(
  $$ select public.admin_resolve_refund_review(
       gen_random_uuid(), 'approved', 'test', null) $$,
  '42501',
  null,
  '5. admin_resolve_refund_review refuses authenticated'
);

reset role;

-- ── 6-8. admin_suspend_provider sets suspended_until and writes audit ──────
select public.admin_suspend_provider(
  '19100000-0000-4191-8000-000000000001'::uuid,
  7,
  'test reason',
  'tester@pappal.io'
);

select ok(
  (select suspended_until > now()
   from public.profiles
   where id = '19100000-0000-4191-8000-000000000001'),
  '6. suspend sets suspended_until in the future'
);

select ok(
  (select suspended_until > now() + interval '6 days'
   from public.profiles
   where id = '19100000-0000-4191-8000-000000000001'),
  '7. suspended_until is approximately now + 7 days'
);

select ok(
  (select exists (
     select 1 from admin.audit_log
     where action      = 'suspend'
       and target_id   = '19100000-0000-4191-8000-000000000001'
       and target_type = 'provider'
       and actor       = 'tester@pappal.io'
   )),
  '8. admin_suspend_provider writes an audit_log row'
);

-- ── 9-12. admin_delist_provider hides from directory ──────────────────────
-- First lift the suspension so the provider would otherwise be listed.
select public.admin_lift_suspension(
  '19100000-0000-4191-8000-000000000001'::uuid, 'for delist test', 'tester@pappal.io'
);

-- Confirm listed before delist.
select ok(
  public.provider_is_listed('19100000-0000-4191-8000-000000000001'::uuid),
  '9. provider is listed before delist'
);

select public.admin_delist_provider(
  '19100000-0000-4191-8000-000000000001'::uuid,
  'test delist',
  'tester@pappal.io'
);

select ok(
  (select delisted_at is not null
   from public.profiles
   where id = '19100000-0000-4191-8000-000000000001'),
  '10. delist sets delisted_at'
);

select ok(
  not public.provider_is_listed('19100000-0000-4191-8000-000000000001'::uuid),
  '11. provider is not listed after delist'
);

select ok(
  (select exists (
     select 1 from admin.audit_log
     where action      = 'delist'
       and target_id   = '19100000-0000-4191-8000-000000000001'
       and actor       = 'tester@pappal.io'
   )),
  '12. admin_delist_provider writes an audit_log row'
);

-- ── 13. approve_provider_application is callable by no product role ────────
select ok(
  not has_function_privilege('service_role', 'public.approve_provider_application(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.approve_provider_application(uuid, text)', 'EXECUTE'),
  '13. the old admit path is callable by no product role'
);



reset role;

select * from finish();
rollback;
