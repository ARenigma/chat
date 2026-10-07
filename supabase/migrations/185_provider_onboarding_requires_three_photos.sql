-- ===========================================================================
-- 185  Going live needs at least three photos
-- ===========================================================================
-- Amit, 2026-10-03: "3 photos mandatory with one primary for provider in the
-- flow itself ... at least 3". The application screen now takes the photos
-- before Go live; this is the same rule in the database, so a client that
-- skips the step (an old build, a direct RPC call) cannot become a provider
-- without a face. Only `complete_provider_onboarding` changes: 065's body, plus
-- the photo count. The signature, grants and everything else are unchanged, and
-- providers who are already live are untouched (the function runs once).
--
-- It also closes a gap this flow would open: 070's trigger mirrors the main
-- photo onto profiles.avatar_url for ANYONE who owns photos, and an applicant is
-- still a member (clay avatar, pseudonymous). A member who uploaded photos and
-- left would have shown their real face to providers. The mirror is now
-- provider-only, and promotion sets avatar_url from the main photo in the same
-- statement that sets the role.
--
-- 22023, like every other refusal in this function, so the client can say it
-- next to the right step.
-- ===========================================================================

create or replace function public.complete_provider_onboarding(
  p_display_name text,
  p_headline text,
  p_languages text[],
  p_about text,
  -- Appended with a default, so the 4-arg call sites keep working while the
  -- client rolls out. 'listener' is what every existing provider is.
  p_provider_category text default 'listener'
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
  if p_provider_category not in ('listener', 'astrologer') then
    raise exception 'unknown provider category: %', p_provider_category
      using errcode = '22023';
  end if;

  -- A provider is chosen by face, so the flow cannot end without them (Amit,
  -- 2026-10-03: "3 photos mandatory with one primary ... at least 3"). The
  -- gallery's own trigger (070) guarantees one of them is primary once any
  -- exists, so the count is the whole check. Photos are the caller's own rows
  -- (provider_photos_insert_own is provider_id = auth.uid(), with no role
  -- condition), which is how a member can add them before being promoted.
  if (select count(*) from public.provider_photos where provider_id = v_uid) < 3 then
    raise exception 'add at least 3 photos of yourself' using errcode = '22023';
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
      provider_category = p_provider_category,
      -- The face: the main photo, set here because the mirror trigger skips
      -- members. 112's guard has nothing to null (it is a URL, not clay).
      avatar_url = (
        select url from public.provider_photos
         where provider_id = v_uid and is_primary
         limit 1
      ),
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = v_uid;
end;
$$;

create or replace function public.provider_photos_sync_avatar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_url      text;
begin
  -- NEW is unassigned on DELETE in PL/pgSQL; reading a field of it raises.
  if tg_op = 'DELETE' then
    v_provider := old.provider_id;
  else
    v_provider := new.provider_id;
  end if;

  -- A gallery is a decision, not an album. Six: two rows of three tiles in the
  -- manager, and a dot row that still reads as dots on a 360dp hero.
  if tg_op = 'INSERT' then
    if (select count(*) from public.provider_photos
        where provider_id = v_provider) > 6 then
      raise exception 'a provider may publish at most 6 photos'
        using errcode = 'P0010';
    end if;
  end if;

  if tg_op <> 'UPDATE' then
    if not exists (
      select 1 from public.provider_photos
      where provider_id = v_provider and is_primary
    ) then
      update public.provider_photos p
      set    is_primary = true
      where  p.id = (
        select id from public.provider_photos
        where  provider_id = v_provider
        order  by created_at asc, id asc
        limit  1
      );
    end if;
  end if;

  select url into v_url
  from   public.provider_photos
  where  provider_id = v_provider and is_primary;

  -- NULL when the last photo goes, which is honest: the gallery is empty and
  -- the directory falls back to the initial, exactly as useRemoveAvatar does.
  -- `is distinct from` stops the recursive pass writing profiles twice.
  -- Providers only (185). During the application the owner is still a MEMBER,
  -- and a member's picture is a clay avatar by design; mirroring a real photo
  -- onto them would show it to every provider they chat with if they abandoned
  -- the flow. Promotion (complete_provider_onboarding) sets the face itself.
  update public.profiles
  set    avatar_url = v_url
  where  id = v_provider
    and  role = 'provider'
    and  avatar_url is distinct from v_url;

  return null;
end;
$$;


revoke all on function
  public.complete_provider_onboarding(text, text, text[], text, text) from public;
grant execute on function
  public.complete_provider_onboarding(text, text, text[], text, text) to authenticated;
