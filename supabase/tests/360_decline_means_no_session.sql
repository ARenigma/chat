-- pgTAP for migration 082: declining ends the asking.
--
-- Assertion 5 is the bug, reproduced: before 082, the member's next send made a
-- fresh pending request and the provider's next reply re-armed the prompt. The
-- request still gets created (send_message is untouched by design) — what
-- changed is that the flag is set, so the client no longer treats a joined
-- request as a reason to ask again.
--
--  1. the flag column exists and starts null
--  2. a member declining sets it
--  3. the request itself is still 'declined' (078's behaviour intact)
--  4. a PROVIDER declining does NOT set it — that is unavailability
--  5. the flag survives the member sending again and the provider re-joining
--  6. resume_chat_consent clears it
--  7. ...and reports the joined request so the session can start in one more call
--  8. only the member may resume
--  9. get_chat_consent reports it to the member
-- 10. ...and to the provider, whose composer should not imply otherwise
-- 11. a stranger reads nothing

\set ON_ERROR_STOP on
begin;
select plan(12);

insert into auth.users (id) values
  ('cc082000-0000-4082-8000-000000000001'),  -- member
  ('cc082000-0000-4082-8000-000000000002'),  -- provider
  ('cc082000-0000-4082-8000-000000000003'); -- stranger

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider082',
       headline             = 'Here to listen',
       about                = 'A provider row for the 082 suite.',
       languages            = array['English'],
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc082000-0000-4082-8000-000000000002';

update public.profiles set display_name = 'Member082', token_balance = 5000
where  id = 'cc082000-0000-4082-8000-000000000001';
update public.profiles set display_name = 'Stranger082'
where  id = 'cc082000-0000-4082-8000-000000000003';

select test.accept_current_policies('cc082000-0000-4082-8000-000000000001');
select test.accept_current_policies('cc082000-0000-4082-8000-000000000002');
select test.accept_current_policies('cc082000-0000-4082-8000-000000000003');

create temp table t082 (label text primary key, val text);
-- The suite switches roles; the temp table is owned by neither.
grant all on table t082 to public;

-- ---------------------------------------------------------------------------
-- Set the scene: member opens, member sends, provider joins.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000001","role":"authenticated"}';

select public.open_conversation('cc082000-0000-4082-8000-000000000002');

insert into t082
select 'conv', (
  select c.id::text from public.conversations c
  where c.member_id = 'cc082000-0000-4082-8000-000000000001'
);

select is(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t082 where label = 'conv')::uuid),
  null,
  '1. the flag starts null'
);

select public.send_message(
  (select val from t082 where label = 'conv')::uuid, 'hello', null, null, null, null, null, null, null
);

-- Provider joins, which sets responded_at and arms the prompt.
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000002","role":"authenticated"}';
select public.send_message(
  (select val from t082 where label = 'conv')::uuid, 'hi there', null, null, null, null, null, null, null
);

insert into t082
select 'req', (
  select r.id::text from public.session_requests r
  where r.conversation_id = (select val from t082 where label = 'conv')::uuid
    and r.status = 'pending'
  order by r.created_at desc limit 1
);

-- ---------------------------------------------------------------------------
-- The member declines
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000001","role":"authenticated"}';

select lives_ok(
  format($$select public.decline_session_request('%s')$$,
         (select val from t082 where label = 'req')),
  '2a. the member declines'
);

select isnt(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t082 where label = 'conv')::uuid),
  null,
  '2. declining sets the conversation flag'
);

/*
 * 'cancelled', NOT 'declined' — and this is worth pinning rather than glossing.
 *
 * The MEMBER opened this chat, so the member is the request's `initiator_id`,
 * and 078's rule is initiator → cancelled, recipient → declined. So the button
 * the member reads as "Decline" is, underneath, a withdrawal of their own
 * request. The distinction matters for 082: the flag cannot be keyed off the
 * status being 'declined', because in the commonest flow it never is. It is
 * keyed off WHO acted (member_id = auth.uid()), which is why the function looks
 * the member up instead of inferring from the status.
 */
select is(
  (select status::text from public.session_requests
   where id = (select val from t082 where label = 'req')::uuid),
  'cancelled',
  '3. a member withdrawing their OWN request is cancelled, not declined'
);

-- ---------------------------------------------------------------------------
-- 5. THE BUG. Send again, provider replies again.
-- ---------------------------------------------------------------------------
-- `send_message` is untouched, so a new pending request IS created and the
-- provider's reply DOES join it — that is fine and deliberate. What must hold
-- is that the flag is still set, because the client reads the flag rather than
-- the request when deciding whether to ask. Before 082 there was no flag to
-- read and the prompt returned on this very exchange.
select public.send_message(
  (select val from t082 where label = 'conv')::uuid, 'still here', null, null, null, null, null, null, null
);

set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000002","role":"authenticated"}';
select public.send_message(
  (select val from t082 where label = 'conv')::uuid, 'me too', null, null, null, null, null, null, null
);

set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000001","role":"authenticated"}';

select isnt(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t082 where label = 'conv')::uuid),
  null,
  '5. the flag survives another exchange, so the prompt does not return'
);

-- ---------------------------------------------------------------------------
-- 4. A provider declining is a different fact
-- ---------------------------------------------------------------------------
-- Asserted on a SECOND conversation so it cannot be confused with the flag
-- already set above. The provider refusing means unavailable, and must not
-- silence the member's own consent decision.
-- Back to the owner to create a fixture: `authenticated` cannot write
-- auth.users, and an earlier draft of this file silently aborted the suite here
-- rather than failing an assertion.
reset role;
insert into auth.users (id) values ('cc082000-0000-4082-8000-000000000004');
update public.profiles set display_name = 'Member082b', token_balance = 5000
where  id = 'cc082000-0000-4082-8000-000000000004';
select test.accept_current_policies('cc082000-0000-4082-8000-000000000004');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000004","role":"authenticated"}';
select public.open_conversation('cc082000-0000-4082-8000-000000000002');
insert into t082
select 'conv2', (
  select c.id::text from public.conversations c
  where c.member_id = 'cc082000-0000-4082-8000-000000000004'
);
select public.send_message(
  (select val from t082 where label = 'conv2')::uuid, 'hello you', null, null, null, null, null, null, null
);

-- The PROVIDER refuses the member's request.
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000002","role":"authenticated"}';
select public.decline_session_request((
  select r.id from public.session_requests r
  where r.conversation_id = (select val from t082 where label = 'conv2')::uuid
    and r.status = 'pending'
  order by r.created_at desc limit 1
));

select is(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t082 where label = 'conv2')::uuid),
  null,
  '4. a provider declining does NOT set the member''s flag'
);

-- ---------------------------------------------------------------------------
-- Resuming
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000001","role":"authenticated"}';

insert into t082
select 'resume', (
  public.resume_chat_consent((select val from t082 where label = 'conv')::uuid)
)::text;

select is(
  (select chat_consent_declined_at from public.conversations
   where id = (select val from t082 where label = 'conv')::uuid),
  null,
  '6. resume_chat_consent clears the flag'
);

select ok(
  ((select val from t082 where label = 'resume')::jsonb ->> 'provider_joined')::boolean
  and ((select val from t082 where label = 'resume')::jsonb ->> 'request_id') is not null,
  '7. ...and reports the joined request, so the session can start next call'
);

select is(
  (public.resume_chat_consent((select val from t082 where label = 'conv2')::uuid) ->> 'error'),
  'FORBIDDEN',
  '8. only the member of THAT conversation may resume it'
);

-- ---------------------------------------------------------------------------
-- Reading it
-- ---------------------------------------------------------------------------
select public.decline_session_request((
  select r.id from public.session_requests r
  where r.conversation_id = (select val from t082 where label = 'conv')::uuid
    and r.status = 'pending'
  order by r.created_at desc limit 1
));

select is(
  (public.get_chat_consent((select val from t082 where label = 'conv')::uuid) ->> 'declined')::boolean,
  true,
  '9. the member reads their own decline'
);

set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000002","role":"authenticated"}';
select is(
  (public.get_chat_consent((select val from t082 where label = 'conv')::uuid) ->> 'declined')::boolean,
  true,
  '10. the provider reads it too, so their composer does not mislead'
);

set local request.jwt.claims =
  '{"sub":"cc082000-0000-4082-8000-000000000003","role":"authenticated"}';
select is(
  (public.get_chat_consent((select val from t082 where label = 'conv')::uuid) ->> 'declined')::boolean,
  false,
  '11. a stranger learns nothing about the conversation'
);

select * from finish();
rollback;
