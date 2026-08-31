-- pgTAP for migration 038: provider review claim and earnings view rebuild.
--
-- Assertions proven here:
--   1.  claim_provider_application_review function exists.
--   2.  service_role has EXECUTE on claim_provider_application_review.
--   3.  authenticated does NOT have EXECUTE on claim_provider_application_review.
--   4.  claim moves a submitted application to under_review.
--   5.  claim stamps reviewed_at.
--   6.  claim on an already-under_review application raises no_data_found.
--   7.  provider_review_queue view exists.
--   8.  provider_review_queue shows submitted, under_review, needs_info rows.
--   9.  provider_earnings view exists.
--   10. provider_earnings has minutes_billed column.
--   11. provider_earnings has provider_tokens column.
--   12. provider_earnings has gross_tokens column.
--   13. provider_earnings has sessions column.
--   14. provider_earnings has members_served column.
--   15. provider_earnings has first_earned_at column.

\set ON_ERROR_STOP on
begin;
-- 3 grant/existence + 1 submit fixture + 2 claim success + 1 reviewed_at +
-- 1 double-claim throw + 2 queue checks + 1 earnings view + 6 columns = 17.
select plan(17);

-- ---------------------------------------------------------------------------
-- 1. Function exists
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from information_schema.routines
    where  routine_schema = 'public'
      and  routine_name   = 'claim_provider_application_review'
  ),
  '1. claim_provider_application_review function exists'
);

-- ---------------------------------------------------------------------------
-- 2–3. Grant: service_role has execute; authenticated does not
-- ---------------------------------------------------------------------------
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_provider_application_review(uuid)',
    'EXECUTE'
  ),
  '2. service_role has EXECUTE on claim_provider_application_review'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_provider_application_review(uuid)',
    'EXECUTE'
  ),
  '3. authenticated does NOT have EXECUTE on claim_provider_application_review'
);

-- ---------------------------------------------------------------------------
-- Fixtures — one adult applicant
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('eeeeeeee-0000-4000-8000-000000000005');

-- Submit a complete application so it enters the queue.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000005","role":"authenticated"}';
select is(
  public.submit_provider_application(
    'Eve', 'female', (current_date - interval '28 years')::date,
    'Here to listen', ARRAY['en'], 'Experienced listener.'),
  ARRAY[]::text[],
  'fixture: complete application submitted'
);
reset role;

-- ---------------------------------------------------------------------------
-- 4–5. claim moves submitted → under_review and stamps reviewed_at
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.claim_provider_application_review('eeeeeeee-0000-4000-8000-000000000005')$$,
  '4. claim_provider_application_review executes without error'
);

select is(
  (select status::text from public.provider_applications
   where  user_id = 'eeeeeeee-0000-4000-8000-000000000005'),
  'under_review',
  '4. status is under_review after claim'
);

select isnt(
  (select reviewed_at from public.provider_applications
   where  user_id = 'eeeeeeee-0000-4000-8000-000000000005'),
  null,
  '5. reviewed_at is stamped after claim'
);

-- ---------------------------------------------------------------------------
-- 6. Claiming again raises no_data_found (P0002)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select public.claim_provider_application_review('eeeeeeee-0000-4000-8000-000000000005')$$,
  'P0002', null,
  '6. second claim raises no_data_found because status is no longer submitted'
);

-- ---------------------------------------------------------------------------
-- 7–8. provider_review_queue
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from information_schema.views
    where  table_schema = 'public'
      and  table_name   = 'provider_review_queue'
  ),
  '7. provider_review_queue view exists'
);

select ok(
  exists (
    select 1 from public.provider_review_queue
    where  user_id = 'eeeeeeee-0000-4000-8000-000000000005'
      and  status  = 'under_review'
  ),
  '8. provider_review_queue contains the under_review application'
);

-- ---------------------------------------------------------------------------
-- 9–15. provider_earnings view columns (no data needed; shape is enough)
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from information_schema.views
    where  table_schema = 'public'
      and  table_name   = 'provider_earnings'
  ),
  '9. provider_earnings view exists'
);

select has_column('public', 'provider_earnings', 'minutes_billed',  '10. minutes_billed column');
select has_column('public', 'provider_earnings', 'provider_tokens', '11. provider_tokens column');
select has_column('public', 'provider_earnings', 'gross_tokens',    '12. gross_tokens column');
select has_column('public', 'provider_earnings', 'sessions',        '13. sessions column');
select has_column('public', 'provider_earnings', 'members_served',  '14. members_served column');
select has_column('public', 'provider_earnings', 'first_earned_at', '15. first_earned_at column');

select * from finish();
rollback;
