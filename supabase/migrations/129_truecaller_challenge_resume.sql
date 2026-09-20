-- 129  Resume Truecaller session minting after a consumed challenge
--
-- 127 atomically linked the external identity and consumed its challenge, but
-- GoTrue session minting necessarily happens afterward through the Admin API.
-- A transient mint/network failure therefore left a correctly linked account
-- with no retryable challenge. Record the linked UUID on consumption and allow
-- service_role to resume minting for that exact UUID during the original
-- ten-minute challenge window. The RPC never changes ownership.

alter table private.pending_identity_challenges
  add column if not exists linked_user_id uuid
  references auth.users(id) on delete cascade;

create or replace function public.consume_and_link_pending_challenge(
  p_challenge_hash text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge private.pending_identity_challenges%rowtype;
begin
  select * into v_challenge
    from private.pending_identity_challenges
   where challenge_hash = p_challenge_hash
     and consumed_at is null
     and expires_at > now()
   for update;

  if not found then
    raise exception 'challenge not found, already consumed, or expired'
      using errcode = 'P0002';
  end if;

  perform public.upsert_external_identity(
    v_challenge.provider,
    v_challenge.subject,
    v_challenge.phone_e164,
    p_user_id
  );

  update private.pending_identity_challenges
     set consumed_at = now(),
         linked_user_id = p_user_id
   where id = v_challenge.id;
end;
$$;

revoke all on function public.consume_and_link_pending_challenge(text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_and_link_pending_challenge(text, uuid)
  to service_role;

create or replace function public.resolve_consumed_challenge_user(
  p_challenge_hash text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select linked_user_id
    from private.pending_identity_challenges
   where challenge_hash = p_challenge_hash
     and consumed_at is not null
     and linked_user_id is not null
     and expires_at > now()
   limit 1;
$$;

revoke all on function public.resolve_consumed_challenge_user(text)
  from public, anon, authenticated;
grant execute on function public.resolve_consumed_challenge_user(text)
  to service_role;
