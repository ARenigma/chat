-- pgTAP for migration 011, part one: reactions, replies, voice notes, presence,
-- and member pseudonymity. Calls are large enough to need their own file (100).
--
-- Written as the attack where there is one. The assertions that matter are not
-- "a reaction can be added" but the ones a plausible implementation gets wrong:
--
--   - a reply points at a message in somebody else's thread
--   - a voice note carries a body too, or neither, and the CHECK lets it through
--   - a rejected send still costs a token
--   - a reaction reaches somebody who blocked you, because only send_message was
--     ever gated on is_blocked_pair
--   - presence is client-written, so it can be forged or backdated
--   - a member's birth date survives on the row and leaks through a view

\set ON_ERROR_STOP on
begin;
select plan(63);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'messages', 'reply_to_id', 'a message can name its parent');
select has_column('public', 'messages', 'voice_path', 'and carry audio instead of text');
select has_column('public', 'messages', 'voice_duration_ms', 'with a duration to render');
select has_table('public', 'message_reactions', 'message_reactions exists');
select col_is_pk(
  'public', 'message_reactions', ARRAY['message_id', 'user_id'],
  'one reaction per user per message, stated as the key rather than as a rule'
);
select has_trigger(
  'public', 'messages', 'guard_message_reply_and_voice',
  'the new message columns have their own guard, additive to 004''s'
);
select has_trigger(
  'public', 'profiles', 'guard_profile_presence_columns',
  'and presence has a third profile guard rather than an edit to the other two'
);
select has_column('public', 'profiles', 'presence_visible', 'presence is a setting');
select has_column('public', 'profiles', 'last_active_at', 'with a stamp behind it');
-- Migration 037 renamed last_kind → last_preview_kind (ADR-0020).
select has_column(
  'public', 'conversation_summaries', 'last_preview_kind',
  'the inbox can tell a voice note from an empty preview'
);
select has_column(
  'public', 'conversation_summaries', 'peer_last_active_at',
  'and shows the peer''s presence when they allow it'
);
select has_column(
  'public', 'conversation_peers', 'peer_display_name',
  'the peer projection publishes a name for either side'
);
select hasnt_column(
  'public', 'conversation_peers', 'date_of_birth',
  'and never a birth date, whichever side the peer is'
);
select hasnt_column(
  'public', 'conversation_peers', 'headline',
  'nor a headline, which is a provider fact only'
);
select has_column(
  'public', 'provider_directory', 'last_active_at',
  'the directory answers "is she around" as well as "does she reply"'
);
select function_privs_are(
  'public', 'send_message',
  ARRAY['uuid', 'text', 'uuid', 'text', 'integer', 'text', 'integer', 'integer', 'real[]'],
  'authenticated', ARRAY['EXECUTE'],
  'there is exactly one send path and a client may call it'
);
select function_privs_are(
  'public', 'toggle_reaction', ARRAY['uuid', 'text'], 'authenticated', ARRAY['EXECUTE'],
  'reactions go through an RPC, because a policy cannot read the block graph'
);
select function_privs_are(
  'public', 'touch_presence', ARRAY[]::text[], 'authenticated', ARRAY['EXECUTE'],
  'a client may say it is here, and cannot say when it was'
);
select ok(
  (select count(*) = 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'message_reactions'),
  'reactions arrive over realtime, or they only appear on reload'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one provider, one member, one outsider, two threads
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member
  ('cccccccc-0000-4000-8000-000000000003');  -- unrelated member

insert into public.provider_applications (user_id, display_name, date_of_birth)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Ada',
        (current_date - interval '26 years')::date);

select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'the provider is admitted'
);

-- Fund both members so the session balance gate (ADR-0020) passes on first send.
update public.profiles set promo_balance = 500
where id in ('bbbbbbbb-0000-4000-8000-000000000002',
             'cccccccc-0000-4000-8000-000000000003');
select test.accept_current_policies(id)
from auth.users;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'hello')
    ->> 'success')::boolean,
  true, 'the member opens with a line of text'
);
reset role;

insert into test.fixture (k, v)
select 'parent', id from public.messages
where sender_id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread2', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
select is(
  (public.send_message((select v from test.fixture where k = 'thread2'), 'hi from elsewhere')
    ->> 'success')::boolean,
  true, 'and an unrelated member opens their own'
);
reset role;

insert into test.fixture (k, v)
select 'foreign_parent', id from public.messages
where sender_id = 'cccccccc-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Reply
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message(
    (select v from test.fixture where k = 'thread'), 'about that',
    (select v from test.fixture where k = 'parent')) ->> 'success')::boolean,
  true, 'the provider replies to a specific message'
);
select is(
  (select reply_to_id from public.messages where body = 'about that'),
  (select v from test.fixture where k = 'parent'),
  'and the row records which one'
);
-- The attack: quote somebody else's thread into yours, and the quote renders as
-- if the other person said it here.
-- Migration 037 changed this error from BAD_REQUEST to REPLY_NOT_FOUND.
select is(
  public.send_message(
    (select v from test.fixture where k = 'thread'), 'they said',
    (select v from test.fixture where k = 'foreign_parent')) ->> 'error',
  'REPLY_NOT_FOUND',
  'a reply cannot point at a message in another conversation'
);
reset role;

select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  500, 'no per-message debit: balance unchanged regardless of reply or bad-request (ADR-0020)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$update public.messages set reply_to_id = null where body = 'about that'$$,
  '42501', null,
  'a recipient cannot re-point the reply it received, any more than rewrite it'
);
reset role;

-- ---------------------------------------------------------------------------
-- Voice notes
-- ---------------------------------------------------------------------------
-- Paths are built from the real conversation id, because the send path and the
-- storage policy both authorise on that first segment.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select is(
  public.send_message(
    (select v from test.fixture where k = 'thread'), 'and also',
    null,
    (select v from test.fixture where k = 'thread')::text
      || '/11111111-1111-4111-8111-111111111111.m4a',
    5000) ->> 'error',
  'BAD_REQUEST', 'text and audio together is not a message shape'
);
select is(
  public.send_message((select v from test.fixture where k = 'thread'), null) ->> 'error',
  'BAD_REQUEST', 'and neither is an empty send'
);
select is(
  public.send_message(
    (select v from test.fixture where k = 'thread'), null, null,
    (select v from test.fixture where k = 'thread')::text
      || '/11111111-1111-4111-8111-111111111111.m4a',
    400) ->> 'error',
  'BAD_REQUEST', 'a tap too short to be a recording is refused'
);
select is(
  public.send_message(
    (select v from test.fixture where k = 'thread'), null, null,
    (select v from test.fixture where k = 'thread2')::text
      || '/11111111-1111-4111-8111-111111111111.m4a',
    5000) ->> 'error',
  'BAD_REQUEST',
  'and audio uploaded under another thread cannot be attached to this one'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  500, 'none of the four rejections cost a token (balance unchanged in session model)'
);
select is(
  (public.send_message(
    (select v from test.fixture where k = 'thread'), null, null,
    (select v from test.fixture where k = 'thread')::text
      || '/11111111-1111-4111-8111-111111111111.m4a',
    5000) ->> 'kind'),
  'voice', 'a well-formed voice note is accepted and says so'
);
select is(
  (select body from public.messages where voice_path is not null),
  null, 'it carries no body at all, rather than a placeholder one'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  500, 'voice notes carry no per-message cost in the session model (ADR-0020)'
);
reset role;

-- `now()` is the transaction timestamp, so every message inserted by this file
-- shares one created_at and "the newest message" is a tie the planner breaks
-- however it likes. In production each send is its own transaction, so the
-- ordering is real; here it has to be made real before the inbox preview can be
-- asserted at all. Backdated by the owner, since 004's guard forbids a client
-- touching created_at.
update public.messages set created_at = now() - interval '1 minute'
where conversation_id = (select v from test.fixture where k = 'thread')
  and voice_path is null;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
-- Migration 037 renamed last_kind → last_preview_kind and id → conversation_id (ADR-0020).
select is(
  (select last_preview_kind from public.conversation_summaries
    where conversation_id = (select v from test.fixture where k = 'thread')),
  'voice', 'so the inbox can preview it without a body to read'
);
reset role;

-- The constraint, not the function. A hand-written insert by the owner is the
-- case a check in send_message alone would miss.
select throws_ok(
  $$insert into public.messages (conversation_id, sender_id)
    values ((select v from test.fixture where k = 'thread'),
            'bbbbbbbb-0000-4000-8000-000000000002')$$,
  '23514', null,
  'a message with neither payload is not representable, whatever writes it'
);

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), '❤️') ->> 'emoji',
  '❤️', 'a participant reacts and gets the resulting state back'
);
select is((select count(*)::int from public.message_reactions), 1, 'one row');
select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), '❤️') ->> 'emoji',
  null, 'the same emoji again takes it back'
);
select is((select count(*)::int from public.message_reactions), 0, 'and removes the row');

select public.toggle_reaction((select v from test.fixture where k = 'parent'), '👍');
select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), '😂') ->> 'emoji',
  '😂', 'a different emoji replaces'
);
select is(
  (select count(*)::int from public.message_reactions), 1,
  'without accumulating a second row, because the key forbids one'
);
-- Free text here would be unmoderatable content under somebody else's words.
select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), 'you are vile')
    ->> 'error',
  'BAD_REQUEST', 'and the emoji set is closed, so a reaction cannot carry prose'
);
select throws_ok(
  $$insert into public.message_reactions (message_id, user_id, emoji)
    values ((select v from test.fixture where k = 'parent'),
            'aaaaaaaa-0000-4000-8000-000000000001', '🙏')$$,
  '42501', null,
  'and there is no direct write path to bypass the block check with'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), '👍') ->> 'error',
  'FORBIDDEN', 'an outsider with a stolen message id cannot react to it'
);
select is(
  (select count(*)::int from public.message_reactions), 0,
  'nor see the reactions on a thread they are not in'
);
reset role;

-- Blocking has to close this channel too, or the remedy is partial.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id)
values ('bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.toggle_reaction((select v from test.fixture where k = 'parent'), '😮') ->> 'error',
  'BLOCKED', 'a blocked party cannot react either, only send_message being gated'
);
reset role;

delete from public.blocks;

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set presence_visible = true
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'the setting is the one new column on profiles a client is meant to write'
);
select throws_ok(
  $$update public.profiles set last_active_at = now() - interval '3 days'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'but the stamp is not writable, so presence cannot be backdated'
);
select throws_ok(
  $$update public.profiles set token_balance = 9999
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'and the older guards still hold, so all three triggers compose'
);
select lives_ok(
  $$select public.touch_presence()$$,
  'the RPC is how a stamp is written'
);
select isnt(
  (select last_active_at from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  null, 'and it landed'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select isnt(
  (select peer_last_active_at from public.conversation_peers
    where conversation_id = (select v from test.fixture where k = 'thread')),
  null, 'the peer sees it, because the peer allowed it'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$update public.profiles set presence_visible = false
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'and the setting can be turned back off'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select peer_last_active_at from public.conversation_peers
    where conversation_id = (select v from test.fixture where k = 'thread')),
  null, 'after which the peer sees nothing, retroactively'
);
reset role;

-- ---------------------------------------------------------------------------
-- Member pseudonymity
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

-- 42501 rather than the 23514 this asserted when 011 shipped, and the change is
-- deliberate: 012 added `guard_pii_columns`, so a client write to any of the
-- three now hits a BEFORE UPDATE trigger and never reaches the constraint. Both
-- still refuse, and the constraint is still the thing that makes a member row
-- holding this unrepresentable rather than merely unwritable, which is why it is
-- worth having both. 110 proves the CHECK by attempting the same write as the
-- OWNER, where no trigger branch fires and 23514 is what comes back.
--
-- Left as two assertions rather than folded into one: this is where somebody
-- looking for the pseudonymity guarantee looks first.
select throws_ok(
  $$update public.profiles set headline = 'looking for someone'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null,
  'a member has no headline to set, and now two separate things say so'
);
select throws_ok(
  $$update public.profiles set gender = 'female'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null,
  'nor a gender'
);
-- Applying is the interesting case: it is the one flow that used to write these
-- onto a member row on the way past.
select is(
  public.submit_provider_application(
    'Bea', 'female', (current_date - interval '31 years')::date,
    'I listen', ARRAY['en'], 'Years of it.'),
  ARRAY[]::text[],
  'a member can still submit a complete application'
);
reset role;

select is(
  (select date_of_birth from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  null, 'and it leaves no birth date on the member row while under review'
);
select is(
  (select headline from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  null, 'nor a headline, since the application holds what was claimed until approval'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select peer_display_name from public.conversation_peers
    where conversation_id = (select v from test.fixture where k = 'thread')),
  'Member bbbb',
  'so a provider addresses a handle, not a name the member typed somewhere else'
);
select is(
  (select count(*)::int from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0, 'and still cannot read the member row behind it'
);
reset role;

select * from finish();
rollback;
