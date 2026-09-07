-- ===========================================================================
-- 075  A provider always has at least one language
-- ===========================================================================
-- Amit, 2026-09-07: "bring parity between all login options and onboarding flow
-- so that there is no work around" and "language selection should be mandatory
-- for providers".
--
-- The mandate already existed in two places and neither is the one that counts:
--
--   client  `ProviderApplicationScreen`'s `profileReady` includes
--           `languages.length > 0`, so Go live is held.
--   RPC     `complete_provider_onboarding` (065:213) raises
--           'at least one language is required' with 22023.
--
-- Both guard the DOOR. Neither guards the ROOM. `profiles.languages` (006:34)
-- is not named in `guard_privileged_profile_columns()`, and 003's owner-only
-- UPDATE policy plus the table-level grant means a signed-in provider can PATCH
-- their own row directly:
--
--   PATCH /rest/v1/profiles?id=eq.<self>   {"languages": []}
--
-- That is a live provider, in `provider_directory`, bookable, with no language
-- — the exact state both checks above exist to prevent, reachable with one
-- request and no client at all. It is the same class of hole as the one 063 was
-- written for (2821d94, minting your own tokens): a validating RPC beside a
-- writable column is not a constraint, it is a suggestion.
--
-- ---------------------------------------------------------------------------
-- Why a CHECK and NOT the 063 guard
-- ---------------------------------------------------------------------------
-- Adding `languages` to `guard_privileged_profile_columns()` would close the
-- hole and take a feature with it. A provider changing which languages they
-- offer is a legitimate self-service edit — it is their own profile text, in
-- the same set as `headline` and `about` — and the guard is all-or-nothing:
-- named columns raise 42501 on ANY client change. Providers would then need an
-- RPC to add Tamil.
--
-- What must be impossible is not the write, it is the RESULT. A CHECK says
-- exactly that and nothing more: edit freely, never to empty. RLS says whose
-- row, the guard says which columns, a CHECK says what may be in one — 072's
-- header sets out that division and this is the provider-side half of it.
--
-- The guard body is deliberately not touched here. Reproducing it to append a
-- column is how 054 silently dropped four guards, and 063's header exists to
-- stop that being done again.
--
-- ---------------------------------------------------------------------------
-- Why it is safe to add to live data
-- ---------------------------------------------------------------------------
-- Checked against production before writing (2026-09-07): 8 provider rows, 0
-- with an empty `languages`. So the constraint is satisfied by every existing
-- row and needs no backfill or `not valid` staging. The 17 member rows are
-- unaffected because the predicate is role-scoped — 16 of them have an empty
-- `languages` and are meant to: a member's languages column is not their
-- preference (that is `preferred_languages`, migration 072).
--
-- Role-scoped rather than a blanket NOT-empty for that reason, and the
-- implication runs one way only: provider ⇒ has a language. A member with
-- languages set is not wrong, just unusual, and forbidding it would fail rows
-- that predate the provider/member split.
--
-- `complete_provider_onboarding` writes `role` and `languages` in ONE statement
-- (065:245, done that way so `member_is_pseudonymous` is never violated), and a
-- row CHECK is evaluated at statement end, so promotion cannot trip this on the
-- way through. That coupling is why the constraint can be immediate.

alter table public.profiles
  drop constraint if exists profiles_provider_has_a_language;

alter table public.profiles
  add constraint profiles_provider_has_a_language
  check (
    role <> 'provider'
    or coalesce(cardinality(languages), 0) > 0
  );

comment on constraint profiles_provider_has_a_language on public.profiles is
  'A provider row always carries at least one language. The client and '
  'complete_provider_onboarding both already require it; this is the only one '
  'of the three that a direct PATCH to profiles cannot walk around. Scoped to '
  'role = provider: a member''s languages column is not their preference — '
  'that is preferred_languages (072) — and is empty for almost every member.';

-- ---------------------------------------------------------------------------
-- The shape floor, extended to the provider side
-- ---------------------------------------------------------------------------
-- 072 gave `preferred_languages` a shape floor through
-- `language_list_is_sane()` and noted in passing that `profiles.languages` "has
-- never constrained its values". Its values still are not constrained — the
-- offered set is a product decision that must not need a migration — but its
-- SHAPE is now bounded by the same helper, for the same reason and against the
-- same threat: the column is client-writable, so a hand-rolled PATCH is free to
-- put ten thousand entries, a NULL element or an empty string in it, and every
-- reader downstream of `provider_directory` would have to defend itself.
--
-- This column is read by OTHER members, unlike `preferred_languages`, so the
-- floor matters more here than where it was first written.
alter table public.profiles
  drop constraint if exists profiles_languages_sane;

alter table public.profiles
  add constraint profiles_languages_sane
  check (public.language_list_is_sane(languages));

-- ---------------------------------------------------------------------------
-- The third door, which the constraint above found
-- ---------------------------------------------------------------------------
-- Writing this migration turned up a promotion path neither of the two checks
-- in the header covers. `approve_provider_application` (042) is the ADMIN
-- route, and its languages clause is:
--
--   languages = case
--     when array_length(v_app.languages, 1) is null then languages
--     else v_app.languages
--   end
--
-- An application with no languages leaves the profile's own column untouched —
-- which for a member is empty — so the row goes live as a provider, into
-- `provider_directory`, with no language at all. `complete_provider_onboarding`
-- is not involved and the client is not involved, so neither existing check
-- has anything to say about it.
--
-- The `missing_fields` gate above it normally prevents this, because
-- `submit_provider_application` (006:264) appends 'languages' when the list is
-- empty and approval refuses an incomplete application. But that gate is only
-- as good as whoever wrote the row: `provider_applications` accepts a direct
-- INSERT with no languages and no missing_fields, which is exactly what the
-- pgTAP fixtures have always done, and it is how this was found — the CHECK
-- constraint failed six existing suites that were admitting language-less
-- providers through this door.
--
-- So the requirement is asserted here, in the function, next to the display
-- name and headline requirements it belongs beside. Both layers are kept: this
-- raise gives an admin a sentence they can act on, and the constraint is what
-- makes the rule true regardless of which path is taken next year.
create or replace function public.approve_provider_application(
  p_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.provider_applications;
begin
  select * into v_app from public.provider_applications where user_id = p_user_id;
  if v_app is null then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;
  if array_length(v_app.missing_fields, 1) is not null then
    raise exception 'application for % is incomplete: %',
      p_user_id, array_to_string(v_app.missing_fields, ', ') using errcode = '22023';
  end if;
  if v_app.date_of_birth is null
    or v_app.date_of_birth > (current_date - interval '18 years') then
    raise exception 'applicant % is not verifiably 18 or older', p_user_id
      using errcode = '22023';
  end if;

  -- 075. Checked against the RESULT rather than against the application, because
  -- the clause below falls back to the profile's existing column: an
  -- application with no languages is fine if the row being promoted already
  -- carries some, and is not if it does not.
  if coalesce(
       cardinality(
         case
           when array_length(v_app.languages, 1) is null
             then (select languages from public.profiles where id = p_user_id)
           else v_app.languages
         end
       ), 0) = 0 then
    raise exception 'applicant % has no languages: a provider must offer at least one',
      p_user_id using errcode = '22023';
  end if;

  update public.provider_applications
  set status = 'approved', reviewed_at = now(), reviewer_note = p_note,
      missing_fields = '{}'::text[]
  where user_id = p_user_id;

  update public.profiles
  set role = 'provider',
      display_name = coalesce(v_app.display_name, display_name),
      gender = coalesce(v_app.gender, gender),
      date_of_birth = coalesce(date_of_birth, v_app.date_of_birth),
      headline = coalesce(v_app.headline, headline),
      about = coalesce(v_app.about, about),
      languages = case
        when array_length(v_app.languages, 1) is null then languages
        else v_app.languages
      end,
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = p_user_id;
end;
$$;

comment on function public.approve_provider_application(uuid, text) is
  'Admin approval: promotes an applicant to provider from their application '
  'row. 075 added the language requirement, which is checked against the '
  'RESULT of the promotion rather than the application, because the languages '
  'clause falls back to the profile''s existing column. Before it, an '
  'application with no languages admitted a provider with none — past both the '
  'client check and complete_provider_onboarding, neither of which is on this '
  'path.';
