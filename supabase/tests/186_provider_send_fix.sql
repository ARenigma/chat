-- pgTAP for migration 186: a provider whose own chat channel is OFF can still
-- send outside a live session; the provider-initiated request (which the
-- channel trigger refuses with P0009) is skipped instead of failing the send.
--
--  1. the send succeeds
--  2. ...and the message exists
--  3. ...and no provider-initiated request was opened
--  4. with the channel ON the same send opens the request, as before

\set ON_ERROR_STOP on
begin;
select plan(4);

insert into auth.users (id) values
  ('18600000-0000-4186-8000-000000000001'),  -- provider
  ('18600000-0000-4186-8000-000000000011');  -- member

update public.profiles
set role = 'provider', languages = array['en'], display_name = 'Prov186',
    date_of_birth = date '1990-01-01', identity_verified_at = now()
where id = '18600000-0000-4186-8000-000000000001';
update public.profiles set promo_balance = 500 where id = '18600000-0000-4186-8000-000000000011';
select test.accept_current_policies(id) from auth.users where id::text like '18600000-%';

set local role authenticated;
set local request.jwt.claims = '{"sub":"18600000-0000-4186-8000-000000000011","role":"authenticated"}';
insert into test.fixture (k, v) values ('c186', public.open_conversation('18600000-0000-4186-8000-000000000001'));
reset role;

update public.profiles set chat_enabled = false where id = '18600000-0000-4186-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"18600000-0000-4186-8000-000000000001","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'c186'), 'Checking in') ->> 'success')::boolean,
  true, '1. a provider with chat off can still send');
reset role;

select is(
  (select count(*)::int from public.messages
   where conversation_id = (select v from test.fixture where k = 'c186')
     and sender_id = '18600000-0000-4186-8000-000000000001'),
  1, '2. the message exists');
select is(
  (select count(*)::int from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'c186')
     and initiator_id = '18600000-0000-4186-8000-000000000001'),
  0, '3. no provider-initiated request was opened');

update public.profiles set chat_enabled = true where id = '18600000-0000-4186-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18600000-0000-4186-8000-000000000001","role":"authenticated"}';
select public.send_message((select v from test.fixture where k = 'c186'), 'Here when you are');
reset role;
select is(
  (select count(*)::int from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'c186')
     and initiator_id = '18600000-0000-4186-8000-000000000001'),
  1, '4. with chat on, the same send opens the request as before');

select * from finish();
rollback;
