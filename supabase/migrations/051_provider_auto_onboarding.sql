-- ===========================================================================
-- 051  Provider auto-onboarding (no admin review)
-- ===========================================================================
-- The provider flow used to be: apply → an admin runs approve_provider_application
-- (migration 006) → listed. This adds the auto-approve path: a provider who has
-- completed Cashfree 1-Click verification (identity + PAN + bank, written by the
-- cashfree-onboarding-complete Edge function) and filled their profile goes live
-- immediately, with no human review.
--
-- Why this is safe enough to auto-approve (Amit, 2026-09-03): Cashfree KYC means
-- every listener is a real, identity-traceable adult (PAN + bank on file). The
-- reviewability that a human queue gave is preserved as an after-the-fact admin
-- Providers list + suspend, not a blocking gate. Reversible: to reinstate review,
-- stop calling this and route back through approve_provider_application. See the
-- ADR for the full argument.
--
-- This writes the SAME columns approve_provider_application does — role,
-- display_name, headline, languages, about, identity_verified_at — but is called
-- by the provider themselves (auth.uid()). SECURITY DEFINER so it can write the
-- guarded PII columns (headline / role / identity_verified_at), whose triggers
-- (migrations 003 / 006 / 012) only block the 'authenticated' and 'anon' roles.

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
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- Everything except the photo is mandatory (product decision 2026-09-03).
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

  -- Age gate (legal, non-negotiable). The DOB is set by the Cashfree 1-Click step
  -- that runs BEFORE this in the flow, so a missing DOB means identity was not
  -- verified — refuse rather than list an age-unknown provider.
  select date_of_birth into v_dob from public.profiles where id = v_uid;
  if v_dob is null then
    raise exception 'verify your identity first' using errcode = '22023';
  end if;
  if v_dob > (current_date - interval '18 years') then
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;

  update public.profiles
  set role = 'provider',
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
  'Auto-approve: a provider who finished Cashfree 1-Click verification + their '
  'profile goes live immediately (role=provider, identity_verified_at=now). '
  'Replaces the admin approve_provider_application gate. Migration 051.';
