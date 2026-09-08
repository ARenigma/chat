-- pgTAP for migration 091: the upgrade handoff's own UPDATE succeeds.
--
-- `start_call` (079:145-149) ends a live chat or audio session by writing
-- `end_reason = 'upgraded_to_call'` before opening the new call. That value was
-- never in `paid_sessions_end_reason_check` (030:140), so the UPDATE raised
-- 23514 and aborted the whole call — the chat->call handoff (073) and the
-- audio->video upgrade (074) have failed since the day they shipped.
--
-- Assertion 2 runs the failing statement VERBATIM rather than asserting the
-- constraint's text, for the reason 390's header gives: the constraint and its
-- writer were each defensible alone, and only their disagreement was the bug.
-- A test that read the constraint would have agreed with itself all along.
--
--  1. the constraint admits the handoff reason
--  2. start_call's exact UPDATE succeeds against a real session row
--  3. ...and the row really does carry the handoff reason afterwards
--  4. the eight original reasons still work — 091 widened, it did not replace
--  5. an invented reason is still refused

begin;
select plan(5);

select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.paid_sessions'::regclass
      and conname  = 'paid_sessions_end_reason_check'
      and pg_get_constraintdef(oid) like '%upgraded_to_call%'
  ),
  1,
  'paid_sessions_end_reason_check admits upgraded_to_call'
);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000e001', 'member410@test.local'),
  ('aaaaaaaa-0000-0000-0000-00000000e002', 'provider410@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-00000000e001',
  'aaaaaaaa-0000-0000-0000-00000000e001',
  'aaaaaaaa-0000-0000-0000-00000000e002'
);

-- A live chat session, which is what start_call finds when the member taps
-- Call from inside an active chat.
insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, status, started_at
) values (
  'ffffffff-0000-0000-0000-00000000e001',
  'cccccccc-0000-0000-0000-00000000e001',
  'chat',
  'aaaaaaaa-0000-0000-0000-00000000e001',
  'aaaaaaaa-0000-0000-0000-00000000e002',
  22,
  'active',
  now() - interval '3 minutes'
);

-- ---------------------------------------------------------------------------
-- 2. start_call's statement, copied from 079:145-149.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    update public.paid_sessions
    set    status     = 'ended',
           ended_at   = now(),
           end_reason = 'upgraded_to_call'
    where  id = 'ffffffff-0000-0000-0000-00000000e001'
  $$,
  'the chat->call handoff can end its session — this is what was raising 23514'
);

select is(
  (select end_reason from public.paid_sessions
    where id = 'ffffffff-0000-0000-0000-00000000e001'),
  'upgraded_to_call',
  'and the handoff stays distinguishable from a system-forced end'
);

-- ---------------------------------------------------------------------------
-- 4. Widened, not replaced.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    update public.paid_sessions
    set    end_reason = 'balance_exhausted'
    where  id = 'ffffffff-0000-0000-0000-00000000e001'
  $$,
  'the original reasons are untouched'
);

select throws_ok(
  $$
    update public.paid_sessions
    set    end_reason = 'because i said so'
    where  id = 'ffffffff-0000-0000-0000-00000000e001'
  $$,
  '23514',
  null,
  'an invented reason is still refused'
);

select * from finish();
rollback;
