-- pgTAP for migration 063: every server-owned profiles column is guarded.
--
-- 1.  owner cannot write promo_balance (the wallet exploit)
-- 2.  ...and token_balance is unchanged afterwards
-- 3.  owner cannot write purchased_balance
-- 4.  owner cannot write suspended_until
-- 5.  owner cannot write rating_avg / rating_count
-- 6.  owner cannot write median_reply_seconds
-- 7.  owner cannot write profile_completed_at
-- 8.  owner cannot write last_refill_at
-- 9.  owner cannot write engagement_nudged_at
-- 10. owner CAN still write is_available  (the client's real direct writes)
-- 11. owner CAN still write avatar_url
-- 12. the server path still moves the wallet, and the sync trigger follows

\set ON_ERROR_STOP on
begin;
select plan(12);

insert into auth.users (id) values ('cc063000-0000-4063-8000-000000000001');
update public.profiles
set    promo_balance = 500, purchased_balance = 0
where  id = 'cc063000-0000-4063-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc063000-0000-4063-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set promo_balance = 100000
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '1. owner cannot write promo_balance'
);

select is(
  (select token_balance from public.profiles where id = 'cc063000-0000-4063-8000-000000000001'),
  500,
  '2. token_balance is unchanged after the refused write'
);

select throws_ok(
  $$update public.profiles set purchased_balance = 100000
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '3. owner cannot write purchased_balance'
);

select throws_ok(
  $$update public.profiles set suspended_until = now() + interval '1 day'
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '4. owner cannot write suspended_until'
);

select throws_ok(
  $$update public.profiles set rating_avg = 5.00, rating_count = 999
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '5. owner cannot write rating_avg / rating_count'
);

select throws_ok(
  $$update public.profiles set median_reply_seconds = 1
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '6. owner cannot write median_reply_seconds'
);

select throws_ok(
  $$update public.profiles set profile_completed_at = now()
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '7. owner cannot write profile_completed_at'
);

select throws_ok(
  $$update public.profiles set last_refill_at = now()
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '8. owner cannot write last_refill_at'
);

select throws_ok(
  $$update public.profiles set engagement_nudged_at = now()
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '42501', null,
  '9. owner cannot write engagement_nudged_at'
);

select lives_ok(
  $$update public.profiles set is_available = true
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '10. owner can still write is_available'
);

select lives_ok(
  $$update public.profiles set avatar_url = 'clay:seed-1'
    where id = 'cc063000-0000-4063-8000-000000000001'$$,
  '11. owner can still write avatar_url'
);

reset role;
update public.profiles
set    promo_balance = 600
where  id = 'cc063000-0000-4063-8000-000000000001';

select is(
  (select token_balance from public.profiles where id = 'cc063000-0000-4063-8000-000000000001'),
  600,
  '12. the server path still moves the wallet, and sync_token_balance follows'
);

select * from finish();
rollback;
