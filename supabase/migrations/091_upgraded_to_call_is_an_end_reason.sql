-- ===========================================================================
-- 091  Session upgrades have never worked: 'upgraded_to_call' is not permitted
-- ===========================================================================
-- Found 2026-09-08 by an audit looking for more of 089's shape, then verified
-- against the live database before being believed.
--
--   live: CHECK (end_reason = ANY (ARRAY['manual','inactivity','background',
--         'disconnect_grace','balance_exhausted','blocked','suspended','system']))
--
-- and `start_call` — current definition 079:145-149, inherited unchanged from
-- 073, 074 and 076 — does:
--
--   update public.paid_sessions
--   set    status     = 'ended',
--          ended_at   = now(),
--          end_reason = 'upgraded_to_call'
--   where  id = v_upgrade_session.id;
--
-- unguarded, inside the transaction. `'upgraded_to_call'` is not in the eight.
-- So the UPDATE raises 23514 and the whole of `start_call` aborts.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS BREAKS, AND FOR HOW LONG
-- ---------------------------------------------------------------------------
-- The branch is reached when a call is started while a live session already
-- exists for the conversation (079:126-131): `channel = 'chat'`, or
-- `channel = 'audio'` upgrading to video. That is precisely:
--
--   * the call button inside an active paid chat — chat -> call handoff (073)
--   * audio -> video upgrade mid-call (074)
--
-- Both fail. And unlike 089 this is NOT drift: 030:140 defines the same eight
-- values in git, and no migration between 030 and 090 widens it, so the write
-- introduced by 073 has never once been accepted. The feature has been broken
-- since it shipped.
--
-- It stayed invisible for the same reason 089 did: `startCall` discards the
-- PostgrestError (src/api/calls.ts:48), so the member is told "Could not start
-- just now. Check your connection." and telemetry records
-- `call_rejected {reason: 'network'}`. A schema fault, reported as a network
-- fault, on a path nobody tested with a live chat session open.
--
-- ---------------------------------------------------------------------------
-- WIDEN, RATHER THAN CHANGE THE WRITERS
-- ---------------------------------------------------------------------------
-- Four migrations write this string and they are right to: an upgrade is not a
-- 'manual' end and not a 'system' end, and 079's own comment says why the
-- distinction is load-bearing — "Upgrade is a billing handoff, not end_session
-- purge". The upgrade path deliberately bypasses `end_session` so the
-- transcript survives, and settles the accrual itself. Collapsing that into
-- 'system' would make a handoff indistinguishable from a server-forced end in
-- every report that reads the column.
--
-- Nothing reads `paid_sessions.end_reason` as a closed set: the only consumers
-- are `end_session`'s own parameter and the client's session types, and the
-- `end_reason` switches in 011 belong to `calls.end_reason`, a different column
-- with its own constraint. Adding a ninth value is additive.
-- ---------------------------------------------------------------------------

alter table public.paid_sessions
  drop constraint if exists paid_sessions_end_reason_check;

alter table public.paid_sessions
  add constraint paid_sessions_end_reason_check
  check (end_reason in (
    'manual', 'inactivity', 'background', 'disconnect_grace',
    'balance_exhausted', 'blocked', 'suspended', 'system',
    -- 091. Written by start_call when a live chat or audio session is handed
    -- off to a new call (079:148, from 073). Not 'system': a handoff is a
    -- thing the member chose, and it keeps its transcript.
    'upgraded_to_call'
  ));

comment on constraint paid_sessions_end_reason_check on public.paid_sessions is
  '030, widened by 091 to admit upgraded_to_call. That value is written by '
  'start_call for the chat->call and audio->video handoffs and had never been '
  'permitted, so both upgrades failed with 23514 from 073 until 091 — and the '
  'client reported it as "Check your connection" because src/api/calls.ts '
  'discards the error.';
