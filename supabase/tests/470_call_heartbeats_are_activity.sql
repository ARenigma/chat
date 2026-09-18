-- pgTAP for migration 115: a call's own heartbeat now counts as activity, so
-- meter_active_sessions' 5m30s inactivity timer (built for chat, where
-- activity means typing) does not end a call that is simply talking.
--
-- 1. an active call session survives a heartbeat sent 6 minutes after the
--    last recorded activity -- the exact defect (every call force-ended at
--    ~5m30s) this migration fixes
-- 2. that heartbeat actually moved last_activity_at forward, not just that
--    the session happened to still be active for some other reason
-- 3. a call session that receives NO heartbeat for 6 minutes still ends --
--    the safety net is the existing 30s disconnect_grace heartbeat check,
--    not this migration, and this migration must not have disabled it
-- 4. a CHAT session's last_activity_at is UNCHANGED by a plain heartbeat --
--    the scoping (`channel <> 'chat'`) that keeps ADR-0020's real,
--    documented, 5-minute chat inactivity timer exactly as it was
-- 5. a chat session six minutes quiet still gets force-ended -- proof (4)
--    did not also switch off chat's own inactivity timer

\set ON_ERROR_STOP on
begin;
select plan(7);

insert into auth.users (id) values
  ('aa470000-0000-4000-8000-000000000001'),  -- member
  ('bb470000-0000-4000-8000-000000000002'); -- provider

insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values (
  'bb470000-0000-4000-8000-000000000002',
  'Call Provider 470',
  (current_date - interval '26 years')::date,
  array['English']
);
select public.approve_provider_application('bb470000-0000-4000-8000-000000000002');

update public.profiles
set promo_balance = 500, purchased_balance = 0
where id = 'aa470000-0000-4000-8000-000000000001';

select test.accept_current_policies('aa470000-0000-4000-8000-000000000001');
select test.accept_current_policies('bb470000-0000-4000-8000-000000000002');

reset role;
update admin.config_active
set payload = payload || '{"voice_calls_enabled": true, "video_calls_enabled": true}'::jsonb
where domain = 'kill_switches' and environment = 'prod';

-- ---------------------------------------------------------------------------
-- Fixture A: a call, answered, active.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values (
  'thread',
  public.open_conversation('bb470000-0000-4000-8000-000000000002')
);

select public.start_call((select v from test.fixture where k = 'thread'), 'voice');

insert into test.fixture (k, v)
select 'call', id
from public.calls
where conversation_id = (select v from test.fixture where k = 'thread')
order by created_at desc
limit 1;

set local request.jwt.claims =
  '{"sub":"bb470000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.answer_call((select v from test.fixture where k = 'call'));

insert into test.fixture (k, v)
select 'session', id
from public.paid_sessions
where call_id = (select v from test.fixture where k = 'call');

-- Both connected leases: activates billing.
select public.claim_session_lease(
  (select v from test.fixture where k = 'session'), 'connected'
);
set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'), 'connected'
  ),
  'active',
  'fixture: both connected leases activate the call session'
);

-- ---------------------------------------------------------------------------
-- 1 + 2. A heartbeat sent 6 minutes after the last recorded activity keeps
-- the call alive AND moves last_activity_at forward.
-- ---------------------------------------------------------------------------
reset role;
update public.paid_sessions
set last_activity_at = now() - interval '6 minutes'
where id = (select v from test.fixture where k = 'session');

set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.claim_session_lease(
    (select v from test.fixture where k = 'session'), 'connected'
  ),
  'active',
  '1. a call heartbeat 6 minutes after the last activity does not end the session'
);

reset role;
select ok(
  (
    select last_activity_at > now() - interval '1 second'
    from public.paid_sessions
    where id = (select v from test.fixture where k = 'session')
  ),
  '2. the heartbeat actually refreshed last_activity_at, not merely a side effect'
);

-- Belt-and-braces: meter_active_sessions must not end it either, now that
-- last_activity_at is fresh.
select public.meter_active_sessions();
select is(
  (select status::text from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  'active',
  '2b. the meter agrees: a freshly-heartbeated call is not inactive'
);

-- ---------------------------------------------------------------------------
-- 3. A call that receives NO heartbeat for 6 minutes still ends. This
-- migration must not have made a genuinely dead call immortal -- the safety
-- net is disconnect_grace's own 30s heartbeat-staleness check, unchanged.
-- ---------------------------------------------------------------------------
update public.paid_sessions
set last_activity_at = now() - interval '6 minutes'
where id = (select v from test.fixture where k = 'session');
update public.session_leases
set last_heartbeat_at = now() - interval '6 minutes'
where session_id = (select v from test.fixture where k = 'session');

select public.meter_active_sessions();
select is(
  (select status::text from public.paid_sessions
   where id = (select v from test.fixture where k = 'session')),
  'ended',
  '3. a call with no heartbeat for 6 minutes still ends (disconnect_grace, unchanged)'
);

-- ---------------------------------------------------------------------------
-- 4 + 5. A CHAT session is untouched: its last_activity_at only moves on a
-- message (touch_session_activity, 037), never on a bare heartbeat, and a
-- quiet chat session still gets force-ended at 5m30s exactly as before.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v from test.fixture where k = 'thread'),
    'hello from the member, 470'
  );
end$$;

set local request.jwt.claims =
  '{"sub":"bb470000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v from test.fixture where k = 'thread'),
    'reply from the provider, 470'
  );
end$$;

-- confirm_chat_session is the member's call (matching 240's fixture) -- switch
-- claims back before making it, not still the provider's from the reply above.
set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.confirm_chat_session(
  (select id from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'thread')
     and channel = 'chat' and status = 'pending')
);

insert into test.fixture (k, v)
select 'chatSession', id
from public.paid_sessions
where conversation_id = (select v from test.fixture where k = 'thread')
  and channel = 'chat';

-- First lease: still the member's claims from confirm_chat_session, above.
select public.claim_session_lease(
  (select v from test.fixture where k = 'chatSession'), 'foreground'
);
-- Second lease, from the OTHER participant: this is what activates the
-- session (claim_session_lease requires a lease from both member and
-- provider, not two from the same user).
set local request.jwt.claims =
  '{"sub":"bb470000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.claim_session_lease(
  (select v from test.fixture where k = 'chatSession'), 'foreground'
);

reset role;
update public.paid_sessions
set last_activity_at = now() - interval '6 minutes'
where id = (select v from test.fixture where k = 'chatSession');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa470000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.claim_session_lease(
  (select v from test.fixture where k = 'chatSession'), 'foreground'
);

reset role;
select ok(
  (
    select last_activity_at < now() - interval '5 minutes'
    from public.paid_sessions
    where id = (select v from test.fixture where k = 'chatSession')
  ),
  '4. a chat heartbeat does NOT refresh last_activity_at -- only a message does'
);

select public.meter_active_sessions();
select is(
  (select status::text from public.paid_sessions
   where id = (select v from test.fixture where k = 'chatSession')),
  'ended',
  '5. a chat session quiet for 6 minutes still force-ends -- scoping did not weaken it'
);

select * from finish();
rollback;
