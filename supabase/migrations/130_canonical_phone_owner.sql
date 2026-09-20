-- 130  Route the legacy Firebase phone lookup through canonical ownership
--
-- Migration 018's get_user_id_by_phone read only auth.users.phone. Truecaller
-- introduced verified profile phones and stable external identities, so keeping
-- the old lookup would let Firebase create a second account for a phone already
-- owned by an existing Google/Truecaller user.

create or replace function public.get_user_id_by_phone(p_phone text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.resolve_phone_owner(p_phone);
$$;

revoke all on function public.get_user_id_by_phone(text)
  from public, anon, authenticated;
grant execute on function public.get_user_id_by_phone(text) to service_role;
