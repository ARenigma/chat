-- pgTAP for migration 005: blocking, reporting, suspension, rate limits,
-- append-only audit, and PII-free telemetry.
--
-- Written as the attack wherever possible. The interesting assertions are not
-- "blocking works" but the ones a naive implementation gets wrong:
--
--   - a block is symmetric, so the blocker cannot keep talking either
--   - "you have been blocked" is never disclosed to the blocked party
--   - a rejected send costs no token
--   - a report cannot exfiltrate text from a thread you are not in
--   - the audit trail cannot be rewritten, even by service_role
--   - telemetry cannot carry a message body

\set ON_ERROR_STOP on
begin;
select plan(51);

-- ---------------------------------------------------------------------------
-- Shape and privilege
-- ---------------------------------------------------------------------------
select has_table('public', 'blocks', 'blocks exists');
select has_table('public', 'reports', 'reports exists');
select has_table('public', 'moderation_actions', 'moderation_actions exists');
select has_table('public', 'events', 'events exists');
select has_column('public', 'profiles', 'suspended_until', 'profiles carry suspension');
select has_trigger('public', 'events', 'guard_event_shape', 'events are shape-guarded');
select has_trigger(
  'public', 'moderation_actions', 'moderation_actions_no_update',
  'the audit trail has an immutability trigger'
);

-- is_blocked_pair answers "is A blocked by B" for arbitrary pairs, so a client
-- must not be able to call it, that is the disclosure the missing SELECT policy
-- on blocks exists to prevent.
select function_privs_are(
  'public', 'is_blocked_pair', ARRAY['uuid', 'uuid'], 'authenticated', ARRAY[]::text[],
  'a client cannot probe the block graph'
);
select function_privs_are(
  'public', 'submit_report', ARRAY['uuid', 'uuid', 'report_reason', 'text'],
  'authenticated', ARRAY['EXECUTE'],
  'a client may file a report'
);
select function_privs_are(
  'public', 'purge_expired_reports', ARRAY[]::text[], 'authenticated', ARRAY[]::text[],
  'a client cannot purge the evidence'
);

-- ---------------------------------------------------------------------------
-- Fixtures: a provider and two unrelated members
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member one
  ('cccccccc-0000-4000-8000-000000000003');  -- member two

update public.profiles set display_name = 'Ada'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';
-- `languages` required by migration 075 for the approval below to succeed.
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Ada', (current_date - interval '26 years')::date, array['English']);
select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'the provider is admitted'
);

-- Fund both members so the session balance gate (ADR-0020) does not block their
-- sends before the test assertions that care about blocks/reports/rate-limits.
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
  true, 'the member can send before any block'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread2', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
reset role;

-- ---------------------------------------------------------------------------
-- Blocking
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$insert into public.blocks (blocker_id, blocked_id)
    values ('bbbbbbbb-0000-4000-8000-000000000002',
            'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a member can block a provider'
);
select throws_ok(
  $$insert into public.blocks (blocker_id, blocked_id)
    values ('cccccccc-0000-4000-8000-000000000003',
            'aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501', null,
  'but cannot block on somebody else''s behalf'
);
select is(
  public.send_message((select v from test.fixture where k = 'thread'), 'still here') ->> 'error',
  'BLOCKED', 'and can no longer send into that thread'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  500, 'sends cost nothing: no per-message debit in the session model (ADR-0020)'
);
reset role;

-- Symmetry is the point: the blocker does not get a one-way megaphone.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.send_message((select v from test.fixture where k = 'thread'), 'hello?') ->> 'error',
  'BLOCKED', 'and the blocked provider cannot reach the member either'
);
-- The blocked party must not learn that they were blocked, or the remedy invites
-- retaliation from a second account.
select is(
  (select count(*)::int from public.blocks), 0,
  'the blocked party cannot see the block that silenced them'
);
select is(
  (select count(*)::int from public.provider_directory), 1,
  'and the provider is still listed for everyone else'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'thread2'), 'hi there')
    ->> 'success')::boolean,
  true, 'an unrelated member is unaffected by somebody else''s block'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
-- By the handle the Blocked list shows (152): a DELETE whose WHERE reads
-- blocked_id needs SELECT on it, which a client no longer has.
select lives_ok(
  $$delete from public.blocks
    where handle = (select handle from public.blocked_people
                    where blocked_id = 'aaaaaaaa-0000-4000-8000-000000000001')$$,
  'the block can be lifted by its owner'
);
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'back again')
    ->> 'success')::boolean,
  true, 'and sending resumes'
);
reset role;

-- The provider now replies for real. Without this there is no message from the
-- subject to report, so the evidence snapshot below would assert nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'something vile')
    ->> 'success')::boolean,
  true, 'the provider can reply once the block is lifted'
);
reset role;

-- ---------------------------------------------------------------------------
-- Suspension
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
-- Deliberately a non-null value: `null is distinct from null` is false, so
-- assigning null to an already-null column never trips the guard and the test
-- would have proved nothing.
select throws_ok(
  $$update public.profiles set suspended_until = now() + interval '1 day'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null,
  'a member cannot lift or impose its own suspension'
);
reset role;

update public.profiles set suspended_until = now() + interval '7 days'
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.send_message((select v from test.fixture where k = 'thread'), 'let me out') ->> 'error',
  'SUSPENDED', 'a suspended member cannot send'
);
select throws_ok(
  $$select public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001')$$,
  '42501', null,
  'nor open a fresh thread to route around it'
);
reset role;

update public.profiles set suspended_until = null
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- A provider under review should stop taking new members.
update public.profiles set suspended_until = now() + interval '1 day'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.provider_directory), 0,
  'a suspended provider drops out of the directory'
);
reset role;

update public.profiles set suspended_until = null
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Rate limiting, on the second member so the earlier assertions stay valid
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select ok(
  (select bool_or(
    (public.send_message((select v from test.fixture where k = 'thread2'), 'flood ' || g)
      ->> 'error') = 'RATE_LIMITED')
   from generate_series(1, 25) g),
  'flooding trips the per-minute rate limit'
);
select ok(
  (select token_balance from public.profiles
    where id = 'cccccccc-0000-4000-8000-000000000003') > 25,
  'and the throttled sends were not billed'
);
reset role;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

-- Select the specific 'something vile' message so the fixture is deterministic
-- even if the provider sent additional messages while the block was active.
insert into test.fixture (k, v)
values ('report', public.submit_report(
  (select v from test.fixture where k = 'thread'),
  (select id from public.messages
    where sender_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and conversation_id = (select v from test.fixture where k = 'thread')
      and body = 'something vile'),
  'harassment', 'said something vile'
));
select isnt(
  (select v from test.fixture where k = 'report'), null,
  'a participant can file a report'
);
select is(
  (select count(*)::int from public.my_reports), 1,
  'the reporter can see their own report and its status'
);

-- Reporting one's own message must capture no evidence: otherwise the snapshot
-- is a way to pin your own words on the other party. Filed here, as the
-- reporter, and read below as the owner.
insert into test.fixture (k, v)
values ('own_report', public.submit_report(
  (select v from test.fixture where k = 'thread'),
  (select id from public.messages
    where sender_id = 'bbbbbbbb-0000-4000-8000-000000000002' limit 1),
  'other', null));
reset role;

-- Read as the owner, because since 150 a reporter cannot read these columns
-- at all (the reporter-side refusal is asserted in 563, 6b-6d). This checks
-- only what the insert recorded.
select is(
  (select subject_user_id from public.reports
    where id = (select v from test.fixture where k = 'report')),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'the subject is inferred from the thread, not supplied by the client'
);
select is(
  (select evidence_body from public.reports
    where id = (select v from test.fixture where k = 'report')),
  'something vile',
  'the reported text is snapshotted, because messages die with the account'
);
select is(
  (select evidence_body from public.reports
    where id = (select v from test.fixture where k = 'own_report')),
  null, 'a report cannot snapshot the reporter''s own message as evidence'
);

-- A non-participant with a stolen conversation id gets nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.submit_report(
      (select v from test.fixture where k = 'thread'), null, 'spam', null)$$,
  '42501', null,
  'a non-participant cannot report a thread they are not in'
);
select is(
  (select count(*)::int from public.my_reports), 0,
  'and sees none of the reports filed by others'
);
select is(
  (select count(*)::int from public.reports), 0,
  'the reports table itself is invisible to them'
);
reset role;

-- ---------------------------------------------------------------------------
-- The audit trail is append-only, including for the role that bypasses RLS
-- ---------------------------------------------------------------------------
insert into public.moderation_actions (subject_user_id, action, actor, note)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'warned', 'ops:amit', 'first warning');

select throws_ok(
  $$update public.moderation_actions set action = 'none'$$,
  '42501', null,
  'a moderation action cannot be edited after the fact'
);
select throws_ok(
  $$delete from public.moderation_actions$$,
  '42501', null,
  'nor deleted'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
-- Not "returns no rows" but "is refused". With the grant revoked this is a hard
-- permission error rather than an RLS-filtered empty set, which is the stronger
-- of the two guarantees: a forgotten policy downgrades an empty result into a
-- leak, whereas a missing grant fails closed.
select throws_ok(
  $$select count(*) from public.moderation_actions$$,
  '42501', null,
  'no client can read the audit trail at all'
);
reset role;

-- ---------------------------------------------------------------------------
-- Telemetry: PII-free by construction, write-only from the client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$insert into public.events (user_id, name, props)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'message_sent',
            '{"surface":"chat"}'::jsonb)$$,
  'an allowlisted event with safe props is accepted'
);
select throws_ok(
  $$insert into public.events (user_id, name)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'exfiltrate_everything')$$,
  '22023', null,
  'an unknown event name is rejected rather than silently stored'
);
select throws_ok(
  $$insert into public.events (user_id, name, props)
    values ('bbbbbbbb-0000-4000-8000-000000000002', 'message_sent',
            '{"body":"the actual message"}'::jsonb)$$,
  '22023', null,
  'telemetry cannot be used to smuggle message content off the device'
);
select throws_ok(
  $$insert into public.events (user_id, name)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'app_open')$$,
  '42501', null,
  'nor to emit events as another user'
);
select throws_ok(
  $$select count(*) from public.events$$,
  '42501', null,
  'events are write-only: reading is refused outright, even for own rows'
);
reset role;

-- ---------------------------------------------------------------------------
-- Retention is bounded in code
-- ---------------------------------------------------------------------------
update public.reports
set status = 'dismissed', resolved_at = now() - interval '91 days';

select is(
  public.purge_expired_reports(), 2,
  'resolved reports are purged after 90 days'
);
select is(
  (select count(*)::int from public.reports), 0,
  'and nothing resolved and expired is left behind'
);

-- ---------------------------------------------------------------------------
-- The inbox read model must not become a way to enumerate other people's threads
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversation_summaries), 1,
  'a member sees exactly their own thread in the inbox'
);
select is(
  (select peer_display_name from public.conversation_summaries), 'Ada',
  'with the peer name resolved through the directory'
);
select is(
  (select peer_id from public.conversation_summaries),
  'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'and the peer is the other participant, whichever side you are on'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversation_summaries), 2,
  'the provider sees both of their threads and no more'
);
reset role;

select * from finish();
rollback;
