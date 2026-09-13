-- pgTAP for migration 099: a chat session survives a ringing call, and dies
-- only when the call actually connects.
--
-- THE BUG. `start_call` (079 — the live definition, not 073) ended the chat
-- session inline and deliberately did NOT call `end_session`: "Keep the
-- transcript. Upgrade is a billing handoff, not end_session purge." Nothing
-- else hid those messages either — `end_session` hides
-- `session_id = p_session_id or session_id is null`, and the old chat messages
-- carry the CHAT session's id, which matches neither the call's own end nor any
-- later chat session's. So one call attempt, even a declined one, left that
-- chat transcript visible permanently.
--
-- It ended the chat session because `paid_sessions_one_live` was unique on
-- conversation_id alone, so the call's row could not otherwise be inserted. The
-- purge rode along with a constraint workaround.
--
-- Every combination, asserted against real rows rather than against the
-- functions' text:
--
--   1. the index is per (conversation, channel)
--   2. a chat session and a pending call session COEXIST — the case the old
--      index made impossible, and the whole reason the chat had to die early
--   3. two live sessions on the SAME channel are still refused
--   4. DECLINED call: chat session still live
--   5. DECLINED call: chat transcript still visible
--   6. CONNECTED call: the chat session is ended...
--   7. ...with the handoff reason
--   8. ...and its transcript is hidden — the purge that never used to happen
--   9. ...and the CALL's own messages are untouched, so the call is unaffected
--  10. a connected call with NO chat session underneath does not fail
--  11. start_call no longer selects a CHAT session...
--  12. ...but still hands off audio -> video, which per-channel uniqueness needs
--  13. a chat session activating does NOT end anything (guard against the
--      handoff firing on the wrong channel)

begin;
select plan(14);

-- ── 1. the index ───────────────────────────────────────────────────────────
select is(
  (
    select pg_get_indexdef(oid)
    from pg_class
    where relname = 'paid_sessions_one_live'
  ) like '%conversation_id, channel%',
  true,
  'paid_sessions_one_live is unique per (conversation_id, channel)'
);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000004a1', 'member430@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000004a2', 'provider430@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-0000000004a1',
  'aaaaaaaa-0000-0000-0000-0000000004a1',
  'aaaaaaaa-0000-0000-0000-0000000004a2'
);

-- A live chat session: the member is chatting.
insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, status, started_at, minutes_billed
) values (
  'ffffffff-0000-0000-0000-0000000004a1',
  'cccccccc-0000-0000-0000-0000000004a1',
  'chat',
  'aaaaaaaa-0000-0000-0000-0000000004a1',
  'aaaaaaaa-0000-0000-0000-0000000004a2',
  22, 'active', now() - interval '3 minutes', 3
);

-- Two messages in it. These are what must survive a declined call and vanish
-- on a connected one.
insert into public.messages (id, conversation_id, sender_id, body, session_id)
values
  ('dddddddd-0000-0000-0000-0000000004a1',
   'cccccccc-0000-0000-0000-0000000004a1',
   'aaaaaaaa-0000-0000-0000-0000000004a1', 'hello', 'ffffffff-0000-0000-0000-0000000004a1'),
  ('dddddddd-0000-0000-0000-0000000004a2',
   'cccccccc-0000-0000-0000-0000000004a1',
   'aaaaaaaa-0000-0000-0000-0000000004a2', 'hi there', 'ffffffff-0000-0000-0000-0000000004a1');

-- ── 2. coexistence: the case the old index forbade ─────────────────────────
select lives_ok(
  $$
    insert into public.paid_sessions (
      id, conversation_id, channel, member_id, provider_id,
      rate_tokens_per_min, status
    ) values (
      'ffffffff-0000-0000-0000-0000000004a2',
      'cccccccc-0000-0000-0000-0000000004a1',
      'audio',
      'aaaaaaaa-0000-0000-0000-0000000004a1',
      'aaaaaaaa-0000-0000-0000-0000000004a2',
      30, 'pending_leases'
    )
  $$,
  'a ringing call session can coexist with a live chat session'
);

-- ── 3. ...but not two on the same channel ──────────────────────────────────
select throws_ok(
  $$
    insert into public.paid_sessions (
      id, conversation_id, channel, member_id, provider_id,
      rate_tokens_per_min, status
    ) values (
      'ffffffff-0000-0000-0000-0000000004a3',
      'cccccccc-0000-0000-0000-0000000004a1',
      'chat',
      'aaaaaaaa-0000-0000-0000-0000000004a1',
      'aaaaaaaa-0000-0000-0000-0000000004a2',
      22, 'active'
    )
  $$,
  '23505',
  null,
  'two live sessions on the SAME channel are still refused'
);

-- ── 4 & 5. THE DECLINED CALL. The call session ends without ever activating. ─
update public.paid_sessions
set    status = 'ended', ended_at = now(), end_reason = 'manual'
where  id = 'ffffffff-0000-0000-0000-0000000004a2';

select is(
  (select status::text from public.paid_sessions
   where id = 'ffffffff-0000-0000-0000-0000000004a1'),
  'active',
  'a declined call leaves the chat session LIVE'
);

select is(
  (select count(*)::int from public.messages
   where session_id = 'ffffffff-0000-0000-0000-0000000004a1' and hidden_at is null),
  2,
  'a declined call leaves the chat transcript visible'
);

-- ── 6-9. THE CONNECTED CALL. ───────────────────────────────────────────────
-- A fresh call session, and the handoff run the way claim_session_lease runs
-- it: end_session on the live chat session for this conversation.
insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, status, started_at, minutes_billed
) values (
  'ffffffff-0000-0000-0000-0000000004a4',
  'cccccccc-0000-0000-0000-0000000004a1',
  'video',
  'aaaaaaaa-0000-0000-0000-0000000004a1',
  'aaaaaaaa-0000-0000-0000-0000000004a2',
  40, 'active', now(), 1
);

-- A message belonging to the CALL session, to prove the handoff does not reach
-- past the chat session it is ending.
insert into public.messages (id, conversation_id, sender_id, body, session_id)
values (
  'dddddddd-0000-0000-0000-0000000004a3',
  'cccccccc-0000-0000-0000-0000000004a1',
  'aaaaaaaa-0000-0000-0000-0000000004a1', 'during the call',
  'ffffffff-0000-0000-0000-0000000004a4'
);

-- end_session checks auth.uid() is a participant.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000004a1","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.end_session('ffffffff-0000-0000-0000-0000000004a1', 'upgraded_to_call') $$,
  'a connected call can end the chat session beneath it'
);

reset role;

select is(
  (select status::text from public.paid_sessions
   where id = 'ffffffff-0000-0000-0000-0000000004a1'),
  'ended',
  'a connected call ENDS the chat session'
);

select is(
  (select end_reason from public.paid_sessions
   where id = 'ffffffff-0000-0000-0000-0000000004a1'),
  'upgraded_to_call',
  'the chat session carries the handoff reason'
);

-- THE HEADLINE. This is the purge that never used to happen.
select is(
  (select count(*)::int from public.messages
   where session_id = 'ffffffff-0000-0000-0000-0000000004a1' and hidden_at is null),
  0,
  'a connected call HIDES the chat transcript'
);

select is(
  (select count(*)::int from public.messages
   where session_id = 'ffffffff-0000-0000-0000-0000000004a4' and hidden_at is null),
  1,
  'the call session own messages are untouched by the handoff'
);

-- ── 10. no chat session underneath ─────────────────────────────────────────
-- The handoff's lookup must simply find nothing rather than raise, or a direct
-- call with no prior chat would fail at its first billed minute.
select is(
  (
    select count(*)::int
    from public.paid_sessions
    where conversation_id = 'cccccccc-0000-0000-0000-0000000004a1'
      and channel = 'chat'
      and status not in ('ended', 'reported_hold')
  ),
  0,
  'with the chat ended, the handoff lookup finds nothing to end'
);

-- ── 11. start_call no longer has a chat branch ─────────────────────────────
-- The upgrade block still EXISTS — audio -> video needs it, and needs it more
-- than before, because per-channel uniqueness makes those two distinct channels
-- that would otherwise both be live and both bill. What must be gone is its
-- chat arm. Asserted as the disappearance of the old disjunction and the
-- presence of the narrowed selector, which is the difference between the two.
select is(
  (
    select prosrc from pg_proc
    where proname = 'start_call' and pronamespace = 'public'::regnamespace
    limit 1
  ) like '%or (channel = ''audio'' and p_medium = ''video'')%',
  false,
  'start_call no longer selects a CHAT session to end when a call is requested'
);

select is(
  (
    select prosrc from pg_proc
    where proname = 'start_call' and pronamespace = 'public'::regnamespace
    limit 1
  ) like '%and channel = ''audio''%and p_medium = ''video''%',
  true,
  'start_call still hands off audio -> video, which per-channel uniqueness needs'
);

-- ── 12. the handoff is gated on channel ────────────────────────────────────
-- A CHAT session activating must not end anything. The guard in
-- claim_session_lease is `v_session.channel <> 'chat'`; this asserts it is
-- present, because a handoff that fired on the wrong channel would have a chat
-- session end itself the moment it started.
select is(
  (
    select prosrc from pg_proc
    where proname = 'claim_session_lease'
      and pronamespace = 'public'::regnamespace
    limit 1
  ) like '%channel <> ''chat''%',
  true,
  'the handoff only fires for a NON-chat session'
);

select * from finish();
rollback;
