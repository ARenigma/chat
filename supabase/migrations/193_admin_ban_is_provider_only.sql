-- ===========================================================================
-- 193  admin_ban_provider bans providers only
-- ===========================================================================
-- 191's admin_suspend_provider and admin_delist_provider refuse an id that is
-- not a provider; admin_ban_provider only checked that the profile existed.
-- A mistyped member id from the providers console would set that member's
-- suspended_until to 2999 and write an audit row labelled 'provider'. Members
-- are moderated through the contact-guard review (contact_guard_resolve_review),
-- not this function. Same body as 191 with the role check suspend already has.
create or replace function public.admin_ban_provider(
  p_provider_id uuid,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_until constant timestamptz := timestamptz '2999-01-01 00:00:00+00';
begin
  if not exists (
    select 1 from public.profiles where id = p_provider_id and role = 'provider'
  ) then
    raise exception 'provider not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set suspended_until = v_until
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason)
  values
    ('ban', p_provider_id::text, 'provider', p_actor, p_reason);

  return jsonb_build_object('ok', true, 'suspended_until', v_until);
end;
$$;

-- create or replace keeps 191's grants; restated so this file stands alone.
revoke all on function public.admin_ban_provider(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_ban_provider(uuid, text, text)
  to service_role;
