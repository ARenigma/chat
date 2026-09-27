-- 180 — a live provider edits their own headline, about and languages.
--
-- Until now nothing could. The application form is the only writer of those
-- three fields, and it runs once: `complete_provider_onboarding` copies them in
-- the statement that flips the role. After that:
--
--   * `headline` is refused to a client PATCH by `guard_pii_columns` (012),
--     whose own note records the cost — "a provider cannot edit their own
--     headline after approval ... when it is asked for the answer is an RPC
--     that re-runs the review rules, not a PATCH". This is that RPC.
--   * `about` and `languages` are client-writable, but a direct PATCH reports
--     a constraint name (`profiles_languages_sane`,
--     `profiles_provider_has_a_language`) nobody can act on. Written here with
--     headline, in one statement, so the Edit profile screen saves one form
--     with one answer rather than two writes that can half-succeed.
--
-- Expertise is NOT here: `set_provider_expertise` (083) already owns it and is
-- called by the same screen. Reproducing its rule would be a second copy.
--
-- The rules are the columns' own, restated as sentences (22023):
--   headline  1..140 characters after trimming  (006 CHECK, onboarding requires it)
--   about     1..2000 characters after trimming (042 CHECK, onboarding requires it)
--   languages 1..12 entries, each 1..40         (075 + language_list_is_sane)
--
-- SECURITY DEFINER, so the write runs as the owner and `guard_pii_columns`
-- (which only refuses `authenticated`/`anon`) lets the headline through. The
-- contact guard is NOT bypassed by that: `contact_guard_profile_fields` (157)
-- keys on `auth.uid()`, which is still the caller's, so a headline or about
-- carrying a number, link or handle is refused with P0011 exactly as the other
-- definer writers (claim_member_profile, complete_provider_onboarding,
-- set_provider_expertise) are. The client maps it with
-- `contactGuardRefusalFromError`.

create or replace function public.update_provider_profile(
  p_headline text,
  p_about text,
  p_languages text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_headline  text := btrim(coalesce(p_headline, ''));
  v_about     text := btrim(coalesce(p_about, ''));
  v_languages text[] := coalesce(p_languages, '{}'::text[]);
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'provider' then
    raise exception 'only a provider has a public profile' using errcode = '42501';
  end if;

  if length(v_headline) not between 1 and 140 then
    raise exception 'a headline is 1 to 140 characters' using errcode = '22023';
  end if;
  if length(v_about) not between 1 and 2000 then
    raise exception 'about is 1 to 2000 characters' using errcode = '22023';
  end if;
  if cardinality(v_languages) = 0 or not public.language_list_is_sane(v_languages) then
    raise exception 'at least one language, at most 12, each 1 to 40 characters'
      using errcode = '22023';
  end if;

  update public.profiles
  set headline  = v_headline,
      about     = v_about,
      languages = v_languages
  where id = v_uid;
end;
$$;

comment on function public.update_provider_profile(text, text, text[]) is
  'A live provider replaces their own headline, about and languages (180). '
  'The only client path to headline since 012 closed the PATCH. Restates the '
  'columns'' CHECKs as sentences (22023); the contact guard still refuses '
  'contact details at save (P0011) because it keys on auth.uid(). Expertise '
  'stays with set_provider_expertise (083).';

-- Client RPC: closed to PUBLIC and anon, open to authenticated, and on 568's
-- list and 563's 39t allowlist. 153 closed the default, so without the grant
-- the screen's save is "permission denied".
revoke all on function public.update_provider_profile(text, text, text[]) from public, anon;
grant execute on function public.update_provider_profile(text, text, text[]) to authenticated;
