-- ===========================================================================
-- 192  The rename cooldown column is not client-writable
-- ===========================================================================
-- 190 added profiles.display_name_changed_at and enforces "one display-name
-- change per 30 days" inside update_provider_profile by reading it. The 190
-- direct-write guard covered the five profile text columns but not this one,
-- so a provider could PATCH their own row with display_name_changed_at = null
-- and rename again at once. The cooldown was only as strong as that column.
--
-- This replaces the 190 guard function with the same body plus one check,
-- placed BEFORE the provider-only filter: no client ever needs to write the
-- cooldown column directly, member or provider. update_provider_profile is
-- SECURITY DEFINER, so its writes pass the current_user check as before.
create or replace function public.guard_provider_profile_columns_direct_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Trusted paths (complete_provider_onboarding, claim_member_profile,
  -- update_provider_profile, set_provider_expertise) run as SECURITY DEFINER
  -- so current_user is the function owner, not 'authenticated' or 'anon'.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 192: the rename cooldown is server state for every role.
  if new.display_name_changed_at is distinct from old.display_name_changed_at then
    raise exception
      'display_name_changed_at is server-managed; use update_provider_profile'
      using errcode = '42501';
  end if;

  -- Guard only provider rows. A member setting up their profile arrives here
  -- with role = 'member' (or null for the very first write) and passes.
  -- `is distinct from`, not coalesce(role, ''): role is the user_role enum
  -- and '' is not one of its values, so the coalesce failed every update.
  if new.role is distinct from 'provider' then
    return new;
  end if;

  if new.display_name is distinct from old.display_name
    or new.headline    is distinct from old.headline
    or new.about       is distinct from old.about
    or new.languages   is distinct from old.languages
    or new.expertise   is distinct from old.expertise
  then
    raise exception
      'direct writes to provider profile fields are not permitted; use update_provider_profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_provider_profile_columns_direct_write() is
  'BEFORE UPDATE guard on public.profiles (190, 192): refuses a direct client '
  'write (current_user in authenticated/anon) to display_name_changed_at on '
  'any row, and to display_name, headline, about, languages or expertise on a '
  'provider row. SECURITY DEFINER writers pass because their current_user is '
  'the function owner.';

-- create or replace keeps the 190 revoke; restated so this file stands alone.
revoke all on function public.guard_provider_profile_columns_direct_write()
  from public, anon, authenticated;
