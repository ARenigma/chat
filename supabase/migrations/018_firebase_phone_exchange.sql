-- Firebase phone sign-in (AUTH_PHONE_PROVIDER = 'firebase').
--
-- The `exchange-firebase-token` Edge Function verifies a Firebase ID token and
-- then has to map the verified E.164 phone to an existing auth user so a repeat
-- sign-in lands on the SAME Supabase user (and the same profile/wallet/history)
-- rather than minting a duplicate.
--
-- supabase-js v2 has no `getUserByPhone`, and GoTrue's admin `listUsers` proved
-- unreliable on this project ("Database error finding users"). `auth.users` is
-- also not exposed through PostgREST. This SECURITY DEFINER lookup is the clean,
-- reliable seam: a direct read of auth.users, EXECUTE granted ONLY to
-- service_role (the Edge Function's admin client). anon and authenticated
-- callers can never reach it, so it cannot be used from a device to enumerate
-- which phone numbers have accounts.
--
-- GoTrue stores the phone WITHOUT the leading '+', so the function strips it.
create or replace function public.get_user_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id from auth.users
  where phone = ltrim(p_phone, '+')
  limit 1;
$$;

revoke all on function public.get_user_id_by_phone(text) from public;
revoke all on function public.get_user_id_by_phone(text) from anon;
revoke all on function public.get_user_id_by_phone(text) from authenticated;
grant execute on function public.get_user_id_by_phone(text) to service_role;
