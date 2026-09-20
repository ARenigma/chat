-- 131  Recheck canonical phone ownership at the atomic link commit
--
-- A phone can be unowned when Truecaller issues a pending challenge, then be
-- claimed by Firebase/OTP before the member completes linking. Revalidate the
-- canonical owner under the phone advisory lock so a delayed challenge cannot
-- create split identities.

create or replace function public.upsert_external_identity(
  p_provider text,
  p_subject text,
  p_phone text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.external_identities%rowtype;
  v_phone_owner uuid;
begin
  if p_provider <> 'truecaller'
     or p_subject is null or btrim(p_subject) = ''
     or p_phone !~ '^\+[1-9][0-9]{7,14}$'
     or p_user_id is null then
    raise exception 'invalid external identity' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('subject:' || p_provider || ':' || p_subject));
  perform pg_advisory_xact_lock(hashtext('phone:' || p_phone));

  v_phone_owner := public.resolve_phone_owner(p_phone);
  if v_phone_owner is not null and v_phone_owner <> p_user_id then
    raise exception 'identity conflict: phone already owned by a different user'
      using errcode = 'P0001';
  end if;

  select * into v_existing
    from private.external_identities
   where provider = p_provider and subject = p_subject;

  if found then
    if v_existing.user_id <> p_user_id then
      raise exception 'identity conflict: subject already bound to a different user'
        using errcode = 'P0001';
    end if;
    if v_existing.phone_e164 <> p_phone then
      raise exception 'identity conflict: subject phone changed'
        using errcode = 'P0001';
    end if;
    return;
  end if;

  if exists (
    select 1 from private.external_identities
     where phone_e164 = p_phone
       and (provider <> p_provider or subject <> p_subject or user_id <> p_user_id)
  ) then
    raise exception 'identity conflict: phone already bound to a different identity'
      using errcode = 'P0001';
  end if;

  insert into private.external_identities
    (provider, subject, phone_e164, user_id)
  values
    (p_provider, p_subject, p_phone, p_user_id);
end;
$$;

revoke all on function public.upsert_external_identity(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_external_identity(text, text, text, uuid)
  to service_role;
