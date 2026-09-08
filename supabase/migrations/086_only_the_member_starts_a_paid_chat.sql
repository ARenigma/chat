-- ===========================================================================
-- 086  Only the member can start a paid chat session
-- ===========================================================================
-- Amit, 2026-09-08: "All CTA are binding right -- no decline but still able to
-- msg/call bug? pls check this as this directly ties to usage and billing".
--
-- It does. This is a live billing defect, reproduced against the real schema
-- before it was fixed, and the two probes are now permanent regression tests in
-- supabase/tests/380_only_the_member_pays.sql.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- There are two ways a paid chat session can come into existence, and only one
-- of them asks the member who pays for it.
--
--   confirm_chat_session   (076/077) — member-only, guarded on
--                          `v_member_id <> auth.uid()`. This is the path the
--                          consent prompt drives, and it is correct.
--   accept_session_request (030)     — guarded on `recipient_id != auth.uid()`
--                          and nothing else.
--
-- 030 predates the member-consent model. It is symmetric by design: whoever a
-- request was sent TO may accept it. That was right when a request was a mutual
-- handshake. It stopped being right when 076 made the member the only party who
-- can agree to be charged, and 030 was never revisited.
--
-- The consequence, on the ordinary path with no modified client:
--
--   1. A member sends their first message. `send_message` creates
--      session_requests(pending, initiator = member, recipient = PROVIDER).
--   2. The provider gets ChatRingScreen — the full-screen accept/decline
--      surface — and taps Accept.
--   3. `accept_session_request` runs. The provider IS the recipient, so the
--      guard passes, and a paid_session is inserted with member_id = the
--      member. Billing starts.
--
-- The member confirmed nothing. Sending one message was treated as consent to
-- an open-ended metered session that the other party starts at a time of their
-- choosing.
--
-- AND IT SURVIVES A DECLINE, which is the specific thing Amit asked about.
-- 082 records `conversations.chat_consent_declined_at` and the client closes
-- the composer, but 082's own header says `send_message` is untouched: "with
-- the composer closed the member creates none". That is a statement about the
-- CLIENT. A build without 082 — 10109 and 10110, both in testers' hands — has
-- no `get_chat_consent` call at all, so its composer never closes. The member
-- declines, the client keeps sending, each send creates a fresh pending
-- request, and the provider's ring fires again and can be accepted. The member
-- is billed for a session they explicitly refused.
--
-- ---------------------------------------------------------------------------
-- THE RULE
-- ---------------------------------------------------------------------------
-- A paid CHAT session may only be created by the MEMBER. Nothing else changes:
--
--   * The provider accepting a member's chat request still marks the request
--     answered — `responded_at`, which is what the member's consent prompt
--     reads to say "they are here". It simply no longer creates the session.
--     `accept_session_request` returns NULL in that case rather than raising,
--     because the provider did nothing wrong: their Accept means "I am here",
--     and turning it into an error would break a working provider flow to fix
--     a member-side hole.
--   * The SP-initiated chat path (077) is untouched. There the recipient IS the
--     member, so the member accepting creates the session, which is the rule
--     rather than an exception to it.
--   * CALLS are untouched. For a call the request is answered by the callee and
--     the caller has already passed CallScreen's consent dialog before
--     `start_call` runs; the member's own act initiated it. Restricting call
--     acceptance to the member would break a provider answering a member's
--     call, which is the whole flow.
--
-- SECOND GUARD, belt and braces: a chat session is refused outright while
-- `chat_consent_declined_at` is set, whoever asks. The first guard already
-- covers the provider path; this one covers any future caller and makes the
-- decline mean something on the SERVER rather than in the client's composer.
-- The member changing their mind clears the flag — `resume_chat_consent` (082)
-- does it explicitly, and `confirm_chat_session` now does it implicitly,
-- because a member confirming IS them changing their mind and it would be
-- perverse to refuse the very act that withdraws the refusal.

-- ---------------------------------------------------------------------------
-- 1. accept_session_request: 030's body, with the member rule inserted
-- ---------------------------------------------------------------------------
-- Reproduced in full from 030. That is normally the 054 mistake, and it is
-- accepted here for the reason 082 gives about `decline_session_request`: the
-- function is sixty lines with no second responsibility to lose, and the whole
-- of it is visible in this file. It was diffed against 030 line by line.
create or replace function public.accept_session_request(p_request_id uuid)
returns uuid  -- paid_session.id, or NULL when the acceptor may not create one
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req         public.session_requests%rowtype;
  v_member_id   uuid;
  v_provider_id uuid;
  v_declined    timestamptz;
  v_snapshot    record;
  v_session_id  uuid;
begin
  select * into v_req
  from   public.session_requests
  where  id = p_request_id
  for update;

  if not found or v_req.status != 'pending' then
    raise exception 'Request not found or not pending' using errcode = 'P0001';
  end if;

  if v_req.recipient_id != auth.uid() then
    raise exception 'Not the recipient' using errcode = 'P0001';
  end if;

  if v_req.expires_at < now() then
    update public.session_requests
    set    status = 'expired'
    where  id     = p_request_id;
    raise exception 'Request has expired' using errcode = 'P0007';
  end if;

  select member_id, provider_id, chat_consent_declined_at
  into   v_member_id, v_provider_id, v_declined
  from   public.conversations
  where  id = v_req.conversation_id;

  /*
   * 086. THE MEMBER PAYS, SO THE MEMBER STARTS IT.
   *
   * On a member-initiated chat request the recipient is the PROVIDER, and
   * before this the provider's Accept created the paid session outright. The
   * request is still marked answered — that is the signal the member's consent
   * prompt reads to say "they are here" — and the session waits for
   * `confirm_chat_session`.
   *
   * Returns NULL rather than raising: the provider did nothing wrong, and
   * failing their Accept would break a working flow to close a member-side
   * hole. The client treats a null session id as "answered, not started".
   */
  if v_req.channel = 'chat' and auth.uid() <> v_member_id then
    update public.session_requests
    set    responded_at = coalesce(responded_at, now())
    where  id           = p_request_id;
    return null;
  end if;

  /*
   * 086. And a decline means no session, on the SERVER.
   *
   * 082 made the decline a fact about the conversation and left enforcement to
   * the client's composer. A build without 082 keeps sending, so each send
   * makes a fresh pending request that could be accepted. Refused here for any
   * caller; the member withdraws their own refusal through
   * `resume_chat_consent` or by confirming.
   */
  if v_req.channel = 'chat' and v_declined is not null then
    raise exception 'the member has declined a paid session in this conversation'
      using errcode = '42501';
  end if;

  -- Mark request accepted before creating the session row, so the partial
  -- unique index (one pending per conversation+channel) is freed immediately.
  update public.session_requests
  set    status       = 'accepted',
         responded_at = now()
  where  id           = p_request_id;

  -- Snapshot billing parameters from the currently active economics config.
  -- These columns are immutable once set; all future billing for this session
  -- uses these exact numbers even if the admin later changes the config.
  select * into v_snapshot
  from   public.get_session_billing_snapshot(v_req.channel::text);

  -- Status starts at pending_leases; claim_session_lease advances it to
  -- active once both participants have sent heartbeats. ADR-0020.
  insert into public.paid_sessions (
    conversation_id, request_id, channel,
    member_id, provider_id,
    rate_tokens_per_min, provider_share_percent,
    payout_hold_days, economics_config_version_id,
    accepted_at
  ) values (
    v_req.conversation_id, p_request_id, v_req.channel,
    v_member_id, v_provider_id,
    v_snapshot.rate_tokens_per_min, v_snapshot.provider_share_percent,
    v_snapshot.payout_hold_days,    v_snapshot.economics_version_id,
    now()
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

comment on function public.accept_session_request(uuid) is
  'Accept a pending session request. 086: for a CHAT request only the MEMBER '
  'may create the paid session — a provider accepting marks it answered and '
  'returns NULL, because the member is the one being charged. Calls are '
  'unchanged: the callee answers, and the caller already consented before '
  'start_call. Also refuses a chat session while '
  'conversations.chat_consent_declined_at is set, which makes 082''s decline '
  'binding on the server rather than in the client''s composer.';

-- ---------------------------------------------------------------------------
-- 2. The member confirming withdraws their own decline
-- ---------------------------------------------------------------------------
-- A trigger rather than an edit to `confirm_chat_session`, which is the 054
-- lesson applied instead of ignored: that function is long, lives in 077, and
-- has no second copy here to drift from the original. A paid chat session
-- existing IS the member having consented, so clearing the flag alongside the
-- insert is a fact about the row rather than a step in a procedure — which is
-- what a trigger is for.
--
-- AFTER INSERT, not BEFORE: if the insert is rolled back the consent is not
-- withdrawn either, and both statements are in one transaction.
create or replace function public.clear_chat_consent_on_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.channel = 'chat' then
    update public.conversations
    set    chat_consent_declined_at = null
    where  id = new.conversation_id
      and  chat_consent_declined_at is not null;
  end if;
  return null;
end;
$$;

comment on function public.clear_chat_consent_on_session() is
  '086: a paid chat session existing means the member consented, so it '
  'withdraws any earlier decline. Keeps a conversation from being both "in a '
  'paid session" and "declined", which would make the next end_session leave '
  'the member gated for a reason they already reversed.';

drop trigger if exists paid_sessions_clear_chat_consent on public.paid_sessions;
create trigger paid_sessions_clear_chat_consent
  after insert on public.paid_sessions
  for each row
  execute function public.clear_chat_consent_on_session();
