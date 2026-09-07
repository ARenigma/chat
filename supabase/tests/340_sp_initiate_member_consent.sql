-- pgTAP for migration 077: the provider may start; the member confirms.
--
-- 1. provider first text creates a pending chat request they already joined
-- 2. that send does not create a paid_session
-- 3. the provider cannot confirm_chat_session
-- 4. the member can, and that creates the paid_session
-- 5. the provider may place a call request (no P0006 cold-call block)
-- 6. a ring the member cannot pay for is refused (P0003)

\set ON_ERROR_STOP on
begin;
select plan(6);

insert into auth.users (id) values
  ('cc077000-0000-4077-8000-000000000001'),
  ('cc077000-0000-4077-8000-000000000002'),
  ('cc077000-0000-4077-8000-000000000003');

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider077',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc077000-0000-4077-8000-000000000002';

update public.profiles
set    display_name      = 'Member077',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc077000-0000-4077-8000-000000000001';

update public.profiles
set    display_name      = 'Broke077',
       promo_balance     = 0,
       purchased_balance = 0
where  id = 'cc077000-0000-4077-8000-000000000003';

select test.accept_current_policies('cc077000-0000-4077-8000-000000000001');
select test.accept_current_policies('cc077000-0000-4077-8000-000000000002');
select test.accept_current_policies('cc077000-0000-4077-8000-000000000003');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000001","role":"authenticated"}';
insert into test.fixture (k, v)
values ('conv077', public.open_conversation('cc077000-0000-4077-8000-000000000002'));

set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v::uuid from test.fixture where k = 'conv077'),
    'hello from the provider'
  );
end$$;

select ok(
  (
    select initiator_id    = 'cc077000-0000-4077-8000-000000000002'
       and recipient_id    = 'cc077000-0000-4077-8000-000000000001'
       and status          = 'pending'
       and responded_at    is not null
    from   public.session_requests
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv077')
      and  channel         = 'chat'
  ),
  '1. provider first text creates a pending request they already joined'
);

select is(
  (
    select count(*)::integer
    from   public.paid_sessions
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv077')
  ),
  0,
  '2. that send does not create a paid_session'
);

select throws_ok(
  format(
    $$select public.confirm_chat_session(%L::uuid)$$,
    (select id from public.session_requests
     where conversation_id = (select v from test.fixture where k = 'conv077')
       and channel = 'chat' and status = 'pending')
  ),
  'P0001', null,
  '3. the provider cannot confirm_chat_session'
);

set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000001","role":"authenticated"}';

select public.confirm_chat_session(
  (select id from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'conv077')
     and channel = 'chat' and status = 'pending')
);

select ok(
  (
    select count(*) = 1
    from   public.paid_sessions
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv077')
      and  channel         = 'chat'
      and  status          in ('pending_leases', 'active')
  ),
  '4. the member confirm creates the paid_session'
);

reset role;
update public.paid_sessions
set    status = 'ended', ended_at = now()
where  conversation_id = (select v from test.fixture where k = 'conv077');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000002","role":"authenticated"}';

select lives_ok(
  format(
    $$select public.create_session_request(%L::uuid, 'audio'::public.session_channel)$$,
    (select v from test.fixture where k = 'conv077')
  ),
  '5. the provider may place a call request (no cold-call block)'
);

set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000003","role":"authenticated"}';
insert into test.fixture (k, v)
values ('conv077b', public.open_conversation('cc077000-0000-4077-8000-000000000002'));

set local request.jwt.claims =
  '{"sub":"cc077000-0000-4077-8000-000000000002","role":"authenticated"}';

select throws_ok(
  format(
    $$select public.create_session_request(%L::uuid, 'audio'::public.session_channel)$$,
    (select v from test.fixture where k = 'conv077b')
  ),
  'P0003', null,
  '6. a ring the member cannot pay for is refused'
);

select * from finish();
rollback;
