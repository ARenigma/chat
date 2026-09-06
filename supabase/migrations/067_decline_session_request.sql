-- ===========================================================================
-- 067  Declining a chat request, so the ring has a second answer
-- ===========================================================================
-- Goal item 13 (Amit, 2026-09-05): a chat request reaches the provider as an
-- incoming ring, the way a call does — and a ring with only one button is not
-- a ring, it is a summons.
--
-- `accept_session_request` has existed since 030 and `session_request_status`
-- has carried 'declined' since the same migration (030:51); nothing could ever
-- write it. This is that half.
--
-- Deliberately NOT a cancel: 'cancelled' is the initiator withdrawing and is a
-- different actor with a different meaning. This is the recipient saying no.
create or replace function public.decline_session_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.session_requests%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'GONE');
  end if;
  if v_req.recipient_id <> auth.uid() then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  -- Already answered, expired, or withdrawn. Not an error the provider needs
  -- to see: the ring they were looking at is simply no longer live, and a
  -- decline that arrives after an expiry has got what it wanted anyway.
  if v_req.status <> 'pending' then
    return jsonb_build_object('success', true, 'status', v_req.status);
  end if;

  update public.session_requests
  set    status       = 'declined',
         responded_at = now()
  where  id           = p_request_id;

  return jsonb_build_object('success', true, 'status', 'declined');
end;
$$;

comment on function public.decline_session_request(uuid) is
  'The RECIPIENT says no to a pending session request (067). Idempotent: a '
  'request that is already answered or expired returns success with its real '
  'status, because the caller''s intent is satisfied either way. Distinct from '
  '''cancelled'', which is the initiator withdrawing.';

revoke all on function public.decline_session_request(uuid) from public, anon;
grant execute on function public.decline_session_request(uuid) to authenticated;
