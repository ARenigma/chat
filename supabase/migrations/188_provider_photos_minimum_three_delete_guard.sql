-- ===========================================================================
-- 188  A provider cannot delete photos below the three-photo minimum
-- ===========================================================================
-- Migration 185 enforces the floor at go-live (complete_provider_onboarding);
-- this is the matching runtime guard so a live provider cannot delete their
-- gallery down to zero via the "Your photos" page or a direct RPC.
--
-- Implemented as a BEFORE DELETE trigger (separate function, not a rewrite of
-- provider_photos_sync_avatar) so the two responsibilities stay single-purpose.
--
-- WHAT IS BLOCKED
--   A DELETE on `provider_photos` where:
--     - the owner's profile still exists, AND
--     - the owner's role is 'provider', AND
--     - the gallery would drop below 3 after this delete.
--   Raises: errcode '22023', message 'keep at least 3 photos'.
--
-- WHAT IS NOT BLOCKED
--   - Members and applicants: role check fails → guard skips.
--   - Account-deletion cascade: `delete_user_account` (170) deletes auth.users
--     which cascades through profiles to provider_photos. By the time this
--     BEFORE DELETE trigger fires for a cascade-originated delete, the profiles
--     row is already gone, so `NOT FOUND` → guard skips. This preserves the
--     guarantees migration 170 established.
--   - Any future admin-level hard-delete that bypasses RLS runs as a role
--     that is not 'authenticated', so RLS policies aside, the profile row check
--     is the only gate, and a missing profile skips it cleanly.
--
-- No grant is needed: triggers run as the function's SECURITY DEFINER, not
-- as the caller.
-- ===========================================================================

create or replace function public.provider_photos_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_count bigint;
begin
  -- Skip if the provider's profile no longer exists: this path is taken during
  -- the account-deletion cascade (170), where `delete from auth.users` causes
  -- profiles to be deleted first, and then provider_photos rows are deleted by
  -- the FK cascade. A BEFORE DELETE trigger fires with the row still present,
  -- but by then the profile is already gone.
  -- https://www.postgresql.org/docs/16/trigger-row-tables.html
  select role into v_role
  from   public.profiles
  where  id = old.provider_id;

  if not found then
    -- Profile already gone (account-deletion cascade) — let the delete proceed.
    return old;
  end if;

  if v_role <> 'provider' then
    -- Members and applicants are not subject to the photo minimum.
    return old;
  end if;

  select count(*) into v_count
  from   public.provider_photos
  where  provider_id = old.provider_id;

  -- This is a BEFORE trigger, so the row being deleted is still counted.
  -- After deletion the count would be v_count - 1. Refuse when that drops
  -- below 3 (MIN_PROVIDER_PHOTOS, migration 185).
  if v_count <= 3 then
    raise exception 'keep at least 3 photos'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

-- Drop first in case a previous failed migration left it.
drop trigger if exists provider_photos_delete_guard on public.provider_photos;

-- Closed to clients, like every trigger function (153; pinned by pgTAP 568):
-- a trigger fires as the table's owner, so nobody needs to call it directly.
revoke all on function public.provider_photos_delete_guard() from public, anon, authenticated;

create trigger provider_photos_delete_guard
  before delete on public.provider_photos
  for each row
  execute function public.provider_photos_delete_guard();

comment on function public.provider_photos_delete_guard() is
  'BEFORE DELETE guard (188): refuses a delete that would leave a live '
  'provider with fewer than 3 photos. Skips during account-deletion cascades '
  '(profile already gone), and for members/applicants (role check). '
  'Complements the go-live floor in complete_provider_onboarding (185).';
