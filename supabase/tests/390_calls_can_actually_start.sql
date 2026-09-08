-- pgTAP for migration 089: an ordinary call can be inserted.
--
-- A reproduced PRODUCTION OUTAGE turned into a regression test. On 2026-09-08,
-- on a real device, every outgoing call failed at the insert:
--
--   23514  new row for relation "calls" violates check constraint
--          "calls_media_assignment_kind_check"
--
-- The live database carried 057's TRIGGER (which writes
-- `media_assignment_kind = 'default'`) alongside 052's narrower CONSTRAINT
-- (which permits only sticky|harness). Two halves of one migration on opposite
-- sides of a fence, and the member was told "Check your connection."
--
-- The point of this file is that the trigger and the constraint are tested
-- TOGETHER against the same row, because each one is correct in isolation and
-- the bug lives only in their disagreement. A test that asserted the constraint
-- text, or the trigger body, would have passed throughout the outage.
--
--  1. the constraint permits exactly the three kinds 057 defined
--  2. an ordinary insert survives the trigger AND the constraint
--  3. ...and the trigger really did write 'default' — the value that was
--     being rejected, so this is the outage's own path and not a near miss
--  4. a harness override still writes 'harness' and is still accepted
--  5. an invented kind is still refused, so 089 did not widen the contract

begin;
select plan(5);

-- ---------------------------------------------------------------------------
-- 1. The constraint's allowed set
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.calls'::regclass
      and conname  = 'calls_media_assignment_kind_check'
      and pg_get_constraintdef(oid) like '%sticky%'
      and pg_get_constraintdef(oid) like '%harness%'
      and pg_get_constraintdef(oid) like '%default%'
  ),
  1,
  'calls_media_assignment_kind_check permits sticky, harness and default'
);

-- Two users and a conversation to hang a call off.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000c001', 'caller390@test.local'),
  ('aaaaaaaa-0000-0000-0000-00000000c002', 'callee390@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-00000000c001',
  'aaaaaaaa-0000-0000-0000-00000000c001',
  'aaaaaaaa-0000-0000-0000-00000000c002'
);

-- ---------------------------------------------------------------------------
-- 2. The ordinary path: insert a ringing call exactly as start_call does.
--    No media columns are supplied — assign_call_media_backend fills them, and
--    it is that trigger's output the constraint was rejecting.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    insert into public.calls (id, conversation_id, caller_id, callee_id, medium, status)
    values (
      'dddddddd-0000-0000-0000-00000000c001',
      'cccccccc-0000-0000-0000-00000000c001',
      'aaaaaaaa-0000-0000-0000-00000000c001',
      'aaaaaaaa-0000-0000-0000-00000000c002',
      'voice',
      'ringing'
    )
  $$,
  'an ordinary outgoing call inserts — the outage was exactly this failing'
);

-- ---------------------------------------------------------------------------
-- 3. ...and the value under test really is the one that was rejected.
-- ---------------------------------------------------------------------------
select is(
  (
    select media_assignment_kind
    from public.calls
    where id = 'dddddddd-0000-0000-0000-00000000c001'
  ),
  'default',
  'the trigger wrote default, which is the value 052''s constraint refused'
);

-- ---------------------------------------------------------------------------
-- 4. A harness override still works and still records its own kind, which is
--    the distinction 057 widened the constraint to preserve.
--
--    The first call has to be retired before a second one can exist:
--    `calls_one_live_per_conversation_idx` (011:742) allows exactly one live
--    call per conversation, which is a rule worth tripping over here rather
--    than in production.
-- ---------------------------------------------------------------------------
update public.calls
set status = 'ended', ended_at = now(), end_reason = 'hangup'
where id = 'dddddddd-0000-0000-0000-00000000c001';

insert into public.call_media_overrides (
  conversation_id, requested_by, backend, experiment_id, run_id, expires_at
) values (
  'cccccccc-0000-0000-0000-00000000c001',
  'aaaaaaaa-0000-0000-0000-00000000c001',
  'agora',
  'harness-390',
  'eeeeeeee-0000-0000-0000-00000000c001',
  now() + interval '1 hour'
);

insert into public.calls (id, conversation_id, caller_id, callee_id, medium, status)
values (
  'dddddddd-0000-0000-0000-00000000c002',
  'cccccccc-0000-0000-0000-00000000c001',
  'aaaaaaaa-0000-0000-0000-00000000c001',
  'aaaaaaaa-0000-0000-0000-00000000c002',
  'voice',
  'ringing'
);

select is(
  (
    select media_assignment_kind
    from public.calls
    where id = 'dddddddd-0000-0000-0000-00000000c002'
  ),
  'harness',
  'a harness override is still distinguishable from a default assignment'
);

-- ---------------------------------------------------------------------------
-- 5. 089 re-asserted the constraint; it did not remove it.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$
    update public.calls
    set media_assignment_kind = 'whatever'
    where id = 'dddddddd-0000-0000-0000-00000000c002'
  $$,
  '23514',
  null,
  'an unknown assignment kind is still refused'
);

select * from finish();
rollback;
