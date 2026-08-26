-- pgTAP for migration 011, part two: calls and the meter.
--
-- The meter is money, so the assertions are about the arithmetic and about who
-- can influence it. The three that matter most:
--
--   - no call RPC accepts a duration, so there is nothing for a client to lie
--     about. Asserted structurally rather than by inspection.
--   - a member is never billed twice for the same minute, and never billed past
--     the moment the call ended.
--   - blocking gates a call exactly as it gates a message, at the start AND
--     during, because a block placed mid-call has to hang it up.
--
-- The clock is moved by hand throughout. A per-minute meter cannot be tested in
-- real time, and backdating started_at is the only way to assert the arithmetic
-- rather than assert that a minute has not passed yet.

\set ON_ERROR_STOP on
begin;
select plan(61);

-- ---------------------------------------------------------------------------
-- Shape and privilege
-- ---------------------------------------------------------------------------
select has_table('public', 'calls', 'calls exists');
select has_column('public', 'calls', 'medium', 'a call records voice or video');
select has_column('public', 'calls', 'started_at', 'when it was answered');
select has_column('public', 'calls', 'ended_at', 'when it finished');
select has_column('public', 'calls', 'tokens_debited', 'and what it cost');
select has_column(
  'public', 'calls', 'last_seen_at',
  'plus liveness, so a killed app does not bill a wallet to zero'
);
select ok(
  (select count(*) = 1 from pg_indexes
    where schemaname = 'public' and indexname = 'calls_one_live_per_conversation_idx'),
  'one live call per thread, so a double tap cannot start two meters'
);
select ok(
  (select count(*) = 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'calls'),
  'calls are published, because the ring IS the insert'
);
select is(
  (select relreplident from pg_class where oid = 'public.calls'::regclass)::text,
  'f', 'with full replica identity so a status change is renderable on arrival'
);
-- The load-bearing assertion of the whole file. "Server authoritative" is not a
-- property of the code being careful; it is a property of the API having no
-- parameter to be careless with.
select ok(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('start_call', 'answer_call', 'end_call',
                       'heartbeat_call', 'settle_call', 'meter_active_calls')
     and pg_get_function_arguments(p.oid) ~* '(duration|seconds|minutes|elapsed)') = 0,
  'no call RPC accepts a duration: the meter reads started_at and now(), only'
);
select function_privs_are(
  'public', 'settle_call', ARRAY['uuid'], 'authenticated', ARRAY[]::text[],
  'the meter itself is callable by no client, like is_blocked_pair'
);
select function_privs_are(
  'public', 'meter_active_calls', ARRAY[]::text[], 'authenticated', ARRAY[]::text[],
  'nor is the ticker'
);
select function_privs_are(
  'public', 'meter_active_calls', ARRAY[]::text[], 'service_role', ARRAY['EXECUTE'],
  'which only the cron identity may run'
);
select function_privs_are(
  'public', 'start_call', ARRAY['uuid', 'call_medium'], 'authenticated', ARRAY['EXECUTE'],
  'a client may start a call'
);
select is(
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'calls' and grantee = 'authenticated'),
  'SELECT',
  'and read its own calls, and write nothing on the table at all'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_name = 'pending_call_pushes' and grantee in ('anon', 'authenticated')),
  0, 'the ring queue is service role only, like pending_pushes'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member
  ('cccccccc-0000-4000-8000-000000000003');  -- outsider

insert into public.provider_applications (user_id, display_name, date_of_birth)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Ada',
        (current_date - interval '26 years')::date);

select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'the provider is admitted'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
select is(
  (public.send_message((select v from test.fixture where k = 'thread'), 'can we talk')
    ->> 'success')::boolean,
  true, 'the member opens the thread, spending one token'
);

-- ---------------------------------------------------------------------------
-- Ringing costs nothing; only the callee may answer
-- ---------------------------------------------------------------------------
insert into test.fixture (k, v)
select 'call', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
select isnt(
  (select v from test.fixture where k = 'call'), null,
  'the member starts a voice call'
);
select is(
  (select status::text from public.calls
    where id = (select v from test.fixture where k = 'call')),
  'ringing', 'which begins by ringing'
);
select is(
  (select tokens_debited from public.calls
    where id = (select v from test.fixture where k = 'call')),
  0, 'and costs nothing until somebody picks up'
);
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'video') ->> 'error',
  'BUSY', 'a second call while one is live is refused'
);
select is(
  public.answer_call((select v from test.fixture where k = 'call')) ->> 'error',
  'FORBIDDEN', 'and the caller cannot answer their own call'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.answer_call((select v from test.fixture where k = 'call'))
    ->> 'success')::boolean,
  true, 'the callee answers'
);
reset role;

select is(
  (select status::text from public.calls
    where id = (select v from test.fixture where k = 'call')),
  'active', 'and the call is live'
);
-- One minute on answer, not three. docs/clarity-learnings.md records the review
-- this number exists to not be.
select is(
  (select tokens_debited from public.calls
    where id = (select v from test.fixture where k = 'call')),
  5, 'minute one is billed on answer, and one minute is not three'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  44, 'the member paid for the message and the minute'
);
select is(
  (select token_balance from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  50, 'and the provider paid nothing, whoever dialled'
);

-- ---------------------------------------------------------------------------
-- The ticker
-- ---------------------------------------------------------------------------
select is(public.meter_active_calls(), 1, 'the ticker sees one live call');
select is(
  (select tokens_debited from public.calls
    where id = (select v from test.fixture where k = 'call')),
  5, 'a tick inside the same minute bills nothing twice'
);

update public.calls
set started_at = now() - interval '150 seconds', last_seen_at = now()
where id = (select v from test.fixture where k = 'call');

select is(public.meter_active_calls(), 1, 'the clock moves and the ticker runs');
select is(
  (select tokens_debited from public.calls
    where id = (select v from test.fixture where k = 'call')),
  15, 'a 150-second call owes three minutes: the one it is in, and two behind it'
);
select is(
  (select minutes_billed from public.calls
    where id = (select v from test.fixture where k = 'call')),
  3, 'counted in minutes as well as tokens, so the log is auditable'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  34, 'and the wallet agrees with the call'
);

-- ---------------------------------------------------------------------------
-- Running out mid-call
-- ---------------------------------------------------------------------------
update public.profiles set token_balance = 4
where id = 'bbbbbbbb-0000-4000-8000-000000000002';
update public.calls
set started_at = now() - interval '400 seconds', last_seen_at = now()
where id = (select v from test.fixture where k = 'call');

select is(public.meter_active_calls(), 1, 'the ticker reaches a wallet that cannot pay');
select is(
  (select status::text from public.calls
    where id = (select v from test.fixture where k = 'call')),
  'ended', 'and ends the call rather than letting the meter run'
);
select is(
  (select end_reason from public.calls
    where id = (select v from test.fixture where k = 'call')),
  'out_of_tokens', 'saying why, so the client can offer a refill instead of an error'
);
select is(
  (select token_balance from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  4, 'a minute it could not afford was not billed, and the wallet never went negative'
);

-- ---------------------------------------------------------------------------
-- Hanging up between ticks
-- ---------------------------------------------------------------------------
update public.profiles set token_balance = 50
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'call2', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'video') ->> 'call_id')::uuid;
select isnt((select v from test.fixture where k = 'call2'), null, 'a second call starts');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.answer_call((select v from test.fixture where k = 'call2'))
    ->> 'success')::boolean,
  true, 'and is answered'
);
reset role;

update public.calls set started_at = now() - interval '90 seconds'
where id = (select v from test.fixture where k = 'call2');

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (public.end_call((select v from test.fixture where k = 'call2'))
    ->> 'tokens_debited')::int,
  10, 'a hang-up settles first, so ending at 0:59 of a minute is not free'
);
select is(
  (select status::text from public.calls
    where id = (select v from test.fixture where k = 'call2')),
  'ended', 'and the call closes'
);
select is(
  (public.end_call((select v from test.fixture where k = 'call2'))
    ->> 'success')::boolean,
  true, 'ending it twice is not an error: both clients hang up'
);
reset role;

-- ---------------------------------------------------------------------------
-- The three ways a ring ends without connecting
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'call3', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.end_call((select v from test.fixture where k = 'call3')) ->> 'status',
  'declined', 'the callee hanging up on a ring is a decline, not a miss'
);
reset role;

select is(
  (select tokens_debited from public.calls
    where id = (select v from test.fixture where k = 'call3')),
  0, 'and nothing was billed'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'call4', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
select is(
  public.end_call((select v from test.fixture where k = 'call4')) ->> 'status',
  'missed', 'the caller giving up is a miss, derived from who ended it'
);
insert into test.fixture (k, v)
select 'call5', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
reset role;

-- A ring nobody answers must not hold the live-call index forever.
update public.calls set created_at = now() - interval '60 seconds'
where id = (select v from test.fixture where k = 'call5');
select ok(public.meter_active_calls() >= 0, 'the ticker sweeps stale rings');
select is(
  (select status::text from public.calls
    where id = (select v from test.fixture where k = 'call5')),
  'missed', 'an unanswered ring is closed by the server'
);
select is(
  (select end_reason from public.calls
    where id = (select v from test.fixture where k = 'call5')),
  'unanswered', 'and says so, so the log is not a lie about who hung up'
);

-- ---------------------------------------------------------------------------
-- A call whose app died
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'call6', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (public.answer_call((select v from test.fixture where k = 'call6'))
    ->> 'success')::boolean,
  true, 'a call is answered and then both devices vanish'
);
reset role;

update public.calls
set started_at = now() - interval '30 seconds',
    last_seen_at = now() - interval '120 seconds'
where id = (select v from test.fixture where k = 'call6');

select is(public.meter_active_calls(), 1, 'the ticker notices nobody is there');
select is(
  (select end_reason from public.calls
    where id = (select v from test.fixture where k = 'call6')),
  'dropped',
  'and ends it rather than billing a wallet to zero for a call nobody is on'
);

-- ---------------------------------------------------------------------------
-- The gates: the same ones send_message has, plus during the call
-- ---------------------------------------------------------------------------
update public.profiles set token_balance = 50
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into public.blocks (blocker_id, blocked_id)
values ('bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001');
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'voice') ->> 'error',
  'BLOCKED', 'a blocked pair cannot call, by the same function that stops a message'
);
reset role;

delete from public.blocks;

-- The case a start-time-only check would miss.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
select 'call7', (public.start_call(
  (select v from test.fixture where k = 'thread'), 'voice') ->> 'call_id')::uuid;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select public.answer_call((select v from test.fixture where k = 'call7'));
reset role;

insert into public.blocks (blocker_id, blocked_id)
values ('bbbbbbbb-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001');
select public.meter_active_calls();
select is(
  (select end_reason from public.calls
    where id = (select v from test.fixture where k = 'call7')),
  'blocked',
  'and a block placed during a call hangs it up, or the remedy stops at text'
);

delete from public.blocks;

update public.profiles set suspended_until = now() + interval '1 day'
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'voice') ->> 'error',
  'SUSPENDED', 'a suspended member cannot call their way around it'
);
reset role;

update public.profiles set suspended_until = null
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- Whoever dials, the member pays, so the member's wallet is the gate.
update public.profiles set token_balance = 3
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'voice') ->> 'error',
  'INSUFFICIENT_BALANCE',
  'a provider calling a member with an empty wallet is refused, not cut off later'
);
reset role;

update public.profiles set token_balance = 50
where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'voice') ->> 'error',
  'FORBIDDEN', 'an outsider with a stolen thread id cannot ring anybody in it'
);
select is(
  (select count(*)::int from public.calls), 0,
  'nor see that any of these calls happened'
);
select throws_ok(
  $$insert into public.calls (conversation_id, caller_id, callee_id, medium)
    values ((select v from test.fixture where k = 'thread'),
            'cccccccc-0000-4000-8000-000000000003',
            'aaaaaaaa-0000-4000-8000-000000000001', 'voice')$$,
  '42501', null,
  'and cannot write a call row directly, which is how a meter gets bypassed'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$update public.calls set tokens_debited = 0$$,
  '42501', null,
  'nor may a participant rewrite their own bill'
);
reset role;

-- ---------------------------------------------------------------------------
-- Ring flooding
-- ---------------------------------------------------------------------------
-- Inserted as the owner rather than dialled, because the live-call indexes make
-- ten real rings impossible and the ceiling counts attempts, not connections.
insert into public.calls (
  conversation_id, caller_id, callee_id, medium, status, ended_at, end_reason
)
select (select v from test.fixture where k = 'thread'),
       'bbbbbbbb-0000-4000-8000-000000000002',
       'aaaaaaaa-0000-4000-8000-000000000001',
       'voice', 'ended', now(), 'hangup'
from generate_series(1, 10);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.start_call((select v from test.fixture where k = 'thread'), 'voice') ->> 'error',
  'RATE_LIMITED',
  'ring flooding is harassment with a vibration attached, and it is capped'
);
reset role;

select * from finish();
rollback;
