-- pgTAP for migration 086: only the member can start a paid chat session.
--
-- These are two reproduced production defects turned into regression tests.
-- Both were demonstrated against the real schema BEFORE the fix, on
-- 2026-09-08, in answer to Amit's "All CTA are binding right -- no decline but
-- still able to msg/call bug? pls check this as this directly ties to usage and
-- billing". They did, and it did.
--
-- Assertions 4 and 9 are the ones that were failing. Everything else exists so
-- that the fix cannot be "make the provider's Accept throw", which would close
-- the hole by breaking a working flow.
--
--  1. a member-initiated chat request has the PROVIDER as recipient
--  2. the provider may still accept it — their Accept is not broken
--  3. ...and it is marked answered, which is what the consent prompt reads
--  4. ...but NO paid session exists: the member was never asked
--  5. the member confirming DOES create one
--  6. ...and that clears any earlier decline, so no row is both
--  7. an SP-initiated request has the MEMBER as recipient
--  8. ...and the member accepting that one creates the session, as before
--  9. after a decline, a provider accepting a fresh request starts nothing
-- 9b. ...and no live session exists for a member who declined
-- 10. the member themselves is refused while their own decline stands
-- 11. an AUDIO request is untouched: the provider still answers it

\set ON_ERROR_STOP on
begin;
select plan(12);

insert into auth.users (id) values
  ('cc086000-0000-4086-8000-000000000001'),   -- member A
  ('cc086000-0000-4086-8000-000000000002'),   -- provider
  ('cc086000-0000-4086-8000-000000000003'),   -- member B (SP-initiated)
  ('cc086000-0000-4086-8000-000000000004');  -- member C (call)

update public.profiles
set    role='provider', display_name='Provider086', headline='Here to listen',
       about='A provider row for the 086 suite.', languages=array['English'],
       date_of_birth=(current_date - interval '30 years')::date,
       identity_verified_at=now(), is_available=true
where  id='cc086000-0000-4086-8000-000000000002';

update public.profiles set display_name='MemberA086', token_balance=50000
where  id='cc086000-0000-4086-8000-000000000001';
update public.profiles set display_name='MemberB086', token_balance=50000
where  id='cc086000-0000-4086-8000-000000000003';
update public.profiles set display_name='MemberC086', token_balance=50000
where  id='cc086000-0000-4086-8000-000000000004';

select test.accept_current_policies('cc086000-0000-4086-8000-000000000001');
select test.accept_current_policies('cc086000-0000-4086-8000-000000000002');
select test.accept_current_policies('cc086000-0000-4086-8000-000000000003');
select test.accept_current_policies('cc086000-0000-4086-8000-000000000004');

create temp table t086 (label text primary key, val text);
-- The suite switches roles; the temp table is owned by neither.
grant all on table t086 to public;

-- ---------------------------------------------------------------------------
-- Member-initiated chat: the defect
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000001","role":"authenticated"}';

select public.open_conversation('cc086000-0000-4086-8000-000000000002');
insert into t086 select 'c', (select id::text from public.conversations
  where member_id = 'cc086000-0000-4086-8000-000000000001');
select public.send_message((select val from t086 where label='c')::uuid,
  'hello', null, null, null, null, null, null, null);

insert into t086 select 'r', (select id::text from public.session_requests
  where conversation_id = (select val from t086 where label='c')::uuid
    and status = 'pending');

select is(
  (select recipient_id from public.session_requests
   where id = (select val from t086 where label='r')::uuid),
  'cc086000-0000-4086-8000-000000000002'::uuid,
  '1. a member-initiated chat request has the PROVIDER as recipient'
);

-- The provider taps Accept on ChatRingScreen.
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000002","role":"authenticated"}';

select is(
  public.accept_session_request((select val from t086 where label='r')::uuid),
  null,
  '2. the provider may still accept, and gets NULL rather than a session'
);

reset role;
select isnt(
  (select responded_at from public.session_requests
   where id = (select val from t086 where label='r')::uuid),
  null,
  '3. the request is marked answered — what the consent prompt reads'
);

-- THE DEFECT. Before 086 this row existed and the member was being billed.
select is(
  (select count(*)::int from public.paid_sessions
   where conversation_id = (select val from t086 where label='c')::uuid),
  0,
  '4. NO paid session: a provider cannot start billing a member'
);

-- ---------------------------------------------------------------------------
-- ...and the member confirming still works
-- ---------------------------------------------------------------------------
-- Declined first, so assertion 6 has something to clear.
reset role;
update public.conversations set chat_consent_declined_at = now()
where  id = (select val from t086 where label='c')::uuid;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000001","role":"authenticated"}';

-- Returns the paid_session id (a uuid), not a jsonb envelope — the first draft
-- of this assertion applied `->>` to it and aborted the file after 4.
select isnt(
  public.confirm_chat_session((select val from t086 where label='r')::uuid),
  null,
  '5. the MEMBER confirming does create the session'
);

reset role;
select is(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t086 where label='c')::uuid),
  null,
  '6. ...and confirming withdraws the earlier decline, so no row is both'
);

-- ---------------------------------------------------------------------------
-- SP-initiated chat (077): the member is the recipient, and nothing changed
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000003","role":"authenticated"}';
select public.open_conversation('cc086000-0000-4086-8000-000000000002');
insert into t086 select 'c2', (select id::text from public.conversations
  where member_id = 'cc086000-0000-4086-8000-000000000003');

-- Provider writes first.
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000002","role":"authenticated"}';
select public.send_message((select val from t086 where label='c2')::uuid,
  'hello there', null, null, null, null, null, null, null);

insert into t086 select 'r2', (select id::text from public.session_requests
  where conversation_id = (select val from t086 where label='c2')::uuid
    and status = 'pending');

reset role;
select is(
  (select recipient_id from public.session_requests
   where id = (select val from t086 where label='r2')::uuid),
  'cc086000-0000-4086-8000-000000000003'::uuid,
  '7. an SP-initiated request has the MEMBER as recipient'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000003","role":"authenticated"}';
select isnt(
  public.accept_session_request((select val from t086 where label='r2')::uuid),
  null,
  '8. the member accepting THAT one still creates the session'
);

-- ---------------------------------------------------------------------------
-- 9/10. A decline is binding on the SERVER, through both guards
-- ---------------------------------------------------------------------------
-- The scenario an old client produces: the member declines, their build has no
-- get_chat_consent so the composer never closes, the next send makes a fresh
-- pending request, and the provider's ring fires again.
--
-- TWO PATHS, and the first draft of this suite only tested one and mislabelled
-- it. On a MEMBER-initiated request the recipient is the provider, so a member
-- calling accept is stopped by 030's recipient guard long before anything to do
-- with consent — the assertion passed for the wrong reason. What actually has
-- to hold is that the PROVIDER accepting creates nothing (guard one), and that
-- where the member IS the recipient the decline stops them too (guard two).
reset role;
update public.paid_sessions set status = 'ended', ended_at = now()
where  conversation_id = (select val from t086 where label='c2')::uuid;
update public.conversations set chat_consent_declined_at = now()
where  id = (select val from t086 where label='c2')::uuid;

-- The member's old client keeps sending. recipient = provider.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000003","role":"authenticated"}';
select public.send_message((select val from t086 where label='c2')::uuid,
  'still here', null, null, null, null, null, null, null);

insert into t086 select 'r3', (select id::text from public.session_requests
  where conversation_id = (select val from t086 where label='c2')::uuid
    and status = 'pending' order by created_at desc limit 1);

set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000002","role":"authenticated"}';
select is(
  public.accept_session_request((select val from t086 where label='r3')::uuid),
  null,
  '9. after a decline, the provider accepting a fresh request starts nothing'
);

reset role;
select is(
  (select count(*)::int from public.paid_sessions
   where conversation_id = (select val from t086 where label='c2')::uuid
     and status <> 'ended'),
  0,
  '9b. ...and no live session exists for a member who declined'
);

-- Guard two: the MEMBER is the recipient (SP-initiated) and has declined.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000002","role":"authenticated"}';
select public.send_message((select val from t086 where label='c2')::uuid,
  'are you there', null, null, null, null, null, null, null);

reset role;
update public.session_requests
set    recipient_id = 'cc086000-0000-4086-8000-000000000003',
       initiator_id = 'cc086000-0000-4086-8000-000000000002'
where  conversation_id = (select val from t086 where label='c2')::uuid
  and  status = 'pending';

insert into t086 select 'r4', (select id::text from public.session_requests
  where conversation_id = (select val from t086 where label='c2')::uuid
    and status = 'pending');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format($$select public.accept_session_request('%s')$$,
         (select val from t086 where label='r4')),
  '42501',
  'the member has declined a paid session in this conversation',
  '10. and the member themselves is refused while their decline stands'
);

-- ---------------------------------------------------------------------------
-- 11. Calls are deliberately untouched
-- ---------------------------------------------------------------------------
-- For a call the callee answers, and the caller passed CallScreen's consent
-- before start_call ran. Restricting acceptance to the member would break a
-- provider answering a member's call, which is the entire flow.
--
-- The channel enum is chat | audio | video — there is no 'call' value, which
-- the first draft of this assertion assumed and died on.
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000004","role":"authenticated"}';
select public.open_conversation('cc086000-0000-4086-8000-000000000002');
insert into t086 select 'c3', (select id::text from public.conversations
  where member_id = 'cc086000-0000-4086-8000-000000000004');

reset role;
insert into public.session_requests
  (conversation_id, channel, initiator_id, recipient_id, expires_at)
values
  ((select val from t086 where label='c3')::uuid, 'audio',
   'cc086000-0000-4086-8000-000000000004',
   'cc086000-0000-4086-8000-000000000002', now() + interval '1 hour');

insert into t086 select 'r5', (select id::text from public.session_requests
  where conversation_id = (select val from t086 where label='c3')::uuid
    and channel = 'audio' and status = 'pending');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc086000-0000-4086-8000-000000000002","role":"authenticated"}';
select isnt(
  public.accept_session_request((select val from t086 where label='r5')::uuid),
  null,
  '11. the provider still answers an AUDIO request into a session'
);

select * from finish();
rollback;
