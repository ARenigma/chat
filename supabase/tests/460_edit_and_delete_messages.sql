-- pgTAP for migration 103: a sender edits and deletes their own message, and a
-- provider can see who they are talking to.
--
-- Two features share this file because they share a migration number; they are
-- asserted in two clearly separated halves.
--
-- WHAT THIS IS ACTUALLY GUARDING, rather than "the happy path works":
--
--   * That a delete is a TOMBSTONE and not the session purge. `hidden_at` makes
--     a row vanish from both sides and is the wrong tool here; assertion 19
--     fails the day somebody "simplifies" delete_message into setting it, and
--     assertion 20 fails the day the tombstone stops being visible to the
--     person who was talking to you.
--   * That own-messages-only lives on the SERVER. The client decides which
--     buttons to draw; assertions 8 and 26 are what happens when a device
--     ignores that, and 13–15 are what happens when it goes round the RPC
--     entirely to the table.
--   * That a deleted voice note's storage object stops being referenced, which
--     is what revokes the read policy (045 §11) and what arms the nightly
--     sweeper (094). Assertion 24 asserts the sweeper's own predicate.
--   * That the inbox survives deleting the last message. The preview is
--     metadata-only by design (ADR-0020) and a tombstone keeps every field of
--     it true; assertion 28 is the regression a hard DELETE would cause.
--   * That widening `conversation_peers` moved EXACTLY two fields. 34–36 are
--     the boundary: the column list is the privacy boundary (004), so the
--     fields a member never offered must stay off it.

begin;
select plan(37);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- Two threads. The first is a completed member talking to a provider; the
-- second is a member who never finished first-run setup, which is the fallback
-- case in part F.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000006a1', 'member460@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000006a2', 'provider460@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000006a3', 'newcomer460@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000006a4', 'outsider460@test.local');

-- The member who completed setup: claim_member_profile writes exactly these two
-- columns plus the completion stamp, so this is that RPC's output by hand.
update public.profiles
set    display_name         = 'quiet_lark',
       avatar_url           = 'clay:bloom',
       profile_completed_at = now()
where  id = 'aaaaaaaa-0000-0000-0000-0000000006a1';

-- `languages` and `date_of_birth` are not decoration here: a verified provider
-- row must declare at least one language and be an adult, so a thinner fixture
-- fails on write rather than at assertion time.
update public.profiles
set    role                 = 'provider',
       display_name         = 'Ada',
       avatar_url           = 'https://example.test/ada.jpg',
       languages            = array['en'],
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id = 'aaaaaaaa-0000-0000-0000-0000000006a2';

insert into public.conversations (id, member_id, provider_id) values
  ('cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a2'),
  ('cccccccc-0000-0000-0000-0000000006a2',
   'aaaaaaaa-0000-0000-0000-0000000006a3',
   'aaaaaaaa-0000-0000-0000-0000000006a2');

-- Four rows from the member: one to edit, one to age out of the window, one
-- voice note, one to delete. Plus an automated opener from the provider.
insert into public.messages
  (id, conversation_id, sender_id, body, created_at)
values
  ('dddddddd-0000-0000-0000-0000000006a1',
   'cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a1', 'i thnik so', now()),
  ('dddddddd-0000-0000-0000-0000000006a2',
   'cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a1', 'said an hour ago',
   now() - interval '1 hour'),
  ('dddddddd-0000-0000-0000-0000000006a4',
   'cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a1', 'take this back', now());

insert into public.messages
  (id, conversation_id, sender_id, body, voice_path, voice_duration_ms)
values
  ('dddddddd-0000-0000-0000-0000000006a3',
   'cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a1',
   null,
   'cccccccc-0000-0000-0000-0000000006a1/eeeeeeee-0000-0000-0000-0000000006a1.m4a',
   4000);

insert into public.messages
  (id, conversation_id, sender_id, body, origin)
values
  ('dddddddd-0000-0000-0000-0000000006a5',
   'cccccccc-0000-0000-0000-0000000006a1',
   'aaaaaaaa-0000-0000-0000-0000000006a2', 'Hey — glad you''re here.',
   'automated_opener');

-- A reaction on the message that is about to be deleted, so assertion 19 has
-- something to lose.
insert into public.message_reactions (message_id, user_id, emoji) values
  ('dddddddd-0000-0000-0000-0000000006a4',
   'aaaaaaaa-0000-0000-0000-0000000006a2', '❤️');

-- The inbox row the delete must not corrupt.
insert into public.conversation_thread_meta
  (conversation_id, last_session_at, last_preview_kind,
   unread_count_member, unread_count_provider)
values
  ('cccccccc-0000-0000-0000-0000000006a1', now(), 'text', 0, 3);

-- ===========================================================================
-- A. The schema records two new facts, and neither is hidden_at
-- ===========================================================================
select has_column('public', 'messages', 'edited_at',
  'a message records when it was edited');
select has_column('public', 'messages', 'deleted_at',
  'and, separately from hidden_at, when its sender took it back');
select is(
  public.message_edit_window(),
  interval '15 minutes',
  'the edit window is WhatsApp''s fifteen minutes, named once for server and client'
);

-- ===========================================================================
-- B. Editing
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';

select is(
  (public.edit_message('dddddddd-0000-0000-0000-0000000006a1', 'i think so')
    ->> 'success')::boolean,
  true,
  'the sender can fix a typo in their own message'
);

reset role;
select is(
  (select format('%s/%s',
                 body,
                 case when edited_at is null then 'unstamped' else 'stamped' end)
   from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a1'),
  'i think so/stamped',
  'the body changes and edited_at is set, so the edit is disclosed rather than silent'
);

-- A retry of the same edit (a dropped response, a double tap) must not relabel
-- an unchanged message.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
select lives_ok(
  $$ select public.edit_message('dddddddd-0000-0000-0000-0000000006a2', 'said an hour ago') $$,
  'an edit that changes nothing is accepted rather than erroring'
);
reset role;
select is(
  (select edited_at from public.messages
   where id = 'dddddddd-0000-0000-0000-0000000006a2'),
  null,
  '...and does not stamp edited_at, so a no-op retry cannot label a message edited'
);

-- The recipient. This is the assertion that own-messages-only is server-side:
-- the provider holds the id and is a participant, and still cannot touch it.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';
select is(
  public.edit_message('dddddddd-0000-0000-0000-0000000006a1', 'words I never said')
    ->> 'error',
  'NOT_FOUND',
  'the recipient cannot edit the message sent to them, and is told nothing about it'
);
reset role;
select is(
  (select body from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a1'),
  'i think so',
  '...and the transcript still says what its author said'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
select is(
  public.edit_message('dddddddd-0000-0000-0000-0000000006a2', 'said an hour ago, revised')
    ->> 'error',
  'EDIT_WINDOW_CLOSED',
  'an hour later the window has closed, so a transcript cannot be rewritten after the fact'
);
select is(
  public.edit_message('dddddddd-0000-0000-0000-0000000006a3', 'a caption')
    ->> 'error',
  'NOT_EDITABLE',
  'a voice note has no text to edit — re-recording is a new send'
);
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';
select is(
  public.edit_message('dddddddd-0000-0000-0000-0000000006a5', 'something else entirely')
    ->> 'error',
  'NOT_EDITABLE',
  'and a provider cannot rewrite an automated opener the server wrote in their name'
);
reset role;

-- ===========================================================================
-- C. Going round the RPC, straight at the table
-- ===========================================================================
-- The recipient HAS an UPDATE policy (it is how read receipts are written), so
-- RLS admits the row and the guards are what stop the write. 004's guard for
-- the body, 103's for the two new columns.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';

select throws_ok(
  $$ update public.messages set body = 'rewritten'
     where id = 'dddddddd-0000-0000-0000-0000000006a1' $$,
  '42501',
  'only messages.read_at is client-writable',
  'a recipient still cannot rewrite the body directly — 004''s guard is untouched'
);

select throws_ok(
  $$ update public.messages set deleted_at = now()
     where id = 'dddddddd-0000-0000-0000-0000000006a1' $$,
  '42501',
  'messages.edited_at/deleted_at are written only by edit_message/delete_message',
  'nor delete somebody else''s message by writing the column itself'
);
reset role;

-- The sender's own direct UPDATE is not refused, it is INVISIBLE: the only
-- UPDATE policy on messages is `sender_id <> auth.uid()`, so their own row is
-- not in the updatable set at all. Nothing to widen, which is why the RPC
-- carries the ownership rule.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
update public.messages set read_at = now()
where id = 'dddddddd-0000-0000-0000-0000000006a1';
reset role;
select is(
  (select read_at from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a1'),
  null,
  'and a sender''s own UPDATE reaches no row at all: RLS has no policy that admits it'
);

-- ===========================================================================
-- D. Deleting
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
select is(
  (public.delete_message('dddddddd-0000-0000-0000-0000000006a4') ->> 'success')::boolean,
  true,
  'the sender can take their own message back'
);
reset role;

select isnt(
  (select deleted_at from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a4'),
  null,
  'deleted_at is stamped'
);
select is(
  (select body from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a4'),
  null,
  'the text is gone from the row, not merely flagged'
);
-- The load-bearing one. A delete and a session purge are different facts with
-- different audiences; collapsing them is the mistake this file exists to catch.
select is(
  (select hidden_at from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a4'),
  null,
  'hidden_at is untouched: a delete is not the session purge'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';
select is(
  (select count(*)::int from public.messages
   where id = 'dddddddd-0000-0000-0000-0000000006a4'),
  1,
  'the other person still sees the row — a tombstone, not a hole in their scrollback'
);
reset role;

select is(
  (select count(*)::int from public.message_reactions
   where message_id = 'dddddddd-0000-0000-0000-0000000006a4'),
  0,
  'its reactions go with it, since a reaction to nothing is not a reaction'
);

-- A voice note: the object is unreferenced, which is what revokes the read.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
select is(
  (public.delete_message('dddddddd-0000-0000-0000-0000000006a3') ->> 'success')::boolean,
  true,
  'a voice note deletes too'
);
reset role;
select is(
  (select voice_path from public.messages where id = 'dddddddd-0000-0000-0000-0000000006a3'),
  null,
  'voice_path is nulled, so 045''s storage read policy stops matching the object'
);
-- Exactly the predicate purge_orphaned_voice_notes (094) runs on the nightly
-- cron. Asserting the sweeper's own condition rather than the object, because
-- the harness has no storage schema.
select ok(
  not exists (
    select 1 from public.messages m
    where m.voice_path =
      'cccccccc-0000-0000-0000-0000000006a1/eeeeeeee-0000-0000-0000-0000000006a1.m4a'
  ),
  '...and nothing references it any more, which is what arms the nightly sweeper'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}';
select is(
  (public.delete_message('dddddddd-0000-0000-0000-0000000006a4') ->> 'success')::boolean,
  true,
  'deleting twice is the same as deleting once, so a retry is not an error to read'
);
reset role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';
select is(
  public.delete_message('dddddddd-0000-0000-0000-0000000006a1') ->> 'error',
  'NOT_FOUND',
  'and nobody can delete a message they did not send'
);
select is(
  public.delete_message('dddddddd-0000-0000-0000-0000000006a5') ->> 'error',
  'NOT_DELETABLE',
  'including an automated opener, which is not the provider''s to withdraw'
);

-- The inbox, from the provider's side, after the last message was deleted. The
-- projection is metadata-only, and a tombstone keeps every field of it true.
select is(
  (select format('%s/%s',
                 last_preview_kind,
                 unread_count_provider)
   from public.conversation_summaries
   where conversation_id = 'cccccccc-0000-0000-0000-0000000006a1'),
  'text/3',
  'the inbox row survives the delete intact — a hard DELETE would strand both fields'
);
reset role;

-- ===========================================================================
-- E. The payload constraint admits no half-deleted row
-- ===========================================================================
select throws_ok(
  $$ update public.messages set deleted_at = now()
     where id = 'dddddddd-0000-0000-0000-0000000006a1' $$,
  '23514',
  null,
  'a row cannot be deleted and still carry its text'
);
select throws_ok(
  $$ update public.messages set body = null
     where id = 'dddddddd-0000-0000-0000-0000000006a1' $$,
  '23514',
  null,
  'and a live row cannot be emptied without being deleted'
);

-- ===========================================================================
-- F. The provider sees who they are talking to
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a2","role":"authenticated"}';

select is(
  (select peer_display_name from public.conversation_peers
   where conversation_id = 'cccccccc-0000-0000-0000-0000000006a1'),
  'quiet_lark',
  'a provider sees the username the member chose in first-run setup'
);
select is(
  (select peer_avatar_url from public.conversation_peers
   where conversation_id = 'cccccccc-0000-0000-0000-0000000006a1'),
  'clay:bloom',
  '...and the clay avatar the settings sheet already promised is shown to people they chat with'
);
select is(
  (select peer_display_name from public.conversation_peers
   where conversation_id = 'cccccccc-0000-0000-0000-0000000006a2'),
  'Member aaaa',
  'a member who never finished setup still resolves to the handle, having chosen no name'
);

-- 004's rule: the column list IS the privacy boundary. Exactly two fields moved.
select hasnt_column('public', 'conversation_peers', 'date_of_birth',
  'and nothing else about a member is reachable here: no birth date');
select hasnt_column('public', 'conversation_peers', 'phone_e164',
  'no phone number');
select hasnt_column('public', 'conversation_peers', 'age_bracket',
  'no age band');
reset role;

-- The definer view's WHERE clause is its entire access control, so the outsider
-- check is not a formality (004 is the record of what a decorative boundary
-- costs).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a4","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversation_peers),
  0,
  'and somebody with no thread here still learns nobody''s name'
);
reset role;

select * from finish();
rollback;
