-- pgTAP for 150's lock order, driven with real concurrent sessions.
--
-- A report and an account deletion used to take the same rows in opposite
-- orders: the report locked the story (and comment) FOR SHARE and then, at its
-- insert, the subject's profile through the foreign key check; the deletion
-- locks the profile first and then, through the cascade, that account's
-- stories and comments. Each could hold the row the other wanted next.
-- Postgres broke the deadlock by aborting one of them, and when it was the
-- report, the deletion then removed the story or comment with no report
-- filed: the evidence was lost at the moment somebody tried to keep it.
--
-- One session cannot race itself, so this file opens more with dblink: R
-- files the report as an authenticated member or provider, D deletes the
-- account, and H holds the story row FOR UPDATE. R is parked on H's lock,
-- after its profile locks and before its story lock; D is started and left
-- waiting on R's profile lock; then H lets go and both are read. Under the
-- old order the pair deadlocked (40P01 "while locking tuple ... in relation
-- profiles"); under 150's they both finish, the report first, and its
-- snapshot survives the cascade with its references set null.
--
-- (R used to be parked on the reporter's own advisory lock, which it took
-- after its row locks. 150 now takes that lock FIRST, before any row, so a
-- call it refuses holds none; parked there, R holds nothing yet, and the
-- deletion simply goes first. H's row lock is where every report path now
-- stands with its profiles locked, the report-and-delete's own path
-- included, so 5-6 park on the delete's own order as well.)
--
-- And, before the races, what 150's order is for (9-17): with the story row
-- held by H, a call that will be refused answers at once instead of joining
-- the queue for the row (a stranger's delete, a repeat delete of a tombstone,
-- a report over its budget or on a story the caller cannot see); a claim of
-- the purge (151) waits for a report that is between its checks and its
-- commit; and the comment cap holds for two posts released together.
--
-- The two sessions must see the fixture, so it is COMMITTED through a third
-- connection and removed again at the end (and at the start, in case an
-- earlier run died mid-way). Ids are 566's own. dblink lives in `test` and
-- goes with this transaction's rollback.
--
--   1-2. a story report vs the provider deleting their account
--   3-4. a comment report vs the commenter deleting theirs
--   5-6. the provider's report-and-delete vs the commenter deleting theirs
--        (end to end only: the report it files takes the profiles before
--        the pause, so the delete's OWN order, profiles before its story and
--        comment locks, cannot be parked on here and is pinned in 563's 39k)
--   7-8. a comment report vs the story's provider deleting theirs (the
--        report checks the provider's profile too: evidence_story_provider_id)
--   9-10.  a stranger's delete_story_comment, and the author's repeat delete
--          of a tombstone, take no lock
--   11-13. a report over the budget, on a story or a comment, and a report
--          on a story the caller cannot see, take no row lock
--   14.    a purge claim waits for a report_story holding the purge lock
--   15.    of two comments released together at the cap, exactly one lands
--   16-17. the comment and story caps' locks come before their counts
--   18-19. a comment report vs the story's provider deleting their account
--          through delete_user_account while a funded paid session owes a
--          minute: end_session's flush locks the MEMBER's profile before the
--          provider's own, and with the provider's id the lower a report
--          takes them the other way round. Parked on H's hold of the
--          provider's auth.users row, which the deletion reaches last, so the
--          deletion holds whatever it locked before it and the report is
--          sent into that. Under 100's body they deadlocked (40P01 "while
--          locking tuple ... in relation profiles"); under 150's the
--          deletion, which started first, finishes first, and the report is
--          refused because the story went with it.
--   20-21. the hourly purge of an expired, reported story vs its provider
--          deleting their account. The profiles cascade sets the reports
--          null (locking them) before it reaches the stories, and a story
--          delete takes the story, its views, and then its reports: parked
--          by H on one of the story's views, the two deadlocked ("while
--          deleting tuple ... in relation stories") and the deletion was
--          aborted. delete_user_account now deletes its stories first.
--   22-23. the provider's own delete of a story vs a viewer who reported it
--          deleting their account: the viewer's cascade locked their report
--          and then their view, the story delete the view and then the
--          report. Parked by H on a comment of the story, they deadlocked
--          ("while deleting tuple ... in relation story_views"). The deletion
--          now removes its views, reactions and comments first.
--   24.    mark_story_viewed vs the story's provider deleting their account
--          mid-session. The deletion's prologue holds the member's profile,
--          and the view's insert locked the story (its foreign key) and then
--          that profile; the deletion's cascade then waited on the story.
--          The view now takes its own profile first, so it waits for the
--          deletion and finds the story gone.
--   25-26. the same order pinned where it sits for the other story writers,
--          which one session cannot race without the same fixture again:
--          the caller's profile before the story, and a block's two
--          profiles in id order before its insert.

\set ON_ERROR_STOP on
begin;
create extension if not exists dblink with schema test;
select plan(26);

create function test.conninfo()
returns text
language sql
as $$
  select format(
    'dbname=%s user=%s port=%s host=%s',
    current_database(), current_user, current_setting('port'),
    split_part(current_setting('unix_socket_directories'), ',', 1)
  );
$$;

-- Everything 566 ever committed, gone. Reports first: their reporter is not
-- deleted by any race, so they would outlive the accounts.
create function test.clean_566()
returns void
language plpgsql
as $$
begin
  perform test.dblink_connect('fx', test.conninfo());
  perform test.dblink_exec('fx', $sql$
    delete from public.reports where reporter_id::text like 'c5660000-%';
    -- 20-23's reports lose their reporter or subject to the races.
    delete from public.reports where id::text like 'c5660000-%';
    delete from auth.users where id::text like 'c5660000-%';
    delete from public.story_media_released where name like 'c5660000-%';
    -- The billing record of 18-19's session outlives both accounts on
    -- purpose (100), so it is removed here by its own ids.
    delete from public.provider_earnings_ledger where session_id::text like 'c5660000-%';
    delete from public.token_transactions where session_id::text like 'c5660000-%';
    delete from public.paid_sessions where id::text like 'c5660000-%';
  $sql$);
  perform test.dblink_disconnect('fx');
end;
$$;

select test.clean_566();

-- ── The committed fixture ──────────────────────────────────────────────────
select test.dblink_connect('fx', test.conninfo());
select test.dblink_exec('fx', $sql$
  insert into auth.users (id) values
    ('c5660000-0000-4566-8000-000000000001'),  -- member M, reports
    ('c5660000-0000-4566-8000-000000000002'),  -- member C, comments (3-4)
    ('c5660000-0000-4566-8000-000000000003'),  -- member C2, comments (5-6)
    ('c5660000-0000-4566-8000-000000000004'),  -- member C3, comments (7-8)
    ('c5660000-0000-4566-8000-000000000010'),  -- provider P, deletes (1-2)
    ('c5660000-0000-4566-8000-000000000011'),  -- provider P2 (3-4)
    ('c5660000-0000-4566-8000-000000000012'),  -- provider P3, reports-and-deletes (5-6)
    ('c5660000-0000-4566-8000-000000000013'),  -- provider P4, deletes (7-8)
    ('c5660000-0000-4566-8000-000000000014'),  -- provider P5, story a5 (9-15)
    ('c5660000-0000-4566-8000-000000000005'),  -- member X, over the report budget (11-12)
    ('c5660000-0000-4566-8000-000000000006'),  -- member S, a stranger to c5 (9), reports a5 (14)
    ('c5660000-0000-4566-8000-000000000007'),  -- member C5, wrote c5 and the tombstone c6 (10)
    ('c5660000-0000-4566-8000-000000000008'),  -- member B, blocked by P5 (13)
    ('c5660000-0000-4566-8000-000000000009');  -- member W, one comment short of a5's cap (15)

  update public.profiles
  set    role                 = 'provider',
         languages            = array['en'],
         display_name         = 'Provider566-' || right(id::text, 2),
         date_of_birth        = date '1990-01-01',
         identity_verified_at = now()
  where  id::text like 'c5660000-0000-4566-8000-00000000001_';

  select test.accept_current_policies(id) from public.profiles where id::text like 'c5660000-%';

  insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms,
                              created_at, expires_at)
  select ('c5660000-0000-4566-8000-0000000000a' || n)::uuid,
         ('c5660000-0000-4566-8000-00000000001' || (n - 1))::uuid,
         'image',
         'c5660000-0000-4566-8000-00000000001' || (n - 1)
           || '/c5660000-0000-4566-8000-0000000000a' || n || '.jpg',
         'story ' || n, 7000,
         now() - interval '1 hour', now() + interval '23 hours'
  from generate_series(1, 5) n;

  insert into public.story_comments (id, story_id, author_id, body) values
    ('c5660000-0000-4566-8000-0000000000c2', 'c5660000-0000-4566-8000-0000000000a2',
     'c5660000-0000-4566-8000-000000000002', 'reported as its author leaves'),
    ('c5660000-0000-4566-8000-0000000000c3', 'c5660000-0000-4566-8000-0000000000a3',
     'c5660000-0000-4566-8000-000000000003', 'reported and deleted as its author leaves'),
    ('c5660000-0000-4566-8000-0000000000c4', 'c5660000-0000-4566-8000-0000000000a4',
     'c5660000-0000-4566-8000-000000000004', 'reported as the provider leaves'),
    ('c5660000-0000-4566-8000-0000000000c5', 'c5660000-0000-4566-8000-0000000000a5',
     'c5660000-0000-4566-8000-000000000007', 'live, and not the stranger''s');
  insert into public.story_comments (id, story_id, author_id, body, deleted_at) values
    ('c5660000-0000-4566-8000-0000000000c6', 'c5660000-0000-4566-8000-0000000000a5',
     'c5660000-0000-4566-8000-000000000007', null, now());
  insert into public.story_comments (story_id, author_id, body)
  select 'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000009', 'w' || n
  from generate_series(1, 4) n;

  insert into public.blocks (blocker_id, blocked_id) values
    ('c5660000-0000-4566-8000-000000000014', 'c5660000-0000-4566-8000-000000000008');

  -- X has spent the hour's budget.
  insert into public.reports (reporter_id, reason, created_at)
  select 'c5660000-0000-4566-8000-000000000005', 'spam', now() - interval '10 minutes'
  from generate_series(1, 10);
$sql$);
-- 18-19: provider P6 (015, the lower id) with a story, and member M6 (020),
-- funded, who commented on it and is in a live paid session with P6 whose
-- next minute was due ten seconds ago, so end_session's flush debits M6.
select test.dblink_exec('fx', $sql$
  insert into auth.users (id) values
    ('c5660000-0000-4566-8000-000000000015'),  -- provider P6, deletes (18-19)
    ('c5660000-0000-4566-8000-000000000020');  -- member M6, in P6's session
  update public.profiles
  set    role                 = 'provider',
         languages            = array['en'],
         display_name         = 'Provider566-15',
         date_of_birth        = date '1990-01-01',
         identity_verified_at = now()
  where  id = 'c5660000-0000-4566-8000-000000000015';
  update public.profiles set promo_balance = 1000
  where id = 'c5660000-0000-4566-8000-000000000020';
  select test.accept_current_policies(id) from public.profiles
  where id in ('c5660000-0000-4566-8000-000000000015', 'c5660000-0000-4566-8000-000000000020');

  insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms,
                              created_at, expires_at)
  values ('c5660000-0000-4566-8000-0000000000a6', 'c5660000-0000-4566-8000-000000000015', 'image',
          'c5660000-0000-4566-8000-000000000015/c5660000-0000-4566-8000-0000000000a6.jpg',
          'story 6', 7000, now() - interval '1 hour', now() + interval '23 hours');
  insert into public.story_comments (id, story_id, author_id, body) values
    ('c5660000-0000-4566-8000-0000000000c7', 'c5660000-0000-4566-8000-0000000000a6',
     'c5660000-0000-4566-8000-000000000020', 'reported as the provider leaves mid-session');

  insert into public.conversations (id, member_id, provider_id) values
    ('c5660000-0000-4566-8000-0000000000b6', 'c5660000-0000-4566-8000-000000000020',
     'c5660000-0000-4566-8000-000000000015');
  insert into public.paid_sessions (
    id, conversation_id, channel, member_id, provider_id,
    rate_tokens_per_min, provider_share_percent, payout_hold_days,
    status, accepted_at, started_at, last_activity_at, next_bill_at,
    minutes_billed, tokens_debited
  ) values (
    'c5660000-0000-4566-8000-0000000000e6', 'c5660000-0000-4566-8000-0000000000b6', 'chat',
    'c5660000-0000-4566-8000-000000000020', 'c5660000-0000-4566-8000-000000000015',
    20, 60, 7, 'active',
    now() - interval '70 seconds', now() - interval '70 seconds', now(),
    now() - interval '10 seconds', 1, 20
  );
$sql$);
-- 20-24: provider P7 (021) with an expired story a7 that member C5 viewed
-- and reported; provider P8 (022) with a live story a8 that member M8 (023)
-- viewed and reported, and M commented on; provider P9 (024) with a live
-- story a9 and a live, funded session with member M9 (025).
select test.dblink_exec('fx', $sql$
  insert into auth.users (id) values
    ('c5660000-0000-4566-8000-000000000021'),
    ('c5660000-0000-4566-8000-000000000022'),
    ('c5660000-0000-4566-8000-000000000023'),
    ('c5660000-0000-4566-8000-000000000024'),
    ('c5660000-0000-4566-8000-000000000025');
  update public.profiles
  set    role                 = 'provider',
         languages            = array['en'],
         display_name         = 'Provider566-' || right(id::text, 2),
         date_of_birth        = date '1990-01-01',
         identity_verified_at = now()
  where  id in ('c5660000-0000-4566-8000-000000000021', 'c5660000-0000-4566-8000-000000000022',
                'c5660000-0000-4566-8000-000000000024');
  update public.profiles set promo_balance = 1000
  where id = 'c5660000-0000-4566-8000-000000000025';
  select test.accept_current_policies(id) from public.profiles
  where id::text like 'c5660000-0000-4566-8000-00000000002_';

  insert into public.stories (id, provider_id, media_type, media_path, caption, duration_ms,
                              created_at, expires_at) values
    ('c5660000-0000-4566-8000-0000000000a7', 'c5660000-0000-4566-8000-000000000021', 'image',
     'c5660000-0000-4566-8000-000000000021/c5660000-0000-4566-8000-0000000000a7.jpg',
     'story 7', 7000, now() - interval '25 hours', now() - interval '1 hour'),
    ('c5660000-0000-4566-8000-0000000000a8', 'c5660000-0000-4566-8000-000000000022', 'image',
     'c5660000-0000-4566-8000-000000000022/c5660000-0000-4566-8000-0000000000a8.jpg',
     'story 8', 7000, now() - interval '1 hour', now() + interval '23 hours'),
    ('c5660000-0000-4566-8000-0000000000a9', 'c5660000-0000-4566-8000-000000000024', 'image',
     'c5660000-0000-4566-8000-000000000024/c5660000-0000-4566-8000-0000000000a9.jpg',
     'story 9', 7000, now() - interval '1 hour', now() + interval '23 hours');
  insert into public.story_views (story_id, viewer_id) values
    ('c5660000-0000-4566-8000-0000000000a7', 'c5660000-0000-4566-8000-000000000007'),
    ('c5660000-0000-4566-8000-0000000000a8', 'c5660000-0000-4566-8000-000000000023');
  insert into public.story_comments (id, story_id, author_id, body) values
    ('c5660000-0000-4566-8000-0000000000c8', 'c5660000-0000-4566-8000-0000000000a8',
     'c5660000-0000-4566-8000-000000000001', 'on a story its provider deletes');
  insert into public.reports (id, reporter_id, subject_user_id, reason, story_id,
                              evidence_surface, evidence_story_media_path) values
    ('c5660000-0000-4566-8000-0000000000f7', 'c5660000-0000-4566-8000-000000000007',
     'c5660000-0000-4566-8000-000000000021', 'harassment', 'c5660000-0000-4566-8000-0000000000a7',
     'story', 'c5660000-0000-4566-8000-000000000021/c5660000-0000-4566-8000-0000000000a7.jpg'),
    ('c5660000-0000-4566-8000-0000000000f8', 'c5660000-0000-4566-8000-000000000023',
     'c5660000-0000-4566-8000-000000000022', 'harassment', 'c5660000-0000-4566-8000-0000000000a8',
     'story', 'c5660000-0000-4566-8000-000000000022/c5660000-0000-4566-8000-0000000000a8.jpg');

  insert into public.conversations (id, member_id, provider_id) values
    ('c5660000-0000-4566-8000-0000000000b9', 'c5660000-0000-4566-8000-000000000025',
     'c5660000-0000-4566-8000-000000000024');
  insert into public.paid_sessions (
    id, conversation_id, channel, member_id, provider_id,
    rate_tokens_per_min, provider_share_percent, payout_hold_days,
    status, accepted_at, started_at, last_activity_at, next_bill_at,
    minutes_billed, tokens_debited
  ) values (
    'c5660000-0000-4566-8000-0000000000e9', 'c5660000-0000-4566-8000-0000000000b9', 'chat',
    'c5660000-0000-4566-8000-000000000025', 'c5660000-0000-4566-8000-000000000024',
    20, 60, 7, 'active',
    now() - interval '20 seconds', now() - interval '20 seconds', now(),
    now() + interval '40 seconds', 1, 20
  );
$sql$);
select test.dblink_disconnect('fx');

-- ── Two deletions parked on a third ────────────────────────────────────────
-- H runs p_hold (a row lock) and keeps it; A runs p_first as p_first_uid (or
-- as the owner, when null) and is left waiting on it; B runs p_second as
-- p_second_uid and is left waiting too; H lets go and both are read.
-- Returns 'first=<OK or error>|second=<OK or error>'.
create function test.race_behind(
  p_hold text, p_first_uid uuid, p_first text, p_second_uid uuid, p_second text)
returns text
language plpgsql
as $$
declare
  v_apid   integer;
  v_bpid   integer;
  v_aerror text;
  v_berror text;
begin
  perform test.dblink_connect('h', test.conninfo());
  perform test.dblink_connect('a', test.conninfo());
  perform test.dblink_connect('b', test.conninfo());
  select pid into v_apid from test.dblink('a', 'select pg_backend_pid()') as t(pid integer);
  select pid into v_bpid from test.dblink('b', 'select pg_backend_pid()') as t(pid integer);
  perform test.dblink_exec('a', 'set statement_timeout = 20000');
  perform test.dblink_exec('b', 'set statement_timeout = 20000');

  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h', p_hold) as t(x integer);

  perform test.dblink_exec('a', 'begin');
  if p_first_uid is not null then
    perform test.dblink_exec('a', 'set local role authenticated');
    perform test.dblink_exec('a', format('set local request.jwt.claims = %L',
      json_build_object('sub', p_first_uid, 'role', 'authenticated')::text));
  end if;
  perform test.dblink_send_query('a', p_first);
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_apid and not granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_exec('b', 'begin');
  perform test.dblink_exec('b', 'set local role authenticated');
  perform test.dblink_exec('b', format('set local request.jwt.claims = %L',
    json_build_object('sub', p_second_uid, 'role', 'authenticated')::text));
  perform test.dblink_send_query('b', p_second);
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_bpid and not granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_exec('h', 'rollback');

  perform 1 from test.dblink_get_result('a', false) as t(v text);
  v_aerror := test.dblink_error_message('a');
  perform 1 from test.dblink_get_result('a', false) as t(v text);
  perform test.dblink_exec('a', case when v_aerror = 'OK' then 'commit' else 'rollback' end);

  perform 1 from test.dblink_get_result('b', false) as t(v text);
  v_berror := test.dblink_error_message('b');
  perform 1 from test.dblink_get_result('b', false) as t(v text);
  perform test.dblink_exec('b', case when v_berror = 'OK' then 'commit' else 'rollback' end);

  perform test.dblink_disconnect('h');
  perform test.dblink_disconnect('a');
  perform test.dblink_disconnect('b');
  return 'first=' || regexp_replace(split_part(v_aerror, E'\n', 1), '^ERROR:\s+', '')
      || '|second=' || regexp_replace(split_part(v_berror, E'\n', 1), '^ERROR:\s+', '');
end;
$$;

-- ── Answering while the story row is held ─────────────────────────────────
-- H holds p_story FOR UPDATE; X runs p_call as p_caller with a 2 s timeout.
-- A call that takes no row lock answers at once; one that joins the queue for
-- the story row times out. Returns the answer, or the error.
create function test.answer_while_held(p_story uuid, p_caller uuid, p_call text)
returns text
language plpgsql
as $$
declare
  v_result text;
  v_error  text;
begin
  perform test.dblink_connect('h', test.conninfo());
  perform test.dblink_connect('x', test.conninfo());
  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h', format(
    'select 1 from public.stories where id = %L for update', p_story)) as t(x integer);

  perform test.dblink_exec('x', 'set statement_timeout = 2000');
  perform test.dblink_exec('x', 'begin');
  perform test.dblink_exec('x', 'set local role authenticated');
  perform test.dblink_exec('x', format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', p_caller, 'role', 'authenticated')::text));
  select t.v into v_result from test.dblink('x', p_call, false) as t(v text);
  v_error := test.dblink_error_message('x');
  perform test.dblink_exec('x', 'rollback');
  perform test.dblink_exec('h', 'rollback');
  perform test.dblink_disconnect('x');
  perform test.dblink_disconnect('h');
  return case when v_error = 'OK' then v_result else v_error end;
end;
$$;

-- ── The race ───────────────────────────────────────────────────────────────
-- R runs p_call as p_caller and is parked on H's lock of p_story, with its
-- profile locks taken; D deletes p_leaving and waits on them; H lets go and
-- both are read. Returns 'report=<result or error>|delete=<OK or error>'.
create function test.race(p_caller uuid, p_call text, p_leaving uuid, p_story uuid)
returns text
language plpgsql
as $$
declare
  v_rpid    integer;
  v_dpid    integer;
  v_result  text;
  v_rerror  text;
  v_derror  text;
begin
  perform test.dblink_connect('h', test.conninfo());
  perform test.dblink_connect('r', test.conninfo());
  perform test.dblink_connect('d', test.conninfo());
  select pid into v_rpid from test.dblink('r', 'select pg_backend_pid()') as t(pid integer);
  select pid into v_dpid from test.dblink('d', 'select pg_backend_pid()') as t(pid integer);
  -- A safety net, never the thing under test: nothing here should wait long.
  perform test.dblink_exec('r', 'set statement_timeout = 20000');
  perform test.dblink_exec('d', 'set statement_timeout = 20000');

  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h', format(
    'select 1 from public.stories where id = %L for update', p_story)) as t(x integer);

  perform test.dblink_exec('r', 'begin');
  perform test.dblink_exec('r', 'set local role authenticated');
  perform test.dblink_exec('r', format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', p_caller, 'role', 'authenticated')::text));
  perform test.dblink_send_query('r', p_call);
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_rpid and not granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_send_query('d', format('delete from auth.users where id = %L', p_leaving));
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_dpid and not granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_exec('h', 'rollback');

  select t.v into v_result from test.dblink_get_result('r', false) as t(v text);
  v_rerror := test.dblink_error_message('r');
  perform 1 from test.dblink_get_result('r', false) as t(v text);
  perform test.dblink_exec('r', case when v_rerror = 'OK' then 'commit' else 'rollback' end);

  perform 1 from test.dblink_get_result('d', false) as t(v text);
  v_derror := test.dblink_error_message('d');
  perform 1 from test.dblink_get_result('d', false) as t(v text);

  perform test.dblink_disconnect('h');
  perform test.dblink_disconnect('r');
  perform test.dblink_disconnect('d');
  return 'report=' || case when v_rerror = 'OK' then 'filed' else v_rerror end
      || '|delete=' || v_derror;
end;
$$;

-- ── The race, through delete_user_account ─────────────────────────────────
-- H holds p_leaving's auth.users row FOR KEY SHARE. D runs
-- delete_user_account() as p_leaving and is left waiting on it, at the delete
-- that comes after its session flush, holding everything it locked before.
-- R then runs p_call as p_caller and is left waiting (or finishes); H lets go
-- and both are read. Returns 'report=<filed or error>|delete=<OK or error>'.
create function test.race_deletion(p_caller uuid, p_call text, p_leaving uuid)
returns text
language plpgsql
as $$
declare
  v_rpid    integer;
  v_dpid    integer;
  v_rerror  text;
  v_derror  text;
begin
  perform test.dblink_connect('h', test.conninfo());
  perform test.dblink_connect('r', test.conninfo());
  perform test.dblink_connect('d', test.conninfo());
  select pid into v_rpid from test.dblink('r', 'select pg_backend_pid()') as t(pid integer);
  select pid into v_dpid from test.dblink('d', 'select pg_backend_pid()') as t(pid integer);
  perform test.dblink_exec('r', 'set statement_timeout = 20000');
  perform test.dblink_exec('d', 'set statement_timeout = 20000');

  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h', format(
    'select 1 from auth.users where id = %L for key share', p_leaving)) as t(x integer);

  perform test.dblink_exec('d', 'begin');
  perform test.dblink_exec('d', 'set local role authenticated');
  perform test.dblink_exec('d', format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', p_leaving, 'role', 'authenticated')::text));
  perform test.dblink_send_query('d', 'select public.delete_user_account()::text');
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_dpid and not granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_exec('r', 'begin');
  perform test.dblink_exec('r', 'set local role authenticated');
  perform test.dblink_exec('r', format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', p_caller, 'role', 'authenticated')::text));
  perform test.dblink_send_query('r', p_call);
  for i in 1..250 loop
    exit when exists (select 1 from pg_locks where pid = v_rpid and not granted)
           or test.dblink_is_busy('r') = 0;
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_exec('h', 'rollback');

  perform 1 from test.dblink_get_result('d', false) as t(v text);
  v_derror := test.dblink_error_message('d');
  perform 1 from test.dblink_get_result('d', false) as t(v text);
  perform test.dblink_exec('d', case when v_derror = 'OK' then 'commit' else 'rollback' end);

  perform 1 from test.dblink_get_result('r', false) as t(v text);
  v_rerror := test.dblink_error_message('r');
  perform 1 from test.dblink_get_result('r', false) as t(v text);
  perform test.dblink_exec('r', case when v_rerror = 'OK' then 'commit' else 'rollback' end);

  perform test.dblink_disconnect('h');
  perform test.dblink_disconnect('r');
  perform test.dblink_disconnect('d');
  return 'report=' || case when v_rerror = 'OK' then 'filed'
                           else regexp_replace(split_part(v_rerror, E'\n', 1), '^ERROR:\s+', '') end
      || '|delete=' || v_derror;
end;
$$;

-- ── A refused call takes no lock (150) ─────────────────────────────────────
-- A stranger's delete used to lock three profiles, the story and the comment
-- before it said FORBIDDEN, and five of them looping on one comment kept the
-- provider's delete of the story from ever getting in.
select is(
  test.answer_while_held(
    'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000006',
    $$select public.delete_story_comment('c5660000-0000-4566-8000-0000000000c5')::text$$),
  '{"success" : false, "error" : "FORBIDDEN"}',
  '9. a stranger''s delete is refused without waiting on the story'
);
select is(
  test.answer_while_held(
    'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000007',
    $$select public.delete_story_comment('c5660000-0000-4566-8000-0000000000c6')::text$$),
  '{"success" : true, "report_id" : null}',
  '10. the author''s repeat delete of a tombstone is answered without a lock, so a loop of it holds nothing'
);
-- Over the budget: it used to lock the profiles and the story FOR SHARE and
-- only then wait for its own lock and count.
select ok(
  test.answer_while_held(
    'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000005',
    $$select public.report_story('c5660000-0000-4566-8000-0000000000a5', 'spam')::text$$)
  like '%too many reports%',
  '11. a story report over the budget is refused without waiting on the story'
);
select ok(
  test.answer_while_held(
    'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000005',
    $$select public.report_story_comment('c5660000-0000-4566-8000-0000000000c5', 'spam')::text$$)
  like '%too many reports%',
  '12. so is a comment report over the budget'
);
select ok(
  test.answer_while_held(
    'c5660000-0000-4566-8000-0000000000a5', 'c5660000-0000-4566-8000-000000000008',
    $$select public.report_story('c5660000-0000-4566-8000-0000000000a5', 'spam')::text$$)
  like '%no such story%',
  '13. and a report on a story the caller cannot see, before any row is locked'
);

-- ── A purge claim waits for a report between its checks and its commit ────
-- R (member S) reports a5 and is parked on H's lock of the story, holding the purge
-- lock shared (150). A claim (151) takes that lock exclusively before it
-- lists what to remove, so it must wait for R; without the shared lock it
-- ran, and an expired story's object could be handed to the Edge Function
-- while R went on to commit a report naming it.
create function test.claim_waits_for_report()
returns text
language plpgsql
as $$
declare
  v_cpid   integer;
  v_waited boolean := false;
  v_rerror text;
begin
  perform test.dblink_connect('h', test.conninfo());
  perform test.dblink_connect('r', test.conninfo());
  perform test.dblink_connect('c', test.conninfo());
  select pid into v_cpid from test.dblink('c', 'select pg_backend_pid()') as t(pid integer);
  perform test.dblink_exec('r', 'set statement_timeout = 20000');
  perform test.dblink_exec('c', 'set statement_timeout = 20000');

  perform test.dblink_exec('h', 'begin');
  perform 1 from test.dblink('h',
    'select 1 from public.stories where id = ''c5660000-0000-4566-8000-0000000000a5'' for update')
    as t(x integer);

  perform test.dblink_exec('r', 'begin');
  perform test.dblink_exec('r', 'set local role authenticated');
  perform test.dblink_exec('r', format(
    'set local request.jwt.claims = %L',
    json_build_object('sub', 'c5660000-0000-4566-8000-000000000006', 'role', 'authenticated')::text));
  perform test.dblink_send_query('r',
    $q$select public.report_story('c5660000-0000-4566-8000-0000000000a5', 'harassment')::text$q$);
  for i in 1..250 loop
    exit when exists (
      select 1 from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where a.query like '%report_story(%' and a.pid <> pg_backend_pid() and not l.granted);
    perform pg_sleep(0.02);
  end loop;

  perform test.dblink_send_query('c', 'select count(*)::text from public.claim_story_objects_to_purge(1000)');
  for i in 1..100 loop
    if exists (select 1 from pg_locks where pid = v_cpid and locktype = 'advisory' and not granted) then
      v_waited := true;
      exit;
    end if;
    exit when test.dblink_is_busy('c') = 0;
    perform pg_sleep(0.02);
  end loop;
  if v_waited then
    perform pg_cancel_backend(v_cpid);
  end if;
  perform 1 from test.dblink_get_result('c', false) as t(v text);
  perform 1 from test.dblink_get_result('c', false) as t(v text);

  perform test.dblink_exec('h', 'rollback');
  perform 1 from test.dblink_get_result('r', false) as t(v text);
  v_rerror := test.dblink_error_message('r');
  perform 1 from test.dblink_get_result('r', false) as t(v text);
  perform test.dblink_exec('r', case when v_rerror = 'OK' then 'commit' else 'rollback' end);

  perform test.dblink_disconnect('h');
  perform test.dblink_disconnect('r');
  perform test.dblink_disconnect('c');
  return 'claim=' || case when v_waited then 'waited' else 'ran' end
      || '|report=' || case when v_rerror = 'OK' then 'filed' else v_rerror end;
end;
$$;

select is(
  test.claim_waits_for_report(),
  'claim=waited|report=filed',
  '14. a purge claim waits for a story report that is between its checks and its commit'
);

-- ── The comment cap holds for two posts released together ─────────────────
-- W has four comments on a5, one short of the five-per-story cap. Two posts
-- are parked on W's comment lock (147), which this session holds, and let go
-- together. Each waits for the other's commit before it counts, so exactly
-- one lands; without the lock both counted four and both went in.
create function test.two_posts_at_the_cap()
returns text
language plpgsql
as $$
declare
  v_lock   bigint := hashtextextended('story_comment:c5660000-0000-4566-8000-000000000009', 0);
  v_pids   integer[] := '{}';
  v_pid    integer;
  v_left   text[] := array['p1', 'p2'];
  v_out    text[] := '{}';
  v_result text;
  v_conn   text;
begin
  perform pg_advisory_lock(v_lock);
  foreach v_conn in array v_left loop
    perform test.dblink_connect(v_conn, test.conninfo());
    select pid into v_pid from test.dblink(v_conn, 'select pg_backend_pid()') as t(pid integer);
    v_pids := v_pids || v_pid;
    perform test.dblink_exec(v_conn, 'set statement_timeout = 20000');
    perform test.dblink_exec(v_conn, 'begin');
    perform test.dblink_exec(v_conn, 'set local role authenticated');
    perform test.dblink_exec(v_conn, format(
      'set local request.jwt.claims = %L',
      json_build_object('sub', 'c5660000-0000-4566-8000-000000000009', 'role', 'authenticated')::text));
    perform test.dblink_send_query(v_conn, format(
      'select public.post_story_comment(gen_random_uuid(), %L, %L) ->> %L',
      'c5660000-0000-4566-8000-0000000000a5', 'at the cap, ' || v_conn, 'error'));
  end loop;
  for i in 1..250 loop
    exit when (select count(distinct pid) from pg_locks
               where pid = any (v_pids) and locktype = 'advisory' and not granted) = 2;
    perform pg_sleep(0.02);
  end loop;
  perform pg_advisory_unlock(v_lock);

  -- Whichever finishes first commits first; the other is waiting for it.
  for i in 1..500 loop
    exit when array_length(v_left, 1) is null;
    foreach v_conn in array v_left loop
      if test.dblink_is_busy(v_conn) = 0 then
        select t.v into v_result from test.dblink_get_result(v_conn, false) as t(v text);
        v_out := v_out || coalesce(v_result, 'posted');
        perform 1 from test.dblink_get_result(v_conn, false) as t(v text);
        perform test.dblink_exec(v_conn, 'commit');
        perform test.dblink_disconnect(v_conn);
        v_left := array_remove(v_left, v_conn);
      end if;
    end loop;
    perform pg_sleep(0.02);
  end loop;
  return (select string_agg(x, ',' order by x) from unnest(v_out) x)
      || '|' || (select count(*)::int from public.story_comments
                 where story_id = 'c5660000-0000-4566-8000-0000000000a5'
                   and author_id = 'c5660000-0000-4566-8000-000000000009');
end;
$$;

select is(
  test.two_posts_at_the_cap(),
  'RATE_LIMITED,posted|5',
  '15. of two comments released together at the cap, exactly one lands'
);

-- One session cannot race create_story's cap without a storage stand-in, so
-- both locks are also pinned where they sit: before the retry read and the
-- count, which is the only place a lock makes a count hold.
select ok(
  (select position(l in d) > 0
      and position(l in d) < position('select * into v_comment from public.story_comments where id = p_comment_id' in d)
      and position(l in d) < position('count(*) filter' in d)
   from (select pg_get_functiondef('public.post_story_comment(uuid, uuid, text)'::regprocedure) as d,
                'pg_advisory_xact_lock(hashtextextended(''story_comment:'' || v_uid::text, 0))' as l) f),
  '16. post_story_comment takes the author''s lock before the retry read and the count'
);
select ok(
  (select position(l in d) > 0
      and position(l in d) < position('select * into v_existing from public.stories where id = p_story_id' in d)
      and position(l in d) < position('count(*)' in d)
   from (select pg_get_functiondef('public.create_story(uuid, text, text, text, integer)'::regprocedure) as d,
                'pg_advisory_xact_lock(hashtextextended(''story_cap:'' || v_uid::text, 0))' as l) f),
  '17. create_story takes the provider''s lock before the retry read and the count'
);

-- 1-2. A story report while its provider deletes their account.
select is(
  test.race(
    'c5660000-0000-4566-8000-000000000001',
    $$select public.report_story('c5660000-0000-4566-8000-0000000000a1', 'harassment')::text$$,
    'c5660000-0000-4566-8000-000000000010', 'c5660000-0000-4566-8000-0000000000a1'),
  'report=filed|delete=OK',
  '1. a story report and its provider''s account deletion both finish: no deadlock'
);
select is(
  (select coalesce(subject_user_id::text, 'null') || '|' || coalesce(story_id::text, 'null')
          || '|' || evidence_story_media_path || '|' || evidence_body
   from public.reports
   where reporter_id = 'c5660000-0000-4566-8000-000000000001' and evidence_surface = 'story'),
  'null|null|c5660000-0000-4566-8000-000000000010/c5660000-0000-4566-8000-0000000000a1.jpg|story 1',
  '2. ...and the report keeps its evidence past the cascade'
);

-- 3-4. A comment report while its author deletes their account.
select is(
  test.race(
    'c5660000-0000-4566-8000-000000000001',
    $$select public.report_story_comment('c5660000-0000-4566-8000-0000000000c2', 'harassment')::text$$,
    'c5660000-0000-4566-8000-000000000002', 'c5660000-0000-4566-8000-0000000000a2'),
  'report=filed|delete=OK',
  '3. a comment report and its author''s account deletion both finish'
);
select is(
  (select evidence_body || '|' || coalesce(story_comment_id::text, 'null')
   from public.reports
   where reporter_id = 'c5660000-0000-4566-8000-000000000001'
     and evidence_context = 'story 2'),
  'reported as its author leaves|null',
  '4. ...with the words kept and the comment reference set null'
);

-- 5-6. The provider's report-and-delete while the author deletes theirs.
select is(
  test.race(
    'c5660000-0000-4566-8000-000000000012',
    $$select public.delete_story_comment('c5660000-0000-4566-8000-0000000000c3', 'harassment')::text$$,
    'c5660000-0000-4566-8000-000000000003', 'c5660000-0000-4566-8000-0000000000a3'),
  'report=filed|delete=OK',
  '5. a provider''s report-and-delete and the author''s account deletion both finish'
);
select is(
  (select evidence_body from public.reports
   where reporter_id = 'c5660000-0000-4566-8000-000000000012'),
  'reported and deleted as its author leaves',
  '6. ...and the report holds the words the tombstone erased'
);

-- 7-8. A comment report while the story's provider deletes theirs.
select is(
  test.race(
    'c5660000-0000-4566-8000-000000000001',
    $$select public.report_story_comment('c5660000-0000-4566-8000-0000000000c4', 'spam')::text$$,
    'c5660000-0000-4566-8000-000000000013', 'c5660000-0000-4566-8000-0000000000a4'),
  'report=filed|delete=OK',
  '7. a comment report and the story provider''s account deletion both finish'
);
select is(
  (select evidence_body || '|' || coalesce(evidence_story_provider_id::text, 'null')
   from public.reports
   where reporter_id = 'c5660000-0000-4566-8000-000000000001'
     and evidence_context = 'story 4'),
  'reported as the provider leaves|null',
  '8. ...kept, with the departed provider set null as the subject would be'
);

-- 18-19. A comment report while the story's provider deletes their account
-- with a funded session still owed a minute.
select is(
  test.race_deletion(
    'c5660000-0000-4566-8000-000000000001',
    $$select public.report_story_comment('c5660000-0000-4566-8000-0000000000c7', 'harassment')::text$$,
    'c5660000-0000-4566-8000-000000000015'),
  'report=no such comment|delete=OK',
  '18. a comment report and a provider''s deletion that ends a funded session both finish: no deadlock'
);
select is(
  (select status::text || '|' || minutes_billed || '|' || coalesce(provider_id::text, 'null')
   from public.paid_sessions where id = 'c5660000-0000-4566-8000-0000000000e6')
  || '|' || (select promo_balance from public.profiles where id = 'c5660000-0000-4566-8000-000000000020'),
  'ended|2|null|980',
  '19. ...and the deletion did all of its work: the owed minute billed, the session ended, the provider gone'
);

-- 20-21. The hourly purge of a7, reported and expired, parked on H's lock of
-- C5's view of it, while a7's provider deletes their account.
select is(
  test.race_behind(
    $$select 1 from public.story_views
      where story_id = 'c5660000-0000-4566-8000-0000000000a7' for update$$,
    null, 'select public.purge_expired_stories()::text',
    'c5660000-0000-4566-8000-000000000021', 'select public.delete_user_account()::text'),
  'first=OK|second=OK',
  '20. the purge of a reported story and its provider''s account deletion both finish: no deadlock'
);
select is(
  (select coalesce(story_id::text, 'null') || '|' || coalesce(subject_user_id::text, 'null')
          || '|' || evidence_story_media_path
   from public.reports where id = 'c5660000-0000-4566-8000-0000000000f7')
  || '|' || (select count(*)::int from auth.users where id = 'c5660000-0000-4566-8000-000000000021'),
  'null|null|c5660000-0000-4566-8000-000000000021/c5660000-0000-4566-8000-0000000000a7.jpg|0',
  '21. ...the account is gone and the report keeps its evidence'
);

-- 22-23. P8 deletes a8, parked on H's lock of M's comment on it, while M8,
-- who viewed and reported a8, deletes their account.
select is(
  test.race_behind(
    $$select 1 from public.story_comments
      where id = 'c5660000-0000-4566-8000-0000000000c8' for update$$,
    'c5660000-0000-4566-8000-000000000022',
    $$delete from public.stories where id = 'c5660000-0000-4566-8000-0000000000a8'$$,
    'c5660000-0000-4566-8000-000000000023', 'select public.delete_user_account()::text'),
  'first=OK|second=OK',
  '22. a provider''s delete of a story and a reporting viewer''s account deletion both finish: no deadlock'
);
select is(
  (select coalesce(story_id::text, 'null') || '|' || coalesce(reporter_id::text, 'null')
          || '|' || evidence_story_media_path
   from public.reports where id = 'c5660000-0000-4566-8000-0000000000f8')
  || '|' || (select count(*)::int from auth.users where id = 'c5660000-0000-4566-8000-000000000023')
  || '|' || (select count(*)::int from public.stories where id = 'c5660000-0000-4566-8000-0000000000a8'),
  'null|null|c5660000-0000-4566-8000-000000000022/c5660000-0000-4566-8000-0000000000a8.jpg|0|0',
  '23. ...the story and the account are gone, and the report keeps its evidence'
);

-- 24. M9 marks a9 seen while P9, mid-session with M9, deletes their account.
select is(
  test.race_deletion(
    'c5660000-0000-4566-8000-000000000025',
    $$select public.mark_story_viewed('c5660000-0000-4566-8000-0000000000a9')::text$$,
    'c5660000-0000-4566-8000-000000000024')
  || '|' || (select count(*)::int from public.story_views
             where viewer_id = 'c5660000-0000-4566-8000-000000000025'),
  'report=filed|delete=OK|0',
  '24. a view of a story whose provider deletes their account mid-session waits for it, and finds the story gone'
);

select is(
  (select string_agg(f.name, ',' order by f.name)
   from (values ('mark_story_viewed', 'public.mark_story_viewed(uuid)'::regprocedure),
                ('toggle_story_reaction', 'public.toggle_story_reaction(uuid, text)'::regprocedure),
                ('post_story_comment', 'public.post_story_comment(uuid, uuid, text)'::regprocedure)) f(name, fn)
   cross join lateral (select pg_get_functiondef(f.fn) as d) g
   where position('perform 1 from public.profiles where id = v_uid for key share' in g.d) = 0
      or position('perform 1 from public.profiles where id = v_uid for key share' in g.d)
         > position('public.story_is_visible(p_story_id)' in g.d)),
  null,
  '25. every member-side story writer locks its own profile before anything reads or locks the story'
);
select is(
  (select string_agg(f.name, ',' order by f.name)
   from (values ('block_story_commenter', 'public.block_story_commenter(uuid)'::regprocedure),
                ('block_story_comment_author', 'public.block_story_comment_author(uuid)'::regprocedure)) f(name, fn)
   cross join lateral (select pg_get_functiondef(f.fn) as d) g
   where position('where id in (v_uid, v_author) order by id for key share' in g.d) = 0
      or position('where id in (v_uid, v_author) order by id for key share' in g.d)
         > position('insert into public.blocks' in g.d)),
  null,
  '26. both story blocks lock the two profiles in id order before the insert'
);

select test.clean_566();

select * from finish();
rollback;
