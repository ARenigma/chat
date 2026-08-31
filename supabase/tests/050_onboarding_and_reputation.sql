-- pgTAP for migration 006: the age gate, provider onboarding transitions,
-- reputation, and the no-pay-for-silence refund.
--
-- The assertions that matter are the ones protecting an invariant a form cannot:
--   - there is no route to an underage provider, including for an operator
--   - an applicant cannot approve themselves, nor edit the reviewer's fields
--   - "what is missing" is computed server-side, so nobody is told "Something
--     Missing" and left to guess
--   - reputation is derived, never asserted by its subject
--   - an unanswered message is refunded, and refunded exactly once

\set ON_ERROR_STOP on
begin;
select plan(40);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'profiles', 'date_of_birth', 'profiles carry a birth date');
select has_column('public', 'profiles', 'rating_avg', 'and a derived rating');
select has_column('public', 'messages', 'refunded_at', 'messages can be refunded');
select has_table('public', 'reviews', 'reviews exists');
select hasnt_column(
  'public', 'provider_directory', 'date_of_birth',
  'the directory publishes an age, never a birth date'
);
select has_column('public', 'provider_directory', 'age', 'as a computed integer');
select has_column('public', 'provider_directory', 'rating_avg', 'with reputation attached');

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- applicant, adult
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member
  ('dddddddd-0000-4000-8000-000000000004');  -- applicant, minor

-- ---------------------------------------------------------------------------
-- The age gate is a constraint, not a form field
-- ---------------------------------------------------------------------------
-- Stated plainly at submit time rather than as a silent rejection weeks later.
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.submit_provider_application(
      'Kid', 'other', (current_date - interval '15 years')::date,
      'hello', ARRAY['en'], 'about me')$$,
  '22023', null,
  'an under-18 applicant is refused at submission, with a reason'
);
reset role;

-- And the constraint holds even against an operator doing it by hand, which is
-- the whole reason it is a constraint.
--
-- The birth date is set in the same statement as the role, not before it. 011
-- added `member_is_pseudonymous`, so a member row carrying a birth date is no
-- longer representable at all and the old two-step setup aborted the file under
-- ON_ERROR_STOP. A CHECK is evaluated once per row after the whole UPDATE, so
-- `provider_is_adult` is still what fires here, and the assertion is now the
-- stronger one: it proves the constraint rather than proving the setup.
select throws_ok(
  $$update public.profiles
    set role = 'provider',
        date_of_birth = (current_date - interval '15 years')::date
    where id = 'dddddddd-0000-4000-8000-000000000004'$$,
  '23514', null,
  'and cannot be promoted to provider even by service_role'
);
select throws_ok(
  $$update public.profiles set role = 'provider'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '23514', null,
  'nor can anyone with no birth date at all'
);

-- ---------------------------------------------------------------------------
-- Onboarding: incompleteness is computed and named
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.submit_provider_application(
    'Ada', 'female', (current_date - interval '26 years')::date,
    '', ARRAY[]::text[], null),
  ARRAY['headline', 'languages', 'about'],
  'a partial application names exactly what is missing'
);
select is(
  (select status::text from public.my_application), 'draft',
  'and stays a draft rather than entering the queue'
);
select is(
  public.submit_provider_application(
    'Ada', 'female', (current_date - interval '26 years')::date,
    'I listen more than I talk', ARRAY['en', 'hi'], 'Years of listening to friends.'),
  ARRAY[]::text[],
  'a complete application reports nothing missing'
);
select is(
  (select status::text from public.my_application), 'submitted',
  'and is submitted'
);
select isnt(
  (select submitted_at from public.my_application), null,
  'with a submission timestamp the applicant can see'
);

-- The transitions an applicant may not make.
select throws_ok(
  $$update public.provider_applications set status = 'approved'
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'an applicant cannot approve their own application'
);
-- A *different* value on purpose. The application is complete at this point, so
-- assigning '{}' would not be distinct from the current value, the guard's
-- `is distinct from` test would never fire, and the assertion would prove
-- nothing. Same trap as assigning null to an already-null column.
select throws_ok(
  $$update public.provider_applications set missing_fields = ARRAY['invented']
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor rewrite the reviewer''s findings'
);
select is(
  (select count(*)::int from public.provider_applications), 1,
  'and sees only their own application'
);
reset role;

-- needs_info round trip: the state Clarity left a listener stuck in for weeks,
-- except here it names the fields and the applicant can act without support.
select lives_ok(
  $$select public.request_application_info(
      'aaaaaaaa-0000-4000-8000-000000000001', ARRAY['about'], 'Tell us a bit more.')$$,
  'a reviewer can ask for more information'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select status::text from public.my_application), 'needs_info',
  'the applicant sees the status'
);
select is(
  (select missing_fields from public.my_application), ARRAY['about'],
  'and exactly which field to fix, never "Something Missing"'
);
select is(
  (select reviewer_note from public.my_application), 'Tell us a bit more.',
  'along with what the reviewer said'
);
select is(
  public.submit_provider_application(
    'Ada', 'female', (current_date - interval '26 years')::date,
    'I listen more than I talk', ARRAY['en', 'hi'], 'A much longer answer.'),
  ARRAY[]::text[],
  'and can resubmit without contacting anyone'
);
select is(
  (select status::text from public.my_application), 'submitted',
  'which returns it to the queue'
);
reset role;

-- ---------------------------------------------------------------------------
-- Approval carries the application onto the profile
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a complete adult application is approved'
);
select is(
  (select headline from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'I listen more than I talk',
  'and the application details land on the profile'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select age from public.provider_directory), 26,
  'the directory publishes a computed age'
);
select is(
  (select gender from public.provider_directory), 'female',
  'and the details a member needs to choose'
);
reset role;

-- ---------------------------------------------------------------------------
-- Reputation is derived, never asserted
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set rating_avg = 5.00, rating_count = 999
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'a provider cannot write their own rating'
);
select throws_ok(
  $$update public.profiles set date_of_birth = (current_date - interval '30 years')::date
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor edit a birth date once it is set'
);
reset role;

-- Fund member so the session balance gate (ADR-0020) does not fire on first send.
update public.profiles set promo_balance = 500
where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select test.accept_current_policies(id)
from auth.users;

-- A conversation with traffic on both sides, then a review.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'hello')
    ->> 'success')::boolean,
  true, 'the member opens with a message'
);
select throws_ok(
  $$select public.submit_review((select v from test.fixture where k = 'thread'), 5::smallint, null)$$,
  '22023', null,
  'a review needs a conversation behind it, not one message'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'I am here')
    ->> 'success')::boolean,
  true, 'the provider replies'
);
select throws_ok(
  $$select public.submit_review((select v from test.fixture where k = 'thread'), 5::smallint, null)$$,
  '42501', null,
  'and cannot review themselves'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.submit_review((select v from test.fixture where k = 'thread'), 4::smallint, 'kind')$$,
  'the member reviews the conversation'
);
reset role;

select is(
  (select rating_avg from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  4.00, 'and the denormalised rating follows automatically'
);
select is(
  (select rating_count from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'with a review count'
);

-- ---------------------------------------------------------------------------
-- Nobody pays for silence
-- ---------------------------------------------------------------------------
-- Backdate the member's message and remove the reply, so it is unanswered.
delete from public.messages where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.messages set created_at = now() - interval '48 hours'
where sender_id = 'bbbbbbbb-0000-4000-8000-000000000002';

select is(
  public.refund_unanswered_messages(), 1,
  'an unanswered message is refunded after the window'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  -- In the session model messages carry no per-message cost, so the refund
  -- function credits one token onto the pre-send balance (500 + 1 = 501).
  501, 'refund credits one token; balance reflects no prior per-message debit'
);
select is(
  public.refund_unanswered_messages(), 0,
  'refunding is idempotent, the same message is never credited twice'
);

select * from finish();
rollback;
