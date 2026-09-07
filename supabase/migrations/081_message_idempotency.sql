-- ===========================================================================
-- 081  A retried send cannot become a second message
-- ===========================================================================
-- Amit, 2026-09-08: port Telegram's reliability model, "strictly improve our
-- system towards telegram".
--
-- ---------------------------------------------------------------------------
-- The bug this closes, which is not hypothetical
-- ---------------------------------------------------------------------------
-- Production, 2026-08-27 20:43:28: two `messages` rows, same conversation, same
-- sender, body "launch test", created **0.005 seconds apart**. No human taps
-- send twice in five milliseconds — that is one action producing two inserts.
-- Nothing in the stack prevented it: `send_message` has no dedup key, no
-- ON CONFLICT, and the composer's `ready` guard (Composer.tsx:583) is computed
-- from the draft text, not from whether a send is already in flight.
--
-- Telegram's answer is `random_id`: a non-zero random long assigned before the
-- send, persisted in a `randoms_v2` table, echoed back by the server in
-- `updateMessageID`, and — the part that matters —
-- **reused unchanged when a send is retried** (SendMessagesHelper.java:1868).
-- The server collapses the duplicate. That is what makes retrying safe, and
-- retry is the feature we actually want; idempotency is its precondition.
--
-- ---------------------------------------------------------------------------
-- Why this is a wrapper and NOT an edit to send_message
-- ---------------------------------------------------------------------------
-- `public.send_message` is 295 lines. It creates session_requests, auto-accepts
-- a provider's first reply, attaches session_id, enforces the block graph and
-- the rate limit. Reproducing that body to add one column write is precisely
-- the move that made migration 054 silently drop four guards, and 063's header
-- exists to stop it being done again.
--
-- So the body is untouched. Idempotency is composed around it.
--
-- ---------------------------------------------------------------------------
-- Why an advisory lock and not just the unique index
-- ---------------------------------------------------------------------------
-- The index alone makes a duplicate *fail*, which is not the same as making a
-- retry *succeed quietly*. And a lookup-then-insert without a lock is a race:
-- two concurrent calls with the same nonce both miss the SELECT, both call
-- send_message, and the second one's nonce stamp hits the unique index — by
-- which point a second message row already exists. The index would report the
-- failure after the damage.
--
-- `pg_advisory_xact_lock` on (sender, nonce) serialises the pair for the
-- duration of the transaction, so the second caller waits, then finds the first
-- caller's row and returns it. The unique index stays as the backstop that
-- makes the invariant true even if a future caller forgets the lock.

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
-- NULLABLE, deliberately. Every build before this one calls `send_message`
-- directly and writes no nonce, and those clients must keep working — the whole
-- lesson of the 10109/079 skew is that the server must not assume the client
-- has caught up. NULL means "a client that does not participate in dedup", and
-- the partial index below excludes those rows so any number of them coexist.
alter table public.messages
  add column if not exists client_nonce uuid;

comment on column public.messages.client_nonce is
  'Client-generated idempotency key, Telegram''s random_id by another name. '
  'Set only by send_message_idempotent(). NULL for messages from clients that '
  'predate migration 081, which is why the unique index below is partial.';

-- Partial, so pre-081 clients (all NULL) are unaffected, and scoped to the
-- sender so two members cannot collide by generating the same uuid.
create unique index if not exists messages_sender_client_nonce_key
  on public.messages (sender_id, client_nonce)
  where client_nonce is not null;

-- ---------------------------------------------------------------------------
-- 2. The idempotent send
-- ---------------------------------------------------------------------------
-- Argument order mirrors `send_message` exactly, with the nonce FIRST so the
-- two can never be confused at a call site by positional accident.
create or replace function public.send_message_idempotent(
  p_client_nonce uuid,
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
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_existing public.messages;
  v_result   jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  /*
   * No nonce means an older client, or a caller that does not want dedup.
   * Delegate unchanged rather than inventing a nonce on its behalf: a
   * server-generated nonce would be a different value on every retry, so it
   * would look like protection while providing none.
   */
  if p_client_nonce is null then
    return public.send_message(
      p_conversation_id, p_body, p_reply_to_id, p_voice_path,
      p_voice_duration_ms, p_attachment_path, p_attachment_width,
      p_attachment_height, p_voice_peaks
    );
  end if;

  -- Serialise this (sender, nonce) pair. Two-argument hashtextextended is
  -- stable across sessions, unlike hashtext's platform-dependent variants.
  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_client_nonce::text, 0)
  );

  select * into v_existing
  from public.messages
  where sender_id = v_uid and client_nonce = p_client_nonce;

  if found then
    /*
     * The retry path. Reports success with the ORIGINAL row, so the client
     * settles its optimistic bubble against the message that already exists
     * instead of showing a failure for a send that in fact landed. `deduped`
     * is returned so the client can tell the two apart in telemetry without
     * changing its behaviour.
     *
     * `session_id` is read back off the row rather than recomputed: by now the
     * session may have ended, and the honest answer is the one the message was
     * actually filed under.
     */
    return jsonb_build_object(
      'success', true,
      'message_id', v_existing.id,
      'created_at', v_existing.created_at,
      'session_id', v_existing.session_id,
      'kind', 'message',
      'new_balance', null,
      'deduped', true
    );
  end if;

  v_result := public.send_message(
    p_conversation_id, p_body, p_reply_to_id, p_voice_path,
    p_voice_duration_ms, p_attachment_path, p_attachment_width,
    p_attachment_height, p_voice_peaks
  );

  /*
   * Stamp the nonce onto the row we just created, inside the same transaction
   * and while still holding the lock, so the next retry finds it. A failed send
   * is deliberately NOT stamped: it created no row, and the nonce must stay
   * free so a retry can genuinely try again rather than being told it already
   * succeeded.
   *
   * The `sender_id` predicate is redundant against the id but kept for the same
   * reason it is kept in setPreferredLanguages: an UPDATE with a weaker filter
   * is one edit away from being an UPDATE of somebody else's row.
   */
  if coalesce((v_result ->> 'success')::boolean, false) then
    update public.messages
    set    client_nonce = p_client_nonce
    where  id = (v_result ->> 'message_id')::uuid
      and  sender_id = v_uid;
  end if;

  return v_result;
end;
$$;

comment on function public.send_message_idempotent(uuid, uuid, text, uuid, text, integer, text, integer, integer, real[]) is
  'send_message with Telegram-style idempotency. A retry carrying the same '
  'client_nonce returns the original message with deduped=true instead of '
  'inserting a second row. Wraps send_message rather than modifying it: that '
  'function is 295 lines and reproducing it to add a column write is how 054 '
  'dropped four guards. Serialised by pg_advisory_xact_lock on (sender, nonce) '
  'because a lookup-then-insert without it is a race the unique index can only '
  'report after the fact.';

revoke all on function public.send_message_idempotent(uuid, uuid, text, uuid, text, integer, text, integer, integer, real[]) from public;
grant execute on function public.send_message_idempotent(uuid, uuid, text, uuid, text, integer, text, integer, integer, real[]) to authenticated;
