-- ===========================================================================
-- 082  Declining means "no session", not "ask me again in a minute"
-- ===========================================================================
-- Amit, 2026-09-08: "when i decline the session prompt then also msg got
-- delivered? decline ok but msg blocked thereafter and contnuous promot on
-- every send gating msg off".
--
-- ---------------------------------------------------------------------------
-- What was actually happening
-- ---------------------------------------------------------------------------
-- Both halves of the report are real, and they are the same loop:
--
--   1. Member sends       → send_message creates a PENDING chat request.
--   2. Provider replies   → send_message sets responded_at on it. The message
--                           is delivered, because pre-session chat is free
--                           (there is no cap, only a 20/min rate limit). This
--                           is why "msg got delivered" after a decline: the
--                           decline refuses a SESSION, it does not unsend a
--                           message that was never charged for.
--   3. Member declines    → status = 'declined'.
--   4. Member sends again → no PENDING request exists any more (the unique
--                           index `session_requests_one_pending` is partial on
--                           status = 'pending'), so a BRAND NEW pending request
--                           is created.
--   5. Provider replies   → responded_at set on the new one → PROMPTED AGAIN.
--
-- And because `awaitingMemberConsent` disables the composer while a prompt is
-- up, every single exchange after a decline re-armed the prompt and re-gated
-- the composer. "Continuous prompt on every send gating msg off", exactly.
--
-- Nothing was broken in the sense of a defect in one place. A decline was
-- modelled as a fact about one REQUEST, when the member meant it as a fact
-- about the CONVERSATION.
--
-- ---------------------------------------------------------------------------
-- The chosen semantics (Amit, 2026-09-08)
-- ---------------------------------------------------------------------------
-- Decline = "no session". The composer closes and offers an explicit
-- "Start session" instead of nagging. Nothing re-prompts until the member
-- chooses. The two rejected alternatives are recorded because they are both
-- defensible and someone will ask:
--
--   "not now" + cooldown — friendliest, but pre-session chat is free and
--     uncapped, so a member who declines every 30 minutes chats free forever.
--     A revenue hole, not a UX preference.
--   decline = leave the thread — simplest, harshest.
--
-- ---------------------------------------------------------------------------
-- Why a flag on `conversations` and not on `session_requests`
-- ---------------------------------------------------------------------------
-- The state being recorded is "this member does not want to be asked in this
-- conversation", which outlives any one request — that is precisely the bug.
-- Hanging it off a request row would put it back on the object whose lifetime
-- is too short, and step 4 above would erase it again.
--
-- It is deliberately NOT stored on the device. A decline must survive a
-- reinstall and hold on a second device; MMKV would make "am I being asked
-- again?" a per-install question.
--
-- `send_message` is NOT touched. It keeps creating requests as it does today,
-- which is harmless: with the composer closed the member creates none, and a
-- provider's reply setting responded_at is now ignored by the client while the
-- flag is set. That function is 295 lines and 054's lesson stands.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists chat_consent_declined_at timestamptz;

comment on column public.conversations.chat_consent_declined_at is
  'When the MEMBER last declined to start a paid chat session here. While set, '
  'the client shows an explicit "Start session" control instead of the consent '
  'prompt, and does not re-ask. Cleared by resume_chat_consent(). On the '
  'conversation rather than the request because the member''s intent outlives '
  'any one request — that was the bug 082 fixes.';

-- ---------------------------------------------------------------------------
-- 2. Declining records it
-- ---------------------------------------------------------------------------
-- 078's body reproduced with one INSERT of behaviour. Reproducing a body is
-- normally the 054 mistake; it is acceptable here only because the function is
-- forty lines with no second responsibility to lose, and the whole of it is
-- visible in this file. Contrast `send_message`, which is 295 lines and is
-- therefore wrapped rather than edited (081).
--
-- The status logic is unchanged from 078, including the enum casts that 078
-- exists for: Postgres will not assign text to session_request_status when the
-- CASE has no rows to infer from.
create or replace function public.decline_session_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req  public.session_requests%rowtype;
  v_uid  uuid := auth.uid();
  v_next public.session_request_status;
  v_member uuid;
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

  /*
   * 082: record it against the conversation, but ONLY when the person walking
   * away is the member.
   *
   * A provider declining is a different fact — they are unavailable, which the
   * availability flags already carry — and must not silence the member's own
   * prompt. So the member is looked up rather than inferred from who called:
   * either party can reach this function, and for a chat request the initiator
   * may be either one of them (077 let providers start).
   */
  if v_req.channel = 'chat' then
    select member_id into v_member
    from   public.conversations
    where  id = v_req.conversation_id;

    if v_member = v_uid then
      update public.conversations
      set    chat_consent_declined_at = now()
      where  id = v_req.conversation_id;
    end if;
  end if;

  return jsonb_build_object('success', true, 'status', v_next);
end;
$$;

comment on function public.decline_session_request(uuid) is
  'Withdraw (initiator) or refuse (recipient) an open session request. 082: a '
  'MEMBER refusing a chat request also sets '
  'conversations.chat_consent_declined_at, so the client stops re-asking on '
  'every exchange. A provider refusing does not — that is unavailability, not '
  'the member''s consent.';

-- ---------------------------------------------------------------------------
-- 3. The explicit way back in
-- ---------------------------------------------------------------------------
-- Clears the flag and reports what the member is walking back into, so one
-- round trip is enough for the client to decide between "the provider is
-- already here, confirm the session" and "reopen the composer and say hello".
create or replace function public.resume_chat_consent(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_member uuid;
  v_req    public.session_requests%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select member_id into v_member
  from   public.conversations
  where  id = p_conversation_id;

  if v_member is null then
    return jsonb_build_object('success', false, 'error', 'GONE');
  end if;
  -- Only the member may clear their own consent decision. A provider clearing
  -- it would be the provider deciding to be asked about again, which is the
  -- nagging this migration removes.
  if v_member <> v_uid then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  update public.conversations
  set    chat_consent_declined_at = null
  where  id = p_conversation_id;

  select * into v_req
  from   public.session_requests
  where  conversation_id = p_conversation_id
    and  channel         = 'chat'
    and  status          = 'pending'
    and  expires_at      > now()
  order  by created_at desc
  limit  1;

  return jsonb_build_object(
    'success', true,
    -- Non-null only when there is a live request the member can confirm right
    -- now; the client passes it straight to confirm_chat_session.
    'request_id', case when v_req.id is not null and v_req.responded_at is not null
                       then v_req.id else null end,
    'provider_joined', coalesce(v_req.responded_at is not null, false)
  );
end;
$$;

comment on function public.resume_chat_consent(uuid) is
  'Member reverses their own decline. Clears '
  'conversations.chat_consent_declined_at and returns request_id when a joined '
  'request is already waiting, so the caller can confirm the session in one '
  'more call instead of re-deriving the state.';

revoke all on function public.resume_chat_consent(uuid) from public;
grant execute on function public.resume_chat_consent(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading the flag
-- ---------------------------------------------------------------------------
-- A dedicated reader rather than widening `get_pending_session_request`, which
-- returns NULL when nothing is pending — and after a decline nothing IS
-- pending, so the one state the client needs is the one that function cannot
-- express. Every caller of it checks `!= null`; making it return an object in
-- the null case would change all of them at once.
create or replace function public.get_chat_consent(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    return jsonb_build_object('declined', false);
  end if;

  select c.chat_consent_declined_at, c.member_id, c.provider_id
  into   v_row
  from   public.conversations c
  where  c.id = p_conversation_id
    and  (c.member_id = v_uid or c.provider_id = v_uid);

  if not found then
    return jsonb_build_object('declined', false);
  end if;

  return jsonb_build_object(
    -- Reported to BOTH parties. The provider needs it too: their composer
    -- should not imply a session is one reply away when the member has said no.
    'declined', v_row.chat_consent_declined_at is not null,
    'declined_at', v_row.chat_consent_declined_at
  );
end;
$$;

comment on function public.get_chat_consent(uuid) is
  'Whether the member has declined a paid chat session in this conversation. '
  'Readable by both participants. Separate from '
  'get_pending_session_request because that returns NULL when nothing is '
  'pending, which is exactly the state after a decline.';

revoke all on function public.get_chat_consent(uuid) from public;
grant execute on function public.get_chat_consent(uuid) to authenticated;
