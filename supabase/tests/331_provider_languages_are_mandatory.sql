-- pgTAP for migration 075: a provider always has at least one language.
--
-- The suite that matters here is 3 and 4. Everything else could pass against a
-- database where the mandate lives only in the RPC — which is the state this
-- migration was written to end. 3 is the exact request a signed-in provider
-- could make before 075 (a direct PATCH emptying their own languages, no client
-- involved, both existing checks bypassed), and 4 proves the door it walks
-- around is still shut, so 3 is testing the constraint and not the RPC.
--
-- 5 and 6 are the pair that keeps this from being the 063 guard by another
-- name: a provider must still be able to CHANGE their languages freely. If
-- `languages` were added to guard_privileged_profile_columns() to close 3, both
-- would fail — which is the reason 075's header argues for a CHECK instead.
--
--  1. a provider row carries its languages
--  2. the constraint exists, so a reader can find it from the schema
--  3. the owner cannot empty their own languages by direct UPDATE  ← the hole
--  4. ...and the RPC still refuses an empty list too
--  5. the owner CAN change them, which the 063 guard would have forbidden
--  6. ...including down to exactly one
--  7. a MEMBER may have empty languages — the predicate is role-scoped
--  8. a member cannot be promoted to provider with no languages
--  9. the shape floor applies to the provider column too: over-long entry
-- 10. ...and a NULL element, which column NOT NULL does not cover

\set ON_ERROR_STOP on
begin;
select plan(10);

insert into auth.users (id) values
  ('cc075000-0000-4075-8000-000000000001'),  -- provider, live
  ('cc075000-0000-4075-8000-000000000002'); -- member, stays a member

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider075',
       headline             = 'Here to listen',
       about                = 'A provider row for the 075 suite.',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       languages            = array['English', 'Hindi']
where  id = 'cc075000-0000-4075-8000-000000000001';

update public.profiles set display_name = 'Member075'
where  id = 'cc075000-0000-4075-8000-000000000002';

select test.accept_current_policies('cc075000-0000-4075-8000-000000000001');
select test.accept_current_policies('cc075000-0000-4075-8000-000000000002');

-- ---------------------------------------------------------------------------
-- The starting state
-- ---------------------------------------------------------------------------
select is(
  (select languages from public.profiles
   where id = 'cc075000-0000-4075-8000-000000000001'),
  array['English', 'Hindi'],
  '1. the provider row carries its languages'
);

-- Named, so the next person auditing the profiles table finds the rule from the
-- schema rather than from this file.
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname  = 'profiles_provider_has_a_language'
  ),
  '2. the constraint exists under its documented name'
);

-- ---------------------------------------------------------------------------
-- The hole 075 closes
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc075000-0000-4075-8000-000000000001","role":"authenticated"}';

-- Before 075 this succeeded. `profiles.languages` is not in the 063 guard and
-- 003's owner-only UPDATE policy permits the row, so a live provider could
-- empty their own languages with one PATCH and stay in provider_directory —
-- past BOTH the client's profileReady check and the RPC's 22023.
--
-- 23514 and not 42501: this is a check-constraint violation, which is the whole
-- argument of the migration. A 42501 here would mean someone closed it by
-- adding the column to the guard, and 5 and 6 below would then fail.
select throws_ok(
  $$update public.profiles
    set languages = '{}'::text[]
    where id = 'cc075000-0000-4075-8000-000000000001'$$,
  '23514', null,
  '3. a provider cannot empty their own languages by direct UPDATE'
);

-- The door the PATCH above walked around, asserted here so 3 cannot be read as
-- evidence about the RPC. 065:213 raises 22023 for an empty list.
select throws_ok(
  $$select public.complete_provider_onboarding(
      'Provider075', 'Here to listen', '{}'::text[],
      'About text long enough to pass.', 'listener')$$,
  '22023', null,
  '4. ...and complete_provider_onboarding still refuses an empty list'
);

-- ---------------------------------------------------------------------------
-- What a provider must STILL be able to do
-- ---------------------------------------------------------------------------
-- This pair is why 075 is a CHECK and not a guard entry. Offering a new
-- language is ordinary self-service profile editing, in the same set as
-- headline and about. Had `languages` been added to
-- guard_privileged_profile_columns() to close 3, both of these would raise
-- 42501 and providers would need an RPC to add Tamil.
select lives_ok(
  $$update public.profiles
    set languages = array['English', 'Hindi', 'Tamil']
    where id = 'cc075000-0000-4075-8000-000000000001'$$,
  '5. the provider can still change their languages'
);

select lives_ok(
  $$update public.profiles
    set languages = array['Tamil']
    where id = 'cc075000-0000-4075-8000-000000000001'$$,
  '6. ...including down to exactly one'
);

-- ---------------------------------------------------------------------------
-- The predicate is role-scoped, and has to be
-- ---------------------------------------------------------------------------
-- 16 of production's 17 member rows have an empty `languages` and are meant to:
-- a member's languages column is not their preference — that is
-- `preferred_languages`, migration 072. A blanket NOT-empty would have failed
-- almost every member row in the database.
set local request.jwt.claims =
  '{"sub":"cc075000-0000-4075-8000-000000000002","role":"authenticated"}';

select is(
  (select coalesce(cardinality(languages), 0) from public.profiles
   where id = 'cc075000-0000-4075-8000-000000000002'),
  0,
  '7. a member may have no languages: the predicate is role-scoped'
);

-- The implication runs provider ⇒ has a language, so the promotion is what the
-- constraint catches, from either direction. Done as the table owner because a
-- client cannot write `role` at all (the 063 guard raises 42501 first, which
-- would prove the wrong thing).
reset role;
select throws_ok(
  $$update public.profiles
    set role = 'provider', languages = '{}'::text[]
    where id = 'cc075000-0000-4075-8000-000000000002'$$,
  '23514', null,
  '8. a member cannot be promoted to provider with no languages'
);

-- ---------------------------------------------------------------------------
-- The shape floor, now on the published column
-- ---------------------------------------------------------------------------
-- 072 bounded `preferred_languages` with `language_list_is_sane()` and left
-- `languages` unbounded. This column is read by OTHER members through
-- provider_directory, so the floor matters more here than where it was written.
-- Values are still deliberately unconstrained — offering a seventh language
-- must not need a migration — only shape.
select throws_ok(
  $$update public.profiles
    set languages = array[repeat('x', 41)]
    where id = 'cc075000-0000-4075-8000-000000000001'$$,
  '23514', null,
  '9. an over-long entry is refused on the provider column too'
);

select throws_ok(
  $$update public.profiles
    set languages = array['English', null]::text[]
    where id = 'cc075000-0000-4075-8000-000000000001'$$,
  '23514', null,
  '10. a NULL element is refused, which column NOT NULL does not cover'
);

select * from finish();
rollback;
