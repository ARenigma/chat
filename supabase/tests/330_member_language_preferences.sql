-- pgTAP for migration 072: the member's language preference, and the three
-- separate things that keep it theirs.
--
-- The point of the suite is that RLS, the 063 guard and the CHECK constraint
-- answer three different questions — WHOSE row, WHICH columns, and WHAT may go
-- in one — and the column needs all three to be right in a DIFFERENT direction
-- from every other column 063 touches. This is the first column since that
-- migration that a client is SUPPOSED to be able to write, so "the guard does
-- not raise" is the assertion, and it is worthless without 5, which proves the
-- guard is still armed on the neighbouring column in the same UPDATE.
--
--  1. the column exists, and defaults to empty rather than null
--  2. the owner can write their own preference — the 063 guard permits it
--  3. ...and read it back
--  4. the owner can clear it back to empty, which is a real answer
--  5. the guard is still armed: age_bracket in the SAME kind of update fails
--  6. one UPDATE touching both is refused ENTIRELY, so the write is atomic
--  7. a member cannot write somebody else's preference
--  8. ...nor read it
--  9. the array is capped, by the database and not by the client
-- 10. a blank entry is refused
-- 11. ...and an over-long one
-- 12. a NULL element is refused, which column NOT NULL does not cover
-- 13. the preference is NOT in provider_directory, which is the privacy boundary

\set ON_ERROR_STOP on
begin;
select plan(14);

insert into auth.users (id) values
  ('cc072000-0000-4072-8000-000000000001'),  -- member A
  ('cc072000-0000-4072-8000-000000000002'),  -- member B
  ('cc072000-0000-4072-8000-000000000003'); -- provider, listed

update public.profiles set display_name = 'Member072a'
where  id = 'cc072000-0000-4072-8000-000000000001';

update public.profiles set display_name = 'Member072b'
where  id = 'cc072000-0000-4072-8000-000000000002';

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider072',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       languages            = array['English', 'Tamil']
where  id = 'cc072000-0000-4072-8000-000000000003';

select test.accept_current_policies('cc072000-0000-4072-8000-000000000001');
select test.accept_current_policies('cc072000-0000-4072-8000-000000000002');
select test.accept_current_policies('cc072000-0000-4072-8000-000000000003');

-- ---------------------------------------------------------------------------
-- 1. The shape
-- ---------------------------------------------------------------------------
-- Empty and not null, because "asked and skipped" and "never asked" are the
-- same answer downstream: sortByLanguageMatch returns the directory in the
-- order it already had for both.
select is(
  (select preferred_languages from public.profiles
   where id = 'cc072000-0000-4072-8000-000000000001'),
  '{}'::text[],
  '1. the column defaults to empty rather than null'
);

-- ---------------------------------------------------------------------------
-- What the owner may do — the whole reason this column exists
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc072000-0000-4072-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$update public.profiles
    set preferred_languages = array['Hindi', 'Tamil']
    where id = 'cc072000-0000-4072-8000-000000000001'$$,
  '2. the owner can write their own preference: the 063 guard permits it'
);

select is(
  (select preferred_languages from public.profiles
   where id = 'cc072000-0000-4072-8000-000000000001'),
  array['Hindi', 'Tamil'],
  '3. ...and reads it back'
);

-- Clearing is not "resetting to undeclared", it is the member saying they have
-- no preference, and it must be as writable as setting one.
select lives_ok(
  $$update public.profiles
    set preferred_languages = '{}'::text[]
    where id = 'cc072000-0000-4072-8000-000000000001'$$,
  '4. the owner can clear it back to empty, which is a real answer'
);

-- ---------------------------------------------------------------------------
-- The guard is still armed, which is what makes assertion 2 mean anything
-- ---------------------------------------------------------------------------
-- Without this pair, 2 would pass just as happily against a
-- guard_privileged_profile_columns() that had been emptied out — which is
-- exactly what migration 054 did to four guards, and why 063 exists.
select throws_ok(
  $$update public.profiles
    set age_bracket = '45+'
    where id = 'cc072000-0000-4072-8000-000000000001'$$,
  '42501', null,
  '5. the guard is still armed on age_bracket beside the new column'
);

-- One statement setting both. The guard raises, so NEITHER lands: the
-- permitted column cannot be used as a carrier for a forbidden one.
select throws_ok(
  $$update public.profiles
    set preferred_languages = array['English'],
        age_bracket = '45+'
    where id = 'cc072000-0000-4072-8000-000000000001'$$,
  '42501', null,
  '6. one update touching both is refused entirely'
);

select is(
  (select preferred_languages from public.profiles
   where id = 'cc072000-0000-4072-8000-000000000001'),
  '{}'::text[],
  '6b. ...and the permitted half of that update did not land either'
);

-- ---------------------------------------------------------------------------
-- Somebody else's row
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc072000-0000-4072-8000-000000000002","role":"authenticated"}';

-- RLS FILTERS an update rather than raising, so the assertion is that the other
-- row is unchanged: a policy that updated nothing and a policy that updated the
-- row look identical from the client's error handling. (Same argument as 320's
-- assertion 8.)
update public.profiles
set    preferred_languages = array['Bengali']
where  id = 'cc072000-0000-4072-8000-000000000001';

-- Asserted from the OWNER's session, not B's, and that ordering is load-bearing:
-- as B this select returns no rows at all (assertion 8), so reading it here
-- would compare NULL against '{}' and fail for the wrong reason — it would look
-- like the write had landed.
select ok(
  (select count(*) = 0 from public.profiles
   where id = 'cc072000-0000-4072-8000-000000000001'),
  '8. a member cannot even READ somebody else''s row: owner-only SELECT, '
  'inherited from 003 and unchanged by 072'
);

set local request.jwt.claims =
  '{"sub":"cc072000-0000-4072-8000-000000000001","role":"authenticated"}';

select is(
  (select preferred_languages from public.profiles
   where id = 'cc072000-0000-4072-8000-000000000001'),
  '{}'::text[],
  '7. ...nor write it: B''s update above was filtered out, not applied'
);

set local request.jwt.claims =
  '{"sub":"cc072000-0000-4072-8000-000000000002","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- The shape floor, which neither RLS nor the guard says anything about
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.profiles
    set preferred_languages = array[
      'a','b','c','d','e','f','g','h','i','j','k','l','m'
    ]
    where id = 'cc072000-0000-4072-8000-000000000002'$$,
  '23514', null,
  '9. thirteen entries is refused by the database, not by the client'
);

select throws_ok(
  $$update public.profiles
    set preferred_languages = array['Hindi', '   ']
    where id = 'cc072000-0000-4072-8000-000000000002'$$,
  '23514', null,
  '10. a whitespace-only entry is refused'
);

select throws_ok(
  $$update public.profiles
    set preferred_languages = array[repeat('x', 41)]
    where id = 'cc072000-0000-4072-8000-000000000002'$$,
  '23514', null,
  '11. ...and an entry longer than 40 characters'
);

-- The column's own NOT NULL forbids a null ARRAY and says nothing about a null
-- ELEMENT, which every reader would then have to defend itself against.
select throws_ok(
  $$update public.profiles
    set preferred_languages = array['Hindi', null]::text[]
    where id = 'cc072000-0000-4072-8000-000000000002'$$,
  '23514', null,
  '12. a NULL element is refused, which column NOT NULL does not cover'
);

-- ---------------------------------------------------------------------------
-- It never reaches another member
-- ---------------------------------------------------------------------------
-- 004 made the view's explicit column list the privacy boundary rather than a
-- base-table policy. This asserts the boundary held for the first MEMBER column
-- added since — a preference published to the people it is a preference about
-- would be the whole point of the column inverted.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_directory'
      and column_name = 'preferred_languages'
  ),
  '13. the preference is not in provider_directory'
);

select * from finish();
rollback;
