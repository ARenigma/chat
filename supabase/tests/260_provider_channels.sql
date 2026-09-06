-- pgTAP for migration 064: per-provider channels.
--
--  1. the three columns exist and default to on
--  2. a provider may switch two off
--  3. ...but not the third (profiles_at_least_one_channel)
--  4. the columns are the provider's own to write (NOT in the 063 guard)
--  5. the directory publishes them
--  6. provider_offers_channel reads them
--  7. ...and defaults to true for an unknown id, never silently blocking
--  8. create_session_request is refused on a channel the provider switched off
--  9. ...and allowed on one they still offer
-- 10. a member's first text is refused too — it inserts the request DIRECTLY,
--     which is why the trigger is on the table and not in the callers
-- 11. a request that predates the switch can still be accepted: in-flight work
--     runs to its end
-- 12. the provider's own return invite obeys the same rule

\set ON_ERROR_STOP on
begin;
select plan(12);

insert into auth.users (id) values
  ('cc064000-0000-4064-8000-000000000001'),  -- member
  ('cc064000-0000-4064-8000-000000000002'); -- provider

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider064',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc064000-0000-4064-8000-000000000002';

update public.profiles
set    display_name      = 'Member064',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc064000-0000-4064-8000-000000000001';

select test.accept_current_policies('cc064000-0000-4064-8000-000000000001');
select test.accept_current_policies('cc064000-0000-4064-8000-000000000002');

select ok(
  (select chat_enabled and audio_enabled and video_enabled
   from public.profiles where id = 'cc064000-0000-4064-8000-000000000002'),
  '1. the three columns exist and default to on'
);

-- ---------------------------------------------------------------------------
-- The floor, written by the provider themselves
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000002","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set audio_enabled = false, video_enabled = false
    where id = 'cc064000-0000-4064-8000-000000000002'$$,
  '2. a provider may switch two channels off'
);

select throws_ok(
  $$update public.profiles set chat_enabled = false
    where id = 'cc064000-0000-4064-8000-000000000002'$$,
  '23514', null,
  '3. ...but not the third: at least one channel stays on'
);

select lives_ok(
  $$update public.profiles set video_enabled = true
    where id = 'cc064000-0000-4064-8000-000000000002'$$,
  '4. the columns are the provider''s own to write, not server-owned'
);

reset role;

select ok(
  (select count(*) = 3
   from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'provider_directory'
     and column_name in ('chat_enabled', 'audio_enabled', 'video_enabled')),
  '5. the directory publishes the three columns'
);

select ok(
  public.provider_offers_channel('cc064000-0000-4064-8000-000000000002', 'video')
    and not public.provider_offers_channel('cc064000-0000-4064-8000-000000000002', 'audio'),
  '6. provider_offers_channel reads them'
);

select ok(
  public.provider_offers_channel('00000000-dead-beef-dead-000000000099', 'chat'),
  '7. an unknown id defaults to true, never silently blocking'
);

-- ---------------------------------------------------------------------------
-- The choke point
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values ('conv064', public.open_conversation('cc064000-0000-4064-8000-000000000002'));

select throws_ok(
  format(
    $$select public.create_session_request(%L::uuid, 'audio'::public.session_channel)$$,
    (select v from test.fixture where k = 'conv064')
  ),
  'P0009', null,
  '8. a request on a switched-off channel is refused'
);

select lives_ok(
  format(
    $$select public.create_session_request(%L::uuid, 'video'::public.session_channel)$$,
    (select v from test.fixture where k = 'conv064')
  ),
  '9. ...and allowed on a channel the provider still offers'
);

-- A member's first text inserts the request directly (037:216) rather than
-- calling create_session_request, so this is the case a caller-side check
-- would have missed entirely.
reset role;
update public.profiles
set    chat_enabled = false, audio_enabled = true
where  id = 'cc064000-0000-4064-8000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000001","role":"authenticated"}';

select throws_ok(
  format(
    $$select public.send_message(%L::uuid, 'hello')$$,
    (select v from test.fixture where k = 'conv064')
  ),
  'P0009', null,
  '10. a member''s first text is refused too: the direct insert hits the trigger'
);

-- ---------------------------------------------------------------------------
-- In-flight work is not cancelled by the switch
-- ---------------------------------------------------------------------------
reset role;
update public.profiles
set    chat_enabled = true
where  id = 'cc064000-0000-4064-8000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000001","role":"authenticated"}';
insert into test.fixture (k, v)
select 'req064', public.create_session_request(
  (select v from test.fixture where k = 'conv064'), 'chat'
);

reset role;
update public.profiles
set    chat_enabled = false
where  id = 'cc064000-0000-4064-8000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000002","role":"authenticated"}';

select lives_ok(
  format(
    $$select public.accept_session_request(%L::uuid)$$,
    (select v from test.fixture where k = 'req064')
  ),
  '11. a request that predates the switch can still be accepted'
);

-- The provider's own return invite obeys the same rule: one channel switch,
-- both directions. (They have an ended session with this member now, so the
-- cold-call guard in create_session_request is satisfied.)
reset role;
update public.paid_sessions set status = 'ended', ended_at = now()
where  conversation_id = (select v from test.fixture where k = 'conv064');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc064000-0000-4064-8000-000000000002","role":"authenticated"}';

select throws_ok(
  format(
    $$select public.create_session_request(%L::uuid, 'chat'::public.session_channel)$$,
    (select v from test.fixture where k = 'conv064')
  ),
  'P0009', null,
  '12. the provider''s own return invite obeys the same rule'
);

select * from finish();
rollback;
