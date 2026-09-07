-- ===========================================================================
-- 072  A member says which languages they want to be talked to in
-- ===========================================================================
-- Amit, 2026-09-07: "we have to ask language preferences (multi select) in
-- onboarding step separately and then sort the profiles with language on user's
-- home screen according to his selections", and when asked to choose between a
-- device-local setting, a filter and a column: "yes new onboarding step,
-- server-side column, and sort not filter for language".
--
-- Server-side, so the preference follows the member across devices and survives
-- a reinstall. `storage` (MMKV) would have been one line and would have lost the
-- answer the first time someone changed phone, which is the whole reason the
-- onboarding question is worth asking at all.
--
-- ---------------------------------------------------------------------------
-- Why a column on profiles and not a table
-- ---------------------------------------------------------------------------
-- This is the opposite case to 070, which argued a provider's photo gallery out
-- of `profiles` and into its own table. That argument turned on READERS: a
-- gallery is read by OTHER members, and `profiles` RLS is owner-only, so it
-- could not live there. A member's own language preference has exactly one
-- reader — the member — and must never be published to anyone else. Owner-only
-- RLS is not an obstacle here, it is the requirement, so the column belongs on
-- the row that already has it.
--
-- The provider SIDE of the same fact is `profiles.languages` (006:34), which is
-- published through `provider_directory` (004:83 established that the view's
-- explicit column list IS the privacy boundary). `preferred_languages` is
-- deliberately NOT added to that view, and there is nothing to do to keep it
-- out: the view names its columns, so a new column on `profiles` cannot leak
-- into the directory by default. That was 003's stated reason for the explicit
-- list and this is the first migration to rely on it for a MEMBER column.
--
-- ---------------------------------------------------------------------------
-- The 063 guard, and why this column is the one kind it must NOT catch
-- ---------------------------------------------------------------------------
-- 063 exists because a signed-in user could mint their own tokens (2821d94):
-- the owner RLS policy plus the table-level UPDATE grant meant `authenticated`
-- could write ANY column of its own row, and `guard_privileged_profile_columns()`
-- is the allowlist-by-omission that takes the server-owned ones back.
--
-- `preferred_languages` is the member's own preference about their own feed. It
-- is client-writable BY DESIGN, exactly like `presence`, `presence_visible`,
-- `is_available` and the profile text columns, and so it is deliberately absent
-- from that trigger. Absent is the whole mechanism: the guard raises 42501 only
-- for the columns it names, so adding nothing to it is what permits this write
-- and nothing more. The guard body is not touched by this migration at all —
-- reproducing it here to "add a comment" is how 054 silently dropped four
-- guards, and that is the mistake 063's header is written to prevent.
--
-- Its comment IS refreshed below, because that comment enumerates the
-- client-writable set and a member preference that is not in the list reads as
-- an oversight to the next person who audits it. `comment on function` does not
-- redefine the function, so the guard body cannot drift out from under it here.
--
-- What the guard's silence still cannot let through is bounded by the CHECK
-- constraint below rather than by trust: RLS says WHOSE row, the guard says
-- WHICH columns, and neither says anything about what may go in one.
-- pgTAP 330 pins all three.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- `text[] not null default '{}'` mirrors `profiles.languages` (006:34) rather
-- than inventing a second shape for the same kind of fact. NOT NULL with an
-- empty default means "asked and answered nothing" and "never asked" are the
-- same value, which is correct here and is the reason the step is skippable:
-- the downstream comparator treats an empty selection as "no opinion" and
-- returns the directory in the order it arrived. A nullable column would offer
-- a third state that no reader would ever distinguish.
alter table public.profiles
  add column if not exists preferred_languages text[] not null default '{}'::text[];

comment on column public.profiles.preferred_languages is
  'The member''s own answer to the onboarding language step: which languages '
  'they would rather be talked to in. Client-writable by its owner and '
  'deliberately absent from guard_privileged_profile_columns(). Read ONLY by '
  'its owner — never added to provider_directory, whose explicit column list '
  'is the privacy boundary. Empty means no preference, which sorts the '
  'directory in the order it already had. A SORT key, never a filter: on a '
  'small roster a language filter can empty the screen.';

-- ---------------------------------------------------------------------------
-- 2. The floor
-- ---------------------------------------------------------------------------
-- Not a value allowlist. `profiles.languages` — the provider side, the thing
-- this is matched AGAINST — has never constrained its values, and a CHECK that
-- named the six offered languages would mean a seventh language needs a
-- migration on the day the product decides to offer it. The set the UI offers
-- lives in `src/lib/languagePrefs.ts` and is derived from what a provider can
-- actually claim.
--
-- What is worth a floor is shape, because the client is not the only writer of
-- HTTP requests to this table: a hand-rolled PATCH could put ten thousand
-- entries, a NULL element or an empty string in here, and every reader would
-- then have to defend itself. Bounded once, in the one place that cannot be
-- bypassed.
--
--   cardinality  <= 12   twice the offered set, so growth does not need a
--                        migration, and a paste bomb still cannot land
--   no NULL elements     a NULL inside the array is not caught by NOT NULL on
--                        the column, which only forbids a NULL array
--   each 1..40 chars     'Hindi' is 5; 40 leaves room for a script name
--
-- Expressed through an IMMUTABLE helper rather than inline, and not by choice:
-- "CHECK constraints cannot contain subqueries", and per-element predicates
-- need `unnest`, which is one. Postgres explicitly allows a function call in a
-- CHECK, and the function may contain the query the constraint may not.
-- https://www.postgresql.org/docs/current/ddl-constraints.html
create or replace function public.language_list_is_sane(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is null
     or (coalesce(cardinality(p), 0) <= 12
         and not exists (
           select 1 from unnest(p) as l
           where l is null or btrim(l) = '' or length(l) > 40
         ));
$$;

comment on function public.language_list_is_sane(text[]) is
  'Shape floor for a language array: at most 12 entries, no NULL element, each '
  '1..40 characters after trimming. Deliberately NOT a value allowlist — the '
  'offered set is a product decision and lives in src/lib/languagePrefs.ts, so '
  'offering a seventh language must not require a migration.';

alter table public.profiles
  drop constraint if exists profiles_preferred_languages_sane;

alter table public.profiles
  add constraint profiles_preferred_languages_sane
  check (public.language_list_is_sane(preferred_languages));

-- ---------------------------------------------------------------------------
-- 3. RLS: nothing to add, and that is the point
-- ---------------------------------------------------------------------------
-- 003:44-53 already gives `profiles` owner-only SELECT and owner-only UPDATE
-- ("Profile readable by owner" / "Profile updatable by owner", both
-- `auth.uid() = id`), and 004:78 removed the one permissive SELECT policy that
-- had widened the table. A column added to this table therefore inherits
-- exactly the reach this preference needs — the member reads and writes their
-- own and no one else's — and a NEW policy would only be a second statement of
-- the same predicate. Restating a predicate is what 054 did, and 063 and 070
-- both name it as the failure mode. So this section is a citation, not a DDL
-- statement, and pgTAP 330 asserts the inherited behaviour rather than assuming
-- it.
