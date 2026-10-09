-- pgTAP for migration 187.
--
-- 1. get_request_peer_info is callable only by authenticated, not by anon.
-- 2. Calling it for a request addressed to someone else returns no rows.
-- 3. conversation_summaries now exposes peer_request_pending.
-- 4. peer_request_pending is boolean.
-- 5. the recipient gets the member's name and the message sent with the request
-- 6. ...but never a message hidden when an earlier session ended
-- 7. someone who is not the recipient gets nothing
-- 8. the provider's inbox row flags the pending request
-- 9. ...and the member's own row does not

\set ON_ERROR_STOP on
begin;
select plan(9);

-- ── Helpers ────────────────────────────────────────────────────────────────

-- 1. get_request_peer_info is not callable by anon.
select ok(
  not has_function_privilege('anon',
    'public.get_request_peer_info(uuid)', 'EXECUTE'),
  '1. get_request_peer_info is not callable by anon'
);

-- 2. get_request_peer_info is callable by authenticated.
select ok(
  has_function_privilege('authenticated',
    'public.get_request_peer_info(uuid)', 'EXECUTE'),
  '2. get_request_peer_info is callable by authenticated'
);

-- 3. conversation_summaries exposes peer_request_pending.
select has_column(
  'public', 'conversation_summaries', 'peer_request_pending',
  '3. conversation_summaries has peer_request_pending column'
);

-- 4. The column is boolean (the view computes an EXISTS, which is bool).
select col_type_is(
  'public', 'conversation_summaries', 'peer_request_pending', 'boolean',
  '4. peer_request_pending is boolean'
);

-- ── Behaviour ──────────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('18700000-0000-4187-8000-000000000001'),  -- provider (recipient)
  ('18700000-0000-4187-8000-000000000002'),  -- another provider
  ('18700000-0000-4187-8000-000000000011');  -- member (requester)
update public.profiles
set role = 'provider', languages = array['en'],
    display_name = 'Prov187' || right(id::text, 1),
    date_of_birth = date '1990-01-01', identity_verified_at = now()
where id in ('18700000-0000-4187-8000-000000000001', '18700000-0000-4187-8000-000000000002');
update public.profiles set display_name = 'Mina' where id = '18700000-0000-4187-8000-000000000011';
select test.accept_current_policies(id) from auth.users where id::text like '18700000-%';

set local role authenticated;
set local request.jwt.claims = '{"sub":"18700000-0000-4187-8000-000000000011","role":"authenticated"}';
insert into test.fixture (k, v) values ('c187', public.open_conversation('18700000-0000-4187-8000-000000000001'));
reset role;

-- An old message from an earlier session, hidden when it ended (045).
insert into public.messages (conversation_id, sender_id, body, created_at, hidden_at)
values ((select v from test.fixture where k = 'c187'), '18700000-0000-4187-8000-000000000011',
        'old private words', now() - interval '3 days', now() - interval '3 days');
-- The message that comes with today's request, and the request itself.
insert into public.messages (conversation_id, sender_id, body)
values ((select v from test.fixture where k = 'c187'), '18700000-0000-4187-8000-000000000011',
        'Hi, can we talk about my exams?');
insert into public.session_requests (id, conversation_id, channel, initiator_id, recipient_id, expires_at)
values ('18700000-0000-4187-8000-0000000000aa', (select v from test.fixture where k = 'c187'), 'chat',
        '18700000-0000-4187-8000-000000000011', '18700000-0000-4187-8000-000000000001',
        now() + interval '1 minute');

set local role authenticated;
set local request.jwt.claims = '{"sub":"18700000-0000-4187-8000-000000000001","role":"authenticated"}';
select is(
  (select peer_display_name || ' / ' || first_message_preview
   from public.get_request_peer_info('18700000-0000-4187-8000-0000000000aa')),
  'Mina / Hi, can we talk about my exams?',
  '5. the recipient gets the name and the message sent with the request');
select is(
  (select count(*)::int from public.get_request_peer_info('18700000-0000-4187-8000-0000000000aa')
   where first_message_preview like '%old private%'),
  0, '6. a message hidden by an earlier session end is never returned');
select is(
  (select peer_request_pending from public.conversation_summaries
   where conversation_id = (select v from test.fixture where k = 'c187')),
  true, '8. the provider inbox row flags the pending request');

set local request.jwt.claims = '{"sub":"18700000-0000-4187-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.get_request_peer_info('18700000-0000-4187-8000-0000000000aa')),
  0, '7. someone who is not the recipient gets nothing');

set local request.jwt.claims = '{"sub":"18700000-0000-4187-8000-000000000011","role":"authenticated"}';
select is(
  (select peer_request_pending from public.conversation_summaries
   where conversation_id = (select v from test.fixture where k = 'c187')),
  false, '9. the member''s own row does not');
reset role;

select * from finish();
rollback;
