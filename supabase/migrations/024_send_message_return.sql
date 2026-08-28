-- ===========================================================================
-- 024  Restore send_message's full return contract
-- ===========================================================================
-- 011's send_message returned `{success, message_id, created_at, kind,
-- new_balance}`. Migration 014 (attachments) rewrote the function for the
-- three-way payload and, in the process, DROPPED `kind` and `new_balance` from
-- the return — a silent regression carried through 023.
--
-- `new_balance` is not cosmetic: the client reads it to update the balance pill
-- the instant a send debits a token (src/api/chat.ts, api/voice.ts,
-- api/attachments.ts all do `if (typeof result.new_balance === 'number')
-- setBalance(result.new_balance)`). Since 014 that field has been undefined, so
-- the pill only moved on the next profile refetch. `SendResult` in
-- database.types.ts has declared both fields the whole time; the RPC was the one
-- out of contract. This restores it.
--
-- Same 9-arg signature as 023, so `create or replace` preserves the existing
-- grants; only the final json_build_object changes. The body is otherwise
-- identical to 023 (restated whole because a function body cannot be patched in
-- place).

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_voice_path text default null,
  p_voice_duration_ms integer default null,
  p_attachment_path text default null,
  p_attachment_width integer default null,
  p_attachment_height integer default null,
  p_voice_peaks real[] default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_other uuid;
  v_balance integer;
  v_message public.messages;
  v_trimmed text := nullif(btrim(p_body), '');
  v_voice boolean := p_voice_path is not null;
  v_image boolean := p_attachment_path is not null;
  v_recent integer;
  v_suspended timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if (v_trimmed is not null)::int + v_voice::int + v_image::int <> 1 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_trimmed is not null and length(v_trimmed) > 4000 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and (
    p_voice_duration_ms is null
    or p_voice_duration_ms < 1000
    or p_voice_duration_ms > 180000
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and p_voice_peaks is not null
    and array_length(p_voice_peaks, 1) > 64 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_image and (
    p_attachment_width is null
    or p_attachment_height is null
    or p_attachment_width <= 0
    or p_attachment_height <= 0
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and split_part(p_voice_path, '/', 1) <> p_conversation_id::text then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_image and split_part(p_attachment_path, '/', 1) <> p_conversation_id::text then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations
  where id = p_conversation_id;

  if v_member is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id and conversation_id = p_conversation_id
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  v_other := case when v_uid = v_member then v_provider else v_member end;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  select count(*)::int into v_recent
  from public.messages
  where sender_id = v_uid and created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  if v_uid = v_member then
    select token_balance into v_balance
    from public.profiles where id = v_uid
    for update;

    if v_balance is null or v_balance < 1 then
      return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    end if;

    update public.profiles
    set token_balance = token_balance - 1
    where id = v_uid;
  end if;

  insert into public.messages (
    conversation_id, sender_id, body, reply_to_id,
    voice_path, voice_duration_ms, voice_peaks,
    attachment_path, attachment_type, attachment_width, attachment_height
  )
  values (
    p_conversation_id, v_uid, v_trimmed, p_reply_to_id,
    p_voice_path, p_voice_duration_ms,
    case when v_voice then p_voice_peaks else null end,
    p_attachment_path, case when v_image then 'image' else null end,
    p_attachment_width, p_attachment_height
  )
  returning * into v_message;

  update public.conversations
  set last_message_at = v_message.created_at
  where id = p_conversation_id;

  -- The full contract 011 defined and the client still reads: `kind` (which
  -- payload landed, so the caller need not re-derive it) and `new_balance` (the
  -- post-debit balance, or null when a provider reply cost nothing). `v_balance`
  -- holds the pre-debit balance read `for update` above, so `- 1` is the new one.
  return json_build_object(
    'success', true,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'kind', case when v_voice then 'voice' when v_image then 'image' else 'text' end,
    'new_balance', case when v_uid = v_member then v_balance - 1 else null end
  );
end;
$$;

-- Idempotent re-grant. `create or replace` preserves the existing ACL, but
-- restating it keeps this migration readable in isolation and harmless if the
-- prior grants ever drift.
revoke all on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  to authenticated;
