-- pgTAP for 154: provider_busy_waits, the "Busy, wait ~N m" on the provider card.
--
-- WHAT THIS IS GUARDING:
--
--   * Only a provider in a live paid session gets a row. A free provider gets
--     none (1).
--   * The minutes are the balance-limited remaining time, the 062 bound
--     rounded up: ceil(((next_bill_at - now) + floor(balance / rate) * 60) / 60),
--     which is ceil(balance / rate) whenever the balance is not a multiple of
--     the rate (2), and drops when the balance does (3). When it IS a multiple,
--     right after the cron debited a minute, the naive ceil(balance / rate) is
--     a minute short; the bound counts the paid minute still running (4).
--   * Before billing starts, every minute is still to be debited, so the bound
--     is floor(balance / rate) (5). A row with no rate is "Busy" with null
--     minutes, not a division by zero (6). The display cap is 99 (7).
--   * The directory's boundaries: no row across a block (8), none for an
--     unlisted provider (9).
--   * Input: more than 100 ids is refused (10), a non-uuid is refused (11).
--   * Who can call: not anon (12, 13), and a provider, including the one in
--     the session, reads nothing, so they cannot turn the minutes into their
--     member's balance (14).
--   * Nothing about the member leaves: the result is (provider_id,
--     wait_minutes) and no member id appears in it (15, 16).
--
-- now() is the transaction start throughout, so every expectation is exact.

\set ON_ERROR_STOP on
begin;
select plan(16);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- 001 is the caller, a member browsing the directory. 002-007 are the members
-- in the sessions. 010-017 are providers.
insert into auth.users (id)
select ('d5690000-0000-4569-8000-0000000000' || n)::uuid
from unnest(array['01', '02', '03', '04', '05', '06', '07', '10', '11', '12',
                  '13', '14', '15', '16', '17']) n;

update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider569-' || right(id::text, 2),
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now(),
       is_available         = true
where  id::text like 'd5690000-0000-4569-8000-0000000000_%'
  and  right(id::text, 2)::int >= 10;

-- 013 is suspended, so provider_directory (and provider_is_listed) drop it.
update public.profiles
set    suspended_until = now() + interval '1 day'
where  id = 'd5690000-0000-4569-8000-000000000013';

-- The session members' wallets. Promo and purchased both count: deduct_tokens
-- (028) spends from their sum.
update public.profiles set promo_balance = 60, purchased_balance = 40
where id = 'd5690000-0000-4569-8000-000000000002';            -- 100 tokens, with 010
update public.profiles set promo_balance = 100, purchased_balance = 0
where id = 'd5690000-0000-4569-8000-000000000003';            -- with 012 (blocked) and 013 (unlisted)
update public.profiles set promo_balance = 0, purchased_balance = 44
where id = 'd5690000-0000-4569-8000-000000000004';            -- 44 = 2 x 22, with 014
update public.profiles set promo_balance = 100, purchased_balance = 0
where id = 'd5690000-0000-4569-8000-000000000005';            -- pending leases, with 015; and 016 (no rate)
update public.profiles set promo_balance = 0, purchased_balance = 99999
where id = 'd5690000-0000-4569-8000-000000000006';            -- beyond the cap, with 017

insert into public.conversations (id, member_id, provider_id) values
  ('d5690000-0000-4569-8000-0000000000c0', 'd5690000-0000-4569-8000-000000000002', 'd5690000-0000-4569-8000-000000000010'),
  ('d5690000-0000-4569-8000-0000000000c2', 'd5690000-0000-4569-8000-000000000003', 'd5690000-0000-4569-8000-000000000012'),
  ('d5690000-0000-4569-8000-0000000000c3', 'd5690000-0000-4569-8000-000000000003', 'd5690000-0000-4569-8000-000000000013'),
  ('d5690000-0000-4569-8000-0000000000c4', 'd5690000-0000-4569-8000-000000000004', 'd5690000-0000-4569-8000-000000000014'),
  ('d5690000-0000-4569-8000-0000000000c5', 'd5690000-0000-4569-8000-000000000005', 'd5690000-0000-4569-8000-000000000015'),
  ('d5690000-0000-4569-8000-0000000000c6', 'd5690000-0000-4569-8000-000000000005', 'd5690000-0000-4569-8000-000000000016'),
  ('d5690000-0000-4569-8000-0000000000c7', 'd5690000-0000-4569-8000-000000000006', 'd5690000-0000-4569-8000-000000000017'),
  -- The caller's own thread with 012, which is what lets them block it (096).
  ('d5690000-0000-4569-8000-0000000000c8', 'd5690000-0000-4569-8000-000000000001', 'd5690000-0000-4569-8000-000000000012');

-- Billing started: claim_session_lease (037) debits minute 1 and sets
-- next_bill_at = started_at + 1 minute; here the paid minute has 30 s (and for
-- 014, 45 s) still to run.
insert into public.paid_sessions (
  conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, accepted_at, started_at, next_bill_at, last_activity_at,
  minutes_billed, tokens_debited
) values
  ('d5690000-0000-4569-8000-0000000000c0', 'chat', 'active',
   'd5690000-0000-4569-8000-000000000002', 'd5690000-0000-4569-8000-000000000010',
   22, now() - interval '31 seconds', now() - interval '30 seconds',
   now() + interval '30 seconds', now(), 1, 22),
  ('d5690000-0000-4569-8000-0000000000c2', 'chat', 'active',
   'd5690000-0000-4569-8000-000000000003', 'd5690000-0000-4569-8000-000000000012',
   22, now() - interval '31 seconds', now() - interval '30 seconds',
   now() + interval '30 seconds', now(), 1, 22),
  ('d5690000-0000-4569-8000-0000000000c3', 'audio', 'warning',
   'd5690000-0000-4569-8000-000000000003', 'd5690000-0000-4569-8000-000000000013',
   22, now() - interval '31 seconds', now() - interval '30 seconds',
   now() + interval '30 seconds', now(), 1, 22),
  ('d5690000-0000-4569-8000-0000000000c4', 'chat', 'active',
   'd5690000-0000-4569-8000-000000000004', 'd5690000-0000-4569-8000-000000000014',
   22, now() - interval '16 seconds', now() - interval '15 seconds',
   now() + interval '45 seconds', now(), 1, 22),
  ('d5690000-0000-4569-8000-0000000000c7', 'chat', 'grace',
   'd5690000-0000-4569-8000-000000000006', 'd5690000-0000-4569-8000-000000000017',
   1, now() - interval '31 seconds', now() - interval '30 seconds',
   now() + interval '30 seconds', now(), 1, 1);

-- Accepted, leases not yet claimed: nothing debited, no next_bill_at.
insert into public.paid_sessions (
  conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, accepted_at
) values
  ('d5690000-0000-4569-8000-0000000000c5', 'chat', 'pending_leases',
   'd5690000-0000-4569-8000-000000000005', 'd5690000-0000-4569-8000-000000000015',
   22, now()),
  ('d5690000-0000-4569-8000-0000000000c6', 'chat', 'pending_leases',
   'd5690000-0000-4569-8000-000000000005', 'd5690000-0000-4569-8000-000000000016',
   null, now());

-- The caller blocks 012 from their own chat with it.
insert into public.blocks (blocker_id, blocked_id) values
  ('d5690000-0000-4569-8000-000000000001', 'd5690000-0000-4569-8000-000000000012');

create temporary table every_provider (ids uuid[]) on commit drop;
insert into every_provider
select array_agg(id order by id) from public.profiles
where id::text like 'd5690000-0000-4569-8000-0000000000_%'
  and right(id::text, 2)::int >= 10;
grant select on every_provider to authenticated, anon;

-- ── As the browsing member ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5690000-0000-4569-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int
   from public.provider_busy_waits((select ids from every_provider))
   where provider_id = 'd5690000-0000-4569-8000-000000000011'),
  0,
  '1. a provider in no session returns no row'
);

select is(
  (select wait_minutes
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000010']::uuid[])),
  ceil(100 / 22.0)::int,
  '2. a busy provider returns ceil(balance / rate): 100 tokens at 22 a minute is 5'
);

reset role;
update public.profiles set promo_balance = 10, purchased_balance = 40
where id = 'd5690000-0000-4569-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5690000-0000-4569-8000-000000000001","role":"authenticated"}';

select is(
  (select wait_minutes
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000010']::uuid[])),
  ceil(50 / 22.0)::int,
  '3. when the member''s balance drops the wait drops with it: 50 tokens is 3'
);

select is(
  (select wait_minutes
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000014']::uuid[])),
  3,
  '4. 44 tokens at 22 with 45 s of a paid minute left is 3, not ceil(44 / 22) = 2'
);

select is(
  (select wait_minutes
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000015']::uuid[])),
  100 / 22,
  '5. before billing starts, every minute is still to be debited: floor(100 / 22) = 4'
);

select ok(
  (select count(*) = 1 and bool_and(wait_minutes is null)
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000016']::uuid[])),
  '6. a session with no rate is busy with null minutes, so the card says just Busy'
);

select is(
  (select wait_minutes
   from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000017']::uuid[])),
  99,
  '7. the displayed wait is capped at 99'
);

select is(
  (select count(*)::int
   from public.provider_busy_waits((select ids from every_provider))
   where provider_id = 'd5690000-0000-4569-8000-000000000012'),
  0,
  '8. a provider the caller has blocked returns no row though it is busy'
);

select is(
  (select count(*)::int
   from public.provider_busy_waits((select ids from every_provider))
   where provider_id = 'd5690000-0000-4569-8000-000000000013'),
  0,
  '9. an unlisted (suspended) provider returns no row though it is busy'
);

select throws_ok(
  $$ select * from public.provider_busy_waits(
       array(select gen_random_uuid() from generate_series(1, 101))) $$,
  '22023',
  'at most 100 provider ids per call',
  '10. more than 100 ids is refused'
);

select throws_ok(
  $$ select * from public.provider_busy_waits(array['not-a-uuid']::uuid[]) $$,
  '22P02',
  null,
  '11. a non-uuid id is refused'
);

-- ── Nobody else ────────────────────────────────────────────────────────────
reset role;
select ok(
  not has_function_privilege('anon', 'public.provider_busy_waits(uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.provider_busy_waits(uuid[])', 'EXECUTE'),
  '12. signed in may execute it, signed out may not'
);

set local role anon;
select throws_ok(
  $$ select * from public.provider_busy_waits(array['d5690000-0000-4569-8000-000000000010']::uuid[]) $$,
  '42501',
  null,
  '13. and anon calling it is refused'
);

-- The provider in the session is the one caller who knows who the member is.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5690000-0000-4569-8000-000000000010","role":"authenticated"}';
select is(
  (select count(*)::int from public.provider_busy_waits((select ids from every_provider))),
  0,
  '14. a provider, including the busy one, reads nothing'
);

-- ── Nothing about the member leaves ────────────────────────────────────────
reset role;
select is(
  (select array_agg(n order by n)
   from pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) as a(n, m)
   where p.oid = 'public.provider_busy_waits(uuid[])'::regprocedure
     and m = 't'),
  array['provider_id', 'wait_minutes']::text[],
  '15. the result is exactly (provider_id, wait_minutes)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5690000-0000-4569-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int
   from public.provider_busy_waits((select ids from every_provider)) r
   where row_to_json(r)::text ~ 'd5690000-0000-4569-8000-00000000000[2-6]'),
  0,
  '16. no member id appears anywhere in the result'
);

select * from finish();
rollback;
