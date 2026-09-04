-- 056  Hold the verified DOB off the member profile until promotion
--
-- WHY THIS EXISTS
--
-- Migration 011 added `member_is_pseudonymous`:
--
--   check (role = 'provider'
--          or (date_of_birth is null and gender is null and headline is null))
--
-- A member row carrying a birth date is unrepresentable, deliberately — members
-- are pseudonymous and that is a product guarantee, not an implementation
-- detail.
--
-- 054 then gated `complete_provider_onboarding` on `identity_state = 'verified'`
-- and required a `date_of_birth` on the profile for that state. Those two rules
-- cannot both hold. Becoming a provider needed a verified DOB on the profile;
-- writing a DOB to the profile needed to already be a provider. Nobody could
-- ever be promoted. Verified on the live database 2026-09-05: the write fails
-- with `23514 ... violates check constraint "member_is_pseudonymous"`.
--
-- This is NOT only a 054 problem. `cashfree-onboarding-complete` has always
-- written `date_of_birth` straight onto the member's profile, so the 1-Click
-- flow would have hit the same wall the moment Cashfree's consent sheet worked.
-- Two independent blockers, and only one of them was visible.
--
-- 011's own comment names the intended pattern: the promotion "copies fields
-- from the application row in the same UPDATE that sets role = 'provider', so
-- the age gate still has something to check at exactly the moment it checks."
-- This restores that shape for the auto-onboarding path.

-- ---------------------------------------------------------------------------
-- Where a verified DOB lives before promotion
-- ---------------------------------------------------------------------------
-- On `provider_tax_profile`, which is already the record of the PAN check that
-- produced it: PAN 360 returns `date_of_birth` in the same response as the
-- registered name. Keeping them together means one row is the whole story of
-- "who did we verify, and how", and the member's own profile stays clean.
alter table public.provider_tax_profile
  add column if not exists verified_dob date;

comment on column public.provider_tax_profile.verified_dob is
  'Date of birth as returned by the identity check (PAN 360 or Cashfree 1-Click). '
  'Held HERE and not on profiles because member_is_pseudonymous (migration 011) '
  'forbids a birth date on a member row. complete_provider_onboarding copies it '
  'onto the profile in the same UPDATE that sets role = provider.';

-- ---------------------------------------------------------------------------
-- 054's consistency check, corrected
-- ---------------------------------------------------------------------------
-- It required a profile `date_of_birth` for `identity_state = 'verified'`, which
-- is precisely the impossible half. The state's real meaning is "an identity
-- check ran and succeeded", and `identity_verified_at` is the honest witness for
-- that. The DOB is still mandatory to be PROMOTED — that check moved into the
-- RPC, where it belongs, because it is a rule about becoming a provider rather
-- than a rule about the shape of a row.
alter table public.profiles
  drop constraint if exists profiles_identity_verified_consistent;

alter table public.profiles
  add constraint profiles_identity_verified_consistent
  check (identity_state <> 'verified' or identity_verified_at is not null);

-- Any row 054's backfill left mid-way: a verified member whose DOB could not be
-- written. There should be none (the write always failed), but a constraint that
-- has been wrong once is worth reconciling explicitly rather than assuming.
update public.profiles
set identity_state = 'none',
    identity_verified_at = null
where identity_state = 'verified'
  and identity_verified_at is null;

-- ---------------------------------------------------------------------------
-- Promotion copies the DOB across in the same statement
-- ---------------------------------------------------------------------------
create or replace function public.complete_provider_onboarding(
  p_display_name text,
  p_headline text,
  p_languages text[],
  p_about text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_state text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'a display name is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_headline, '')) = '' then
    raise exception 'a headline is required' using errcode = '22023';
  end if;
  if p_languages is null or array_length(p_languages, 1) is null then
    raise exception 'at least one language is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_about, '')) = '' then
    raise exception 'an about is required' using errcode = '22023';
  end if;

  select identity_state into v_state from public.profiles where id = v_uid;
  if v_state is distinct from 'verified' then
    raise exception 'verify your identity first' using errcode = '22023';
  end if;

  -- The DOB comes from the identity record, not from the caller and not from
  -- the profile (where a member is forbidden to have one).
  select verified_dob into v_dob
    from public.provider_tax_profile
   where provider_id = v_uid;

  if v_dob is null then
    raise exception 'date of birth missing from your verification' using errcode = '22023';
  end if;
  if v_dob > (current_date - interval '18 years') then
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;

  -- ONE statement. `role` and `date_of_birth` change together, so
  -- `member_is_pseudonymous` sees a provider row and is satisfied — the pattern
  -- migration 011 describes for the reviewed path.
  update public.profiles
  set role = 'provider',
      date_of_birth = v_dob,
      display_name = btrim(p_display_name),
      headline = btrim(p_headline),
      languages = p_languages,
      about = btrim(p_about),
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = v_uid;
end;
$$;

revoke all on function public.complete_provider_onboarding(text, text, text[], text) from public;
grant execute on function public.complete_provider_onboarding(text, text, text[], text) to authenticated;

comment on function public.complete_provider_onboarding(text, text, text[], text) is
  'Completes provider onboarding. Requires identity_state = verified and a '
  'provider_tax_profile.verified_dob of 18 years or older. Sets role = provider '
  'and copies the DOB onto the profile in the same statement, so a member row '
  'never holds one (member_is_pseudonymous, migration 011).';
