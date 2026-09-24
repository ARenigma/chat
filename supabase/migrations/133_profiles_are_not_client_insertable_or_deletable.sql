-- ===========================================================================
-- 133  A client cannot insert or delete its own profile row
-- ===========================================================================
--
-- Found 2026-09-23, confirmed against prod 2026-09-24 (pg_policies, grants,
-- pg_trigger): owners held INSERT and DELETE on public.profiles via
-- "Profile insertable by owner" / "Profile deletable by owner" (003), and
-- every column guard (guard_privileged_profile_columns, guard_pii_columns,
-- guard_phone_columns, guard_presence_columns) is BEFORE UPDATE only.
--
-- So a signed-in user with no rows referencing their profile could DELETE it
-- and INSERT it back with any promo_balance, role, or phone_verified_at —
-- free tokens spendable on paid providers, a self-granted provider role, or a
-- claimed verified phone (which resolve_phone_owner, 127-131, now treats as
-- account ownership).
--
-- Nothing legitimate needs either privilege:
--   * rows are created by the auth trigger (002, security definer);
--   * account deletion is delete_user_account(), which deletes auth.users and
--     cascades, without the client's DELETE grant.
-- The app never inserts, upserts, or deletes profiles from the client
-- (grep, 2026-09-24).
-- ---------------------------------------------------------------------------

drop policy if exists "Profile insertable by owner" on public.profiles;
drop policy if exists "Profile deletable by owner" on public.profiles;

revoke insert, delete on public.profiles from anon, authenticated;
