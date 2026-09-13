-- ===========================================================================
-- 103  A sender can edit and delete their own message
-- ===========================================================================
-- Two facts this schema could not previously record: "this was changed after it
-- was sent", and "the person who wrote this took it back". Both exist in every
-- messenger a member of this product has used, and the absence of the second one
-- is the worse half — without it the only way to unsay something is to ask the
-- other person to ignore it.
--
-- ---------------------------------------------------------------------------
-- THE COLUMN THIS DELIBERATELY DOES NOT REUSE
-- ---------------------------------------------------------------------------
-- `messages.hidden_at` already makes a row vanish, and reaching for it here
-- would be wrong in a way that is invisible until somebody is owed an answer.
-- 045 defines it as the SESSION PURGE: a paid session ended, so every row in it
-- stops being visible to BOTH participants at once, is retained server-side for
-- payment and safety disputes, and is destroyed 30 days later by
-- purge_expired_hidden_content(). Nobody chose it and nothing is left behind.
--
-- A delete is the opposite on every axis. One participant chose it, at a moment
-- of their choosing, about one row; the other participant must still be able to
-- see that it happened, because a message that silently evaporates from someone
-- else's scrollback is how a person is made to doubt what they read. WhatsApp
-- and Telegram both leave a tombstone for exactly this reason.
--
-- So: a second column, `deleted_at`, and the two compose rather than collide —
-- a deleted message is still hidden when its session ends and still purged 30
-- days after that. hidden_at answers "is this still in the session"; deleted_at
-- answers "did its author take it back".
--
-- ---------------------------------------------------------------------------
-- IS THERE A TIME LIMIT ON EDITING? YES — FIFTEEN MINUTES. ON DELETING? NO.
-- ---------------------------------------------------------------------------
-- WhatsApp allows 15 minutes, Telegram 48 hours. This takes WhatsApp's number,
-- and the reason is specific to this product rather than a preference between
-- two vendors:
--
--   * A transcript here is evidence. `reports.evidence_body` (005) snapshots the
--     text at REPORT time, so anything already reported is safe — but an edit
--     window measured in days is a window in which someone can answer an
--     accusation by rewriting what they actually said, before the other person
--     has thought to report it. Fifteen minutes bounds that to roughly the span
--     of the exchange itself.
--   * The window is also mostly moot past that: chat here is an ephemeral paid
--     session, and end_session hides the whole transcript. A 48-hour edit right
--     would, in practice, apply to messages neither person can see any more.
--   * Fifteen minutes is what "fix a typo" actually needs, which is what an edit
--     is for.
--
-- Deleting carries NO window, only the requirement that the message is still
-- visible (`hidden_at is null`). Taking back your own words is not a privilege
-- that should expire, and once the session purge has hidden the row there is
-- nothing left to take back.
--
-- An edit is always disclosed: `edited_at` is set, the client renders "Edited"
-- beside the timestamp, and the column is not client-writable, so a silent edit
-- is not reachable from a device.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS TWO SECURITY DEFINER RPCs AND NOT AN RLS POLICY
-- ---------------------------------------------------------------------------
-- "Own messages only" is enforced server-side, in the `sender_id = auth.uid()`
-- predicate of the two functions below — not in the client, which only decides
-- which buttons to draw. It is NOT enforced by an RLS policy, and that is a
-- consequence of two decisions already made here rather than a shortcut:
--
--   1. There is no client write path to widen. 003: "No direct INSERT policy on
--      messages: sending goes through send_message." The only UPDATE policy is
--      "Recipient marks messages read", whose USING clause is
--      `sender_id <> auth.uid()` — a client literally cannot UPDATE its own
--      message row at all. Every mutation in this schema is a definer RPC.
--   2. Even with a policy, the write would still be refused. 004's
--      `guard_message_columns` raises 42501 on any UPDATE by `authenticated` or
--      `anon` that changes `body`, and 014's `guard_message_reply_and_voice`
--      does the same for the voice and attachment columns. A policy cannot
--      re-grant what a BEFORE trigger forbids, and those triggers exist because
--      a recipient could once rewrite the message sent to them.
--
-- So the row-level authority is the function, and the guards stay exactly as
-- strict as they are — section 4 adds a THIRD guard (never an edit to 004's, per
-- 045's rule that additive guards compose in name order) so the two new columns
-- are as client-unwritable as origin/hidden_at/purge_after already are. Suite
-- 460 asserts the negative side of all of this: a non-sender gets NOT_FOUND, and
-- a direct UPDATE from an authenticated session is refused.

-- ---------------------------------------------------------------------------
-- 1. The two columns
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.messages.edited_at is
  'When the sender last edited this message, within EDIT_WINDOW of sending it. '
  'NULL means never edited. Rendered by the client as "Edited" beside the '
  'timestamp: an edit is always disclosed to the other participant. Written '
  'only by edit_message(); not client-writable. Migration 103.';

comment on column public.messages.deleted_at is
  'When the SENDER deleted this message. The row stays and both participants '
  'keep seeing a tombstone — deliberately NOT hidden_at, which is the session '
  'purge and removes a row from both sides with no trace. The payload columns '
  'are nulled at the same time, so the text is gone and any storage object '
  'stops being readable. Written only by delete_message(). Migration 103.';

-- ---------------------------------------------------------------------------
-- 2. The payload constraint, restated whole with a tombstone branch
-- ---------------------------------------------------------------------------
-- Restated rather than amended, exactly as 014, 023 and 025 each did: the whole
-- invariant has to read in one place, because two half-true statements about the
-- same columns is how the next person gets it wrong.
--
-- A delete nulls every payload column, and a row with no body, no voice and no
-- attachment satisfies NONE of the three existing branches — so without this the
-- delete would fail on its own CHECK. The fourth branch is the tombstone, and
-- the three live branches gain `deleted_at is null` so the invariant is now
-- symmetric: deleted means empty, and not-deleted means exactly one payload.
-- There is no half-deleted row.
alter table public.messages
  drop constraint if exists message_carries_one_payload;

alter table public.messages
  add constraint message_carries_one_payload check (
    (
      deleted_at is not null
      and body is null
      and voice_path is null
      and voice_duration_ms is null
      and voice_peaks is null
      and attachment_path is null
      and attachment_type is null
      and attachment_width is null
      and attachment_height is null
    )
    or (
      deleted_at is null
      and body is not null
      and length(btrim(body)) > 0
      and length(body) <= 4000
      and voice_path is null
      and voice_duration_ms is null
      and attachment_path is null
      and voice_peaks is null
    )
    or (
      deleted_at is null
      and body is null
      and voice_path is not null
      and voice_duration_ms between 1000 and 180000
      and attachment_path is null
      and public.voice_peaks_ok(voice_peaks)
    )
    or (
      deleted_at is null
      and body is null
      and voice_path is null
      and voice_duration_ms is null
      and attachment_path is not null
      and attachment_type = 'image'
      and attachment_width > 0
      and attachment_height > 0
      and voice_peaks is null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The edit window, named once
-- ---------------------------------------------------------------------------
-- An IMMUTABLE function rather than a literal repeated in the RPC and in the
-- client: the client has to hide the Edit action once the window has closed (a
-- button that is going to be refused is a lie), and the two numbers agreeing by
-- coincidence is how they drift. Suite 460 reads this function, and
-- `__tests__/chatSurface.test.ts` reads BOTH this line and `EDIT_WINDOW_MS` in
-- `src/api/chat.ts` in one assertion, so a change to either alone fails.
create or replace function public.message_edit_window()
returns interval
language sql
immutable
as $$
  select interval '15 minutes'
$$;

comment on function public.message_edit_window() is
  'How long after sending a message may still be edited. WhatsApp''s 15 '
  'minutes; see 103''s header for why not Telegram''s 48 hours. The single '
  'source of this number for the server, the test suite and the client.';

revoke all on function public.message_edit_window() from public;
grant execute on function public.message_edit_window() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Guard: edited_at and deleted_at are not client-writable
-- ---------------------------------------------------------------------------
-- A NEW guard trigger, never an edit to guard_message_columns (004) — 045's
-- rule, and the reason is that additive guards compose in name order and cannot
-- silently regress one another. `current_user` is the function owner inside the
-- two definer RPCs below, so this does not block them; it blocks a device.
create or replace function public.guard_message_edit_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.edited_at is distinct from old.edited_at
      or new.deleted_at is distinct from old.deleted_at then
      raise exception
        'messages.edited_at/deleted_at are written only by edit_message/delete_message'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_message_edit_columns on public.messages;
create trigger guard_message_edit_columns
  before update on public.messages
  for each row execute function public.guard_message_edit_columns();

-- ---------------------------------------------------------------------------
-- 5. edit_message
-- ---------------------------------------------------------------------------
-- Text only, because only a text message has something to edit: re-recording a
-- voice note or re-picking a photo is a new send, not an edit, and every
-- messenger treats it that way.
--
-- Every refusal that concerns a row the caller may not touch answers NOT_FOUND
-- — the same answer as an id that does not exist — so the function never
-- discloses that somebody else's message is there. That is the rule 045's
-- toggle_reaction already follows.
create or replace function public.edit_message(
  p_message_id uuid,
  p_body       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_msg       public.messages;
  v_body      text := nullif(btrim(p_body), '');
  v_suspended timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if v_body is null or length(v_body) > 4000 then
    return jsonb_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  -- A suspended account may not put new words in front of somebody. It MAY
  -- still delete (see delete_message): taking your own message back is not a
  -- privilege, and withholding it from a suspended user punishes the person
  -- they were talking to as well.
  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return jsonb_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  -- `sender_id = v_uid` IS the own-messages-only rule, and `for update` holds
  -- the row so two devices editing at once serialise instead of interleaving.
  select * into v_msg
  from   public.messages
  where  id        = p_message_id
    and  sender_id = v_uid
    and  hidden_at is null
  for update;

  if not found or v_msg.deleted_at is not null then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if v_msg.body is null then
    -- A voice note or a photo. Nothing textual to change.
    return jsonb_build_object('success', false, 'error', 'NOT_EDITABLE');
  end if;

  -- An automated opener (045) was written by the server FROM AN APPROVED
  -- TEMPLATE and merely attributed to the provider, who supplied neither the
  -- body nor the sender. Letting them rewrite one would leave
  -- `origin = 'automated_opener'` asserting something that had stopped being
  -- true, and origin is what insert_next_opener reads to decide whether a human
  -- has spoken yet.
  if v_msg.origin <> 'live' then
    return jsonb_build_object('success', false, 'error', 'NOT_EDITABLE');
  end if;

  if now() - v_msg.created_at > public.message_edit_window() then
    return jsonb_build_object('success', false, 'error', 'EDIT_WINDOW_CLOSED');
  end if;

  if v_body = v_msg.body then
    -- Nothing changed. Reporting success without stamping edited_at keeps the
    -- client's retry idempotent and stops an unchanged "edit" from labelling a
    -- message as edited.
    return jsonb_build_object(
      'success',   true,
      'message_id', v_msg.id,
      'edited_at',  v_msg.edited_at
    );
  end if;

  update public.messages
  set    body      = v_body,
         edited_at = now()
  where  id        = p_message_id
    -- Redundant against the id and kept for the reason 081 keeps its own: an
    -- UPDATE with a weaker filter is one edit away from being somebody else's.
    and  sender_id = v_uid;

  return jsonb_build_object(
    'success',    true,
    'message_id', p_message_id,
    'edited_at',  (select edited_at from public.messages where id = p_message_id)
  );
end;
$$;

comment on function public.edit_message(uuid, text) is
  'Edit your own text message within message_edit_window() of sending it, '
  'stamping edited_at so the other participant is told. Own-messages-only is '
  'the sender_id = auth.uid() predicate: RLS cannot carry it because a client '
  'has no UPDATE policy for its own rows and 004''s guard refuses a body write '
  'from a device outright. Migration 103.';

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. delete_message
-- ---------------------------------------------------------------------------
-- WHAT HAPPENS TO A VOICE NOTE'S OR A PHOTO'S STORAGE OBJECT
-- ---------------------------------------------------------------------------
-- It is UNREFERENCED here and DELETED by the nightly sweeper. It is not deleted
-- inline, and that is a considered stop rather than an omission:
--
--   * Unreferencing is already the whole of the read revocation. 045 §11 made
--     the storage read policies require an associated, VISIBLE message whose
--     voice_path / attachment_path equals the object. The moment this statement
--     nulls those columns the policy stops matching, so the object cannot be
--     read and no new signed URL can be minted — including by the recipient,
--     who is the person the delete is for.
--   * purge_orphaned_voice_notes / purge_orphaned_attachments (094) then delete
--     it on the next nightly run: their predicate is exactly
--     `not exists (select 1 from public.messages m where m.voice_path = o.name)`
--     plus an age fence of 24 hours that spares in-flight uploads.
--   * Deleting it here would need Supabase's direct-delete guard lifted inside a
--     function any authenticated user can call. 094 documents that guard:
--     storage's own `protect_delete()` trigger raises 42501 unless
--     `storage.allow_delete_query` is set to 'true' first. Handing that lever to
--     a client-callable RPC to save a few hours of latency on an object nobody
--     can read is the wrong trade, and `storage.delete_objects` — the tidy API
--     093 reached for instead — does not exist.
--
-- Reactions on the message go with it. A tally attached to text that is no
-- longer there is a reaction to nothing, and WhatsApp drops them too.
--
-- Replies that QUOTE this message keep pointing at it: `reply_to_id` is
-- `on delete set null` and nothing is being deleted, so the reply survives with
-- its quote block resolving to the tombstone. The client renders that quote as
-- "Message deleted" rather than as an empty line.
--
-- Report evidence is untouched. `reports.evidence_body` / `evidence_voice_path`
-- (005, 011) are copies taken at REPORT time, in a different table, and the
-- orphan sweeper explicitly spares an object a report still references. Deleting
-- a message you already sent cannot destroy a report about it.
create or replace function public.delete_message(
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg public.messages;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_msg
  from   public.messages
  where  id        = p_message_id
    and  sender_id = v_uid
    and  hidden_at is null
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if v_msg.deleted_at is not null then
    -- Already a tombstone. Idempotent, so the client's retry after a dropped
    -- response does not turn into an error the member has to interpret.
    return jsonb_build_object(
      'success',    true,
      'message_id', v_msg.id,
      'deleted_at', v_msg.deleted_at
    );
  end if;

  -- An automated opener is not the provider's own words (see edit_message), so
  -- it is not theirs to withdraw either.
  if v_msg.origin <> 'live' then
    return jsonb_build_object('success', false, 'error', 'NOT_DELETABLE');
  end if;

  update public.messages
  set    deleted_at        = now(),
         -- The tombstone carries nothing. `edited_at` is cleared with the rest:
         -- "edited, then deleted" tells the other person about a version of the
         -- text that no longer exists anywhere they can reach.
         edited_at         = null,
         body              = null,
         voice_path        = null,
         voice_duration_ms = null,
         voice_peaks       = null,
         attachment_path   = null,
         attachment_type   = null,
         attachment_width  = null,
         attachment_height = null
  where  id        = p_message_id
    and  sender_id = v_uid;

  delete from public.message_reactions where message_id = p_message_id;

  /*
   * conversation_thread_meta is deliberately NOT touched.
   *
   * "Deleting the last message must not corrupt the inbox preview" is the reason
   * this is a tombstone rather than a DELETE. The view (037) carries no message
   * content at all — only `last_session_at`, `last_preview_kind` and the two
   * unread counters — and all three stay true of a thread whose last row is a
   * tombstone: something was sent at that time, it was a text/voice/image event,
   * and it is still an unread item for the peer (who can see that it happened).
   * A hard DELETE would strand every one of them, pointing the inbox at activity
   * with no row behind it and leaving an unread badge the peer cannot clear by
   * reading anything.
   *
   * `last_preview_kind` keeps its original value rather than gaining a
   * 'deleted' member. That would be a new enum value three list renderers pick
   * an icon from, and it would disclose nothing the transcript does not already
   * say out loud — the tombstone is right there in the thread.
   */

  return jsonb_build_object(
    'success',    true,
    'message_id', p_message_id,
    'deleted_at', (select deleted_at from public.messages where id = p_message_id)
  );
end;
$$;

comment on function public.delete_message(uuid) is
  'Delete your own message: sets deleted_at, nulls every payload column and '
  'drops its reactions, leaving a tombstone both participants can see. NOT '
  'hidden_at, which is the session purge and a different fact with a different '
  'audience. Media objects are unreferenced here — which revokes the storage '
  'read policy immediately — and swept by purge_orphaned_* on the nightly '
  'cron. No time limit; see 103''s header. Migration 103.';

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime needs nothing added
-- ---------------------------------------------------------------------------
-- `messages` is already in the supabase_realtime publication and already carries
-- `replica identity full` (003), so an UPDATE ships the whole new row to both
-- devices and Realtime applies the SELECT policy to it exactly as it does to an
-- INSERT. An edit and a delete therefore propagate over the socket that is
-- already open, with no new table, channel or trigger — the client side of that
-- is a handler for the UPDATE event it was already receiving and discarding.

-- ===========================================================================
-- 8. The provider sees who they are talking to
-- ===========================================================================
-- A SECOND, UNRELATED FIX IN THIS FILE, and the reason is bookkeeping rather
-- than design: one migration number was allocated for this batch of work, and
-- inventing a second would collide with a number handed to somebody else. The
-- two changes share no object.
--
-- ---------------------------------------------------------------------------
-- The gap
-- ---------------------------------------------------------------------------
-- The identity is one-way. A member sees the provider's chosen name and their
-- photo — `conversation_peers` publishes `peer.display_name` and
-- `peer.avatar_url` for a provider peer, and ChatScreen, ChatsListScreen and
-- HomeScreen all render both. A provider sees `member_handle(peer.id)`, which
-- is the string 'Member ' plus four hex characters, and a NULL avatar. So the
-- person being paid to hold a difficult conversation addresses 'Member 4f2a'
-- against a blank circle.
--
-- ---------------------------------------------------------------------------
-- 012 made that choice on purpose, and the fact underneath it has changed
-- ---------------------------------------------------------------------------
-- This reverses a stated decision, so it states why rather than quietly
-- widening a column list. 012's comment on this view reads: "A member peer
-- resolves to a handle: their display_name, birth date, gender and headline are
-- unreachable from here by construction."
--
-- That was correct when it was written. In 012 a member had no name of their
-- own: `profiles.display_name` on a member row could only have arrived from a
-- PROVIDER APPLICATION — a legal-ish name typed for review — and publishing it
-- to the other side of a chat would have published something the member never
-- offered anyone. The handle was the only honest answer.
--
-- Migration 040 changed that fact. First-run setup now asks every member for a
-- username (`claim_member_profile` → `check_display_name`: 3–24 characters,
-- `[a-zA-Z0-9_]` only, case-insensitively unique) and for one of twelve bundled
-- clay avatars. Neither is a legal name and neither is a face; both are picked,
-- deliberately, on a screen whose own copy is "Shown to people you chat with"
-- (SettingsSheet.tsx, the avatar sheet's body for a member). The app has been
-- telling members their avatar is shown to the people they chat with while the
-- database hid it.
--
-- ---------------------------------------------------------------------------
-- What is exposed, and what stays exactly as unreachable as it was
-- ---------------------------------------------------------------------------
-- EXACTLY TWO fields move, both member-chosen and member-facing by
-- construction: `display_name` and `avatar_url`. The explicit column list is
-- still the privacy boundary (004's rule), and everything else stays off it:
-- phone, email, date_of_birth, age_bracket, gender, headline, token_balance,
-- preferred_languages, suspended_until. Nothing a member gave us for identity,
-- billing or safety is reachable from this view, then or now.
--
-- The audience is unchanged too, and it is the narrow one: this view is
-- SECURITY DEFINER with `where c.member_id = auth.uid() or c.provider_id =
-- auth.uid()` as its ENTIRE access control, so a provider learns the name and
-- avatar of a member they are already in a conversation with, and of nobody
-- else. There is no member directory and this does not create one.
--
-- The two existing pgTAP assertions on this (090:460, 110:261) both keep
-- passing and keep meaning what they say: their fixtures create a member whose
-- `profiles.display_name` is NULL — the name in them was typed into
-- `provider_applications` — so those rows still resolve to 'Member bbbb', and
-- "a name the member typed somewhere else" stays unreachable. Suite 460 asserts
-- the new half: a member who HAS completed first-run setup is seen by their
-- chosen username and clay avatar.
--
-- `create or replace`, not drop-and-recreate: the column names, types and order
-- are identical and only two expressions change, which is what replace allows —
-- and `conversation_summaries` selects from this view, so dropping it would take
-- the inbox with it (009's lesson, recorded in 011's section 10).

create or replace view public.conversation_peers
with (security_invoker = false) as
  select
    c.id as conversation_id,
    peer.id as peer_id,
    -- The coalesce replaces `case when peer.role = 'provider' then ... else
    -- member_handle(...) end`. A provider always has a name (004's CHECK), and a
    -- member has one exactly when they finished first-run setup; anyone who has
    -- not falls back to the handle, which is the same shape `pending_pushes`
    -- has always used for a sender (011).
    coalesce(peer.display_name, public.member_handle(peer.id))
      as peer_display_name,
    case when peer.role = 'provider' then peer.is_available else false end
      as peer_available,
    case when peer.presence_visible then peer.last_active_at end
      as peer_last_active_at,
    (peer.role = 'provider') as peer_is_provider,
    peer.presence as peer_presence,
    -- No longer gated on role. A member's avatar_url is a `clay:<seed>` pick
    -- from the twelve bundled DiceBear avatars (040, and the settings sheet),
    -- i.e. chosen art rather than a photograph of anyone.
    peer.avatar_url as peer_avatar_url
  from public.conversations c
  join public.profiles peer
    on peer.id = case
      when c.member_id = auth.uid() then c.provider_id else c.member_id
    end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_peers is
  'The peer of every thread the caller is in. Definer, so the auth.uid() '
  'predicate in the WHERE is the access control and not a convenience. Both '
  'roles now publish the two fields a person CHOSE as their identity — the '
  'username from first-run setup and the clay avatar — because a provider '
  'talking to someone should know who they are talking to (migration 103). '
  'A member who has not completed setup still resolves to member_handle(). '
  'Everything else about a member stays unreachable here by construction: '
  'phone, email, date of birth, age band, gender, headline and balance are not '
  'on this column list, and the column list is the privacy boundary.';
