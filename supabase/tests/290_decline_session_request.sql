-- pgTAP for migration 067: declining a session request.
--
-- 1. the initiator cannot decline their own request
-- 2. the recipient can
-- 3. ...and the row says so
-- 4. declining twice is not an error (idempotent)
-- 5. an unknown request is GONE, not a crash
-- 6. a declined request can no longer be accepted

\set ON_ERROR_STOP on
begin;
select plan(6);

insert into auth.users (id) values
  ('cc067000-0000-4067-8000-000000000001'),
  ('cc067000-0000-4067-8000-000000000002');

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider067',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc067000-0000-4067-8000-000000000002';

update public.profiles
set    display_name      = 'Member067',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc067000-0000-4067-8000-000000000001';

select test.accept_current_policies('cc067000-0000-4067-8000-000000000001');
select test.accept_current_policies('cc067000-0000-4067-8000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc067000-0000-4067-8000-000000000001","role":"authenticated"}';
insert into test.fixture (k, v)
values ('conv067', public.open_conversation('cc067000-0000-4067-8000-000000000002'));
insert into test.fixture (k, v)
select 'req067', public.create_session_request(
  (select v from test.fixture where k = 'conv067'), 'chat'
);

select is(
  public.decline_session_request((select v from test.fixture where k = 'req067')) ->> 'error',
  'FORBIDDEN',
  '1. the initiator cannot decline their own request'
);

set local request.jwt.claims =
  '{"sub":"cc067000-0000-4067-8000-000000000002","role":"authenticated"}';

select is(
  public.decline_session_request((select v from test.fixture where k = 'req067')) ->> 'status',
  'declined',
  '2. the recipient can'
);

reset role;
select is(
  (select status::text from public.session_requests
   where id = (select v from test.fixture where k = 'req067')),
  'declined',
  '3. and the row says so'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc067000-0000-4067-8000-000000000002","role":"authenticated"}';

select is(
  (public.decline_session_request((select v from test.fixture where k = 'req067'))
    ->> 'success')::boolean,
  true,
  '4. declining twice is not an error'
);

select is(
  public.decline_session_request('00000000-dead-beef-dead-000000000099'::uuid) ->> 'error',
  'GONE',
  '5. an unknown request is GONE, not a crash'
);

select throws_ok(
  format(
    $$select public.accept_session_request(%L::uuid)$$,
    (select v from test.fixture where k = 'req067')
  ),
  'P0001', null,
  '6. a declined request can no longer be accepted'
);

select * from finish();
rollback;
