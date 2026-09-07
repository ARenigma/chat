-- pgTAP tests for migration 037 (paid-session server cutover, ADR-0020).
--
-- Assertions proven here:
--   1.  send_message function exists.
--   2.  spend_chat_minute returns success=true, compat=no-op, new_balance=null.
--   3.  get_active_session function exists.
--   4.  get_pending_session_request function exists.
--   5a. authenticated has EXECUTE on send_message.
--   5b. anon does NOT have EXECUTE on send_message.
--   6.  send_message does not debit token_balance on text send.
--   7.  send_message auto-creates a pending chat session_request on member first text.
--   8.  get_pending_session_request returns the pending request after member text.
--   9.  provider reply joins (responded_at) and does not create a paid_session.
--   10. message.session_id is linked to the paid_session row.
--   11. get_active_session returns session data after provider acceptance.
--   12. get_active_session returns null for an unknown conversation id.
--   13. get_pending_session_request returns null after request is accepted.
--   14. conversation_summaries view has no last_body column.
--   15. conversation_summaries view has last_session_at column.

\set ON_ERROR_STOP on
begin;
select plan(17);

-- ---------------------------------------------------------------------------
-- Shape assertions (no auth context needed)
-- ---------------------------------------------------------------------------

select ok(
  (select exists (
    select 1 from information_schema.routines
    where  routine_schema = 'public'
      and  routine_name   = 'send_message'
  )),
  '1. send_message function exists'
);

select ok(
  exists (
    select 1 from information_schema.routines
    where  routine_schema = 'public'
      and  routine_name   = 'get_active_session'
  ),
  '3. get_active_session function exists'
);

select ok(
  exists (
    select 1 from information_schema.routines
    where  routine_schema = 'public'
      and  routine_name   = 'get_pending_session_request'
  ),
  '4. get_pending_session_request function exists'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.send_message(uuid,text,uuid,text,integer,text,integer,integer,real[])',
    'EXECUTE'
  ),
  '5a. authenticated has EXECUTE on send_message'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.send_message(uuid,text,uuid,text,integer,text,integer,integer,real[])',
    'EXECUTE'
  ),
  '5b. anon does NOT have EXECUTE on send_message'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Two auth users → profiles auto-created by trigger.
insert into auth.users (id) values
  ('cc037000-0000-4037-8000-000000000001'),  -- member
  ('cc037000-0000-4037-8000-000000000002'); -- provider

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider037',
       date_of_birth        = (current_date - interval '25 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc037000-0000-4037-8000-000000000002';

-- Give member enough tokens (spend_chat_minute no longer charges; we just
-- want to prove that send_message also does not touch the balance).
update public.profiles
set    display_name      = 'Member037',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc037000-0000-4037-8000-000000000001';

-- Open a conversation as the member.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc037000-0000-4037-8000-000000000001","role":"authenticated"}';

insert into test.fixture (k, v)
values ('conv', public.open_conversation('cc037000-0000-4037-8000-000000000002'));

select is(
  public.send_message(
    (select v::uuid from test.fixture where k = 'conv'),
    'blocked before policy acceptance'
  ) ->> 'error',
  'POLICY_REQUIRED',
  '5c. send_message enforces current policy acceptance on the server'
);

select test.accept_current_policies(
  'cc037000-0000-4037-8000-000000000001'
);
select test.accept_current_policies(
  'cc037000-0000-4037-8000-000000000002'
);

-- ---------------------------------------------------------------------------
-- 2. spend_chat_minute no-op
-- ---------------------------------------------------------------------------
select ok(
  (public.spend_chat_minute()->>'compat') = 'no-op'
    and (public.spend_chat_minute()->>'success')::boolean = true
    and public.spend_chat_minute()->>'new_balance' is null,
  '2. spend_chat_minute is no-op (compat=no-op, success=true, new_balance=null)'
);

-- ---------------------------------------------------------------------------
-- 6. send_message does NOT debit token_balance
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.send_message(
    (select v::uuid from test.fixture where k = 'conv'),
    'first message'
  );
end$$;

select is(
  (
    select token_balance
    from public.profiles
    where id = 'cc037000-0000-4037-8000-000000000001'
  ),
  500,
  '6. send_message does not debit token_balance'
);

-- ---------------------------------------------------------------------------
-- 7. Member first text → pending session_request
-- ---------------------------------------------------------------------------
select ok(
  (
    select count(*) = 1
    from   public.session_requests
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
      and  channel         = 'chat'
      and  status          = 'pending'
      and  initiator_id    = 'cc037000-0000-4037-8000-000000000001'
  ),
  '7. member first text auto-creates a pending chat session_request'
);

-- ---------------------------------------------------------------------------
-- 8. get_pending_session_request returns the pending request
-- ---------------------------------------------------------------------------
select ok(
  (
    public.get_pending_session_request(
      (select v::uuid from test.fixture where k = 'conv')
    )->>'channel' = 'chat'
  ),
  '8. get_pending_session_request returns pending chat request'
);

-- ---------------------------------------------------------------------------
-- 9. Provider reply joins — no paid_session until the member confirms
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc037000-0000-4037-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.send_message(
    (select v::uuid from test.fixture where k = 'conv'),
    'reply from provider'
  );
end$$;

select ok(
  (
    select count(*) = 0
    from   public.paid_sessions
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
  )
  and (
    select responded_at is not null
      and  status = 'pending'
    from   public.session_requests
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
      and  channel         = 'chat'
      and  status          = 'pending'
  ),
  '9. provider reply joins (responded_at) and does not create a paid_session'
);

-- ---------------------------------------------------------------------------
-- 10. Member confirm creates the paid_session and backfills message.session_id
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc037000-0000-4037-8000-000000000001","role":"authenticated"}';

select public.confirm_chat_session(
  (select sr.id
   from   public.session_requests sr
   where  sr.conversation_id = (select v::uuid from test.fixture where k = 'conv')
     and  sr.channel         = 'chat'
     and  sr.status          = 'pending'
   limit  1)
);

select ok(
  (
    select count(*) = 1
    from   public.paid_sessions
    where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
      and  channel         = 'chat'
      and  status          in ('pending_leases', 'active')
      and  member_id       = 'cc037000-0000-4037-8000-000000000001'
      and  provider_id     = 'cc037000-0000-4037-8000-000000000002'
  )
  and (
    select m.session_id is not null
      and  m.session_id = (
             select id from public.paid_sessions
             where  conversation_id = (select v::uuid from test.fixture where k = 'conv')
             limit  1
           )
    from   public.messages m
    where  m.conversation_id = (select v::uuid from test.fixture where k = 'conv')
      and  m.sender_id       = 'cc037000-0000-4037-8000-000000000002'
    limit  1
  ),
  '10. member confirm_chat_session creates the paid_session and links messages'
);

-- ---------------------------------------------------------------------------
-- 11. get_active_session returns data after member confirm
-- ---------------------------------------------------------------------------
select ok(
  (
    public.get_active_session(
      (select v::uuid from test.fixture where k = 'conv')
    )->>'channel' = 'chat'
  ),
  '11. get_active_session returns session data after member confirm'
);

-- ---------------------------------------------------------------------------
-- 12. get_active_session returns null for an unknown conversation
-- ---------------------------------------------------------------------------
select ok(
  public.get_active_session('00000000-dead-beef-dead-000000000099'::uuid) is null,
  '12. get_active_session returns null for an unknown conversation id'
);

-- ---------------------------------------------------------------------------
-- 13. get_pending_session_request returns null after acceptance
-- ---------------------------------------------------------------------------
select ok(
  public.get_pending_session_request(
    (select v::uuid from test.fixture where k = 'conv')
  ) is null,
  '13. get_pending_session_request returns null after the request was accepted'
);

-- ---------------------------------------------------------------------------
-- 14–15. conversation_summaries schema
-- ---------------------------------------------------------------------------
set local role postgres;

select ok(
  not exists (
    select 1
    from   information_schema.columns
    where  table_schema = 'public'
      and  table_name   = 'conversation_summaries'
      and  column_name  = 'last_body'
  ),
  '14. conversation_summaries has no last_body column'
);

select ok(
  exists (
    select 1
    from   information_schema.columns
    where  table_schema = 'public'
      and  table_name   = 'conversation_summaries'
      and  column_name  = 'last_session_at'
  ),
  '15. conversation_summaries has last_session_at column'
);

select * from finish();
rollback;
