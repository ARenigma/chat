-- pgTAP for 170: an account deletion ends a paid session that started while
-- the deletion was taking its locks.
--
-- 150's prologue locked the caller's live sessions (v_locked) and then read
-- the live sessions AGAIN to find the profiles to lock. In READ COMMITTED
-- each statement has its own snapshot, so a session committed between the
-- two was in the second read and not in v_locked, and was never ended. The
-- delete of auth.users then reached it, still live, through 100's SET NULL,
-- and paid_sessions_live_rows_are_identified refused (23514): the person's
-- "Delete account" failed.
--
-- One session cannot race itself, so this file opens more with dblink (as
-- 566 does): H holds the caller's existing session S0 FOR UPDATE; D runs
-- delete_user_account() as the member and is parked on that lock, inside
-- its first statement, whose snapshot is already taken; I commits a second
-- live session S1 for the same member; H lets go. D's second statement then
-- sees S1 where its first did not. Under 150 D fails on the constraint and
-- S1 stays live; under 170 D retries its prologue, locks S1 in order, and
-- ends both.
--
-- The fixture is COMMITTED through another connection so D and I can see it,
-- and removed at the end (and at the start, in case an earlier run died).
-- Ids are 590's own. dblink lives in `test` and goes with this transaction's
-- rollback.
--
--   1. the deletion succeeds
--   2. the session that started mid-lock is ended, not left live
--   3. the session it locked first is ended too
--   4. the account is gone
--   5. the retry is bounded, and refuses with 40001 rather than delete
--      around a session it could not end

\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema test;

create or replace function test.dblink_reset() returns void
language plpgsql as $$
declare
  v_name text;
begin
  foreach v_name in array coalesce(test.dblink_get_connections(), '{}'::text[]) loop
    perform test.dblink_disconnect(v_name);
  end loop;
end;
$$;
select plan(5);

create function test.conninfo_590()
returns text
language sql
as $$
  select format(
    'dbname=%s user=%s port=%s host=%s',
    current_database(), current_user, current_setting('port'),
    split_part(current_setting('unix_socket_directories'), ',', 1)
  );
$$;

-- Sessions first: a live one blocks its participants' deletion (100's CHECK),
-- which is exactly what an unfixed run leaves behind.
create function test.clean_590()
returns void
language plpgsql
as $$
begin
  perform test.dblink_connect('fx', test.conninfo_590());
  perform test.dblink_exec('fx', $sql$
    delete from public.provider_earnings_ledger where session_id::text like 'c5900000-%';
    delete from public.token_transactions where session_id::text like 'c5900000-%';
    delete from public.paid_sessions where id::text like 'c5900000-%';
    delete from auth.users where id::text like 'c5900000-%';
  $sql$);
  perform test.dblink_disconnect('fx');
end;
$$;

select test.dblink_reset();
select test.clean_590();

-- ── The committed fixture ──────────────────────────────────────────────────
-- Member M (001), funded, in a live chat session S0 (e1) with provider P1
-- (010); provider P2 (011), with whom M's second session S1 (e2) starts
-- during the race.
select test.dblink_connect('fx', test.conninfo_590());
select test.dblink_exec('fx', $sql$
  insert into auth.users (id) values
    ('c5900000-0000-4590-8000-000000000001'),
    ('c5900000-0000-4590-8000-000000000010'),
    ('c5900000-0000-4590-8000-000000000011');
  update public.profiles
  set    role                 = 'provider',
         languages            = array['en'],
         display_name         = 'Provider590-' || right(id::text, 2),
         date_of_birth        = date '1990-01-01',
         identity_verified_at = now()
  where  id in ('c5900000-0000-4590-8000-000000000010', 'c5900000-0000-4590-8000-000000000011');
  update public.profiles set promo_balance = 1000
  where id = 'c5900000-0000-4590-8000-000000000001';
  select test.accept_current_policies(id) from public.profiles where id::text like 'c5900000-%';

  insert into public.conversations (id, member_id, provider_id) values
    ('c5900000-0000-4590-8000-0000000000b1', 'c5900000-0000-4590-8000-000000000001',
     'c5900000-0000-4590-8000-000000000010'),
    ('c5900000-0000-4590-8000-0000000000b2', 'c5900000-0000-4590-8000-000000000001',
     'c5900000-0000-4590-8000-000000000011');
  insert into public.paid_sessions (
    id, conversation_id, channel, member_id, provider_id,
    rate_tokens_per_min, provider_share_percent, payout_hold_days,
    status, accepted_at, started_at, last_activity_at, next_bill_at,
    minutes_billed, tokens_debited
  ) values (
    'c5900000-0000-4590-8000-0000000000e1', 'c5900000-0000-4590-8000-0000000000b1', 'chat',
    'c5900000-0000-4590-8000-000000000001', 'c5900000-0000-4590-8000-000000000010',
    20, 60, 7, 'active',
    now() - interval '20 seconds', now() - interval '20 seconds', now(),
    now() + interval '40 seconds', 1, 20
  );
$sql$);
select test.dblink_disconnect('fx');

-- ── The race ───────────────────────────────────────────────────────────────
-- Returns 'delete=<OK or error>'.
create function test.race_590()
returns text
language plpgsql
as $$
declare
  v_dpid   integer;
  v_derror text;
begin
  perform test.dblink_reset();
  perform test.dblink_connect('h', test.conninfo_590());
  perform test.dblink_connect('d', test.conninfo_590());
  perform test.dblink_connect('i', test.conninfo_590());
  select pid into v_dpid from test.dblink('d', 'select pg_backend_pid()') as t(pid integer);
  -- A safety net, never the thing under test: nothing here should wait long.
  perform test.dblink_exec('d', 'set statement_timeout = 20000');

  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h',
    $q$select 1 from public.paid_sessions where id = 'c5900000-0000-4590-8000-0000000000e1' for update$q$
  ) as t(x integer);

  perform test.dblink_exec('d', 'begin');
  perform test.dblink_exec('d', 'set local role authenticated');
  perform test.dblink_exec('d', format('set local request.jwt.claims = %L',
    json_build_object('sub', 'c5900000-0000-4590-8000-000000000001', 'role', 'authenticated')::text));
  perform test.dblink_send_query('d', 'select public.delete_user_account()::text');
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_dpid and not granted);
    perform pg_sleep(0.02);
  end loop;

  -- S1 starts and commits while D is parked inside its first statement.
  perform test.dblink_exec('i', $sql$
    insert into public.paid_sessions (
      id, conversation_id, channel, member_id, provider_id,
      rate_tokens_per_min, provider_share_percent, payout_hold_days,
      status, accepted_at, started_at, last_activity_at, next_bill_at,
      minutes_billed, tokens_debited
    ) values (
      'c5900000-0000-4590-8000-0000000000e2', 'c5900000-0000-4590-8000-0000000000b2', 'chat',
      'c5900000-0000-4590-8000-000000000001', 'c5900000-0000-4590-8000-000000000011',
      20, 60, 7, 'active',
      now(), now(), now(), now() + interval '60 seconds', 1, 20
    )
  $sql$);

  perform test.dblink_exec('h', 'rollback');

  perform 1 from test.dblink_get_result('d', false) as t(v text);
  v_derror := test.dblink_error_message('d');
  perform 1 from test.dblink_get_result('d', false) as t(v text);
  perform test.dblink_exec('d', case when v_derror = 'OK' then 'commit' else 'rollback' end);

  perform test.dblink_disconnect('h');
  perform test.dblink_disconnect('d');
  perform test.dblink_disconnect('i');
  return 'delete=' || regexp_replace(split_part(v_derror, E'\n', 1), '^ERROR:\s+', '');
end;
$$;

select is(
  test.race_590(),
  'delete=OK',
  '1. an account deletion succeeds when a paid session starts while it takes its locks'
);
select is(
  (select status::text from public.paid_sessions where id = 'c5900000-0000-4590-8000-0000000000e2'),
  'ended',
  '2. the session that started mid-lock is ended, not left live for the cascade to refuse'
);
select is(
  (select status::text from public.paid_sessions where id = 'c5900000-0000-4590-8000-0000000000e1'),
  'ended',
  '3. and so is the session it locked first'
);
select is(
  (select count(*)::int from public.profiles where id = 'c5900000-0000-4590-8000-000000000001'),
  0,
  '4. the account is gone'
);

-- A session starting on every attempt cannot be staged from here without a
-- hook inside the function, so the bound is pinned where it is written: the
-- gap raises the retry code, and the third attempt refuses with 40001.
select ok(
  (select position('and  not (ps.id = any(v_locked))' in d) > 0
      and position('if v_attempt >= 3 then' in d) > position('exception when sqlstate ''P0011'' then' in d)
      and position('using errcode = ''40001''' in d) > position('if v_attempt >= 3 then' in d)
   from (select pg_get_functiondef('public.delete_user_account()'::regprocedure) as d) f),
  '5. the prologue retries a session that started in its gap, at most three times, then refuses with 40001'
);

select test.clean_590();

select * from finish();
rollback;
