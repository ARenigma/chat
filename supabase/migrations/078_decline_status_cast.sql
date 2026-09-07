-- ===========================================================================
-- 078  decline_session_request: enum assignment needs a cast
-- ===========================================================================
-- 076 let the initiator withdraw as cancelled. Postgres will not assign a
-- bare text CASE to session_request_status. Member Decline on the consent
-- sheet hits this path.

create or replace function public.decline_session_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.session_requests%rowtype;
  v_uid uuid := auth.uid();
  v_next public.session_request_status;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'GONE');
  end if;
  if v_req.recipient_id <> v_uid and v_req.initiator_id <> v_uid then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('success', true, 'status', v_req.status);
  end if;

  v_next := case
    when v_req.initiator_id = v_uid then 'cancelled'::public.session_request_status
    else 'declined'::public.session_request_status
  end;

  update public.session_requests
  set    status       = v_next,
         responded_at = now()
  where  id           = p_request_id;

  return jsonb_build_object('success', true, 'status', v_next);
end;
$$;

revoke all on function public.decline_session_request(uuid) from public, anon;
grant execute on function public.decline_session_request(uuid) to authenticated;
