-- pgTAP for migration 081: a retried send cannot become a second message.
--
-- Assertion 3 is the one that earns the file: the SAME nonce sent twice must
-- produce one row and report success both times. Assertion 5 is its guard —
-- a DIFFERENT nonce must still produce a second row, or "idempotency" would
-- just be a broken send path that silently drops messages.
--
-- 1. the column and the partial unique index exist
-- 2. a first send with a nonce creates a row and stamps it
-- 3. the same nonce again returns the SAME message_id, deduped
-- 4. ...and there is still exactly one row
-- 5. a different nonce does create a second row
-- 6. a null nonce still works (pre-081 clients)
-- 7. ...and any number of null-nonce rows coexist, because the index is partial
-- 8. two members may use the same uuid without colliding
-- 9. the index refuses a duplicate stamp even if a caller skips the wrapper

\set ON_ERROR_STOP on
begin;
select plan(9);

insert into auth.users (id) values
  ('cc081000-0000-4081-8000-000000000001'),  -- member
  ('cc081000-0000-4081-8000-000000000002'),  -- provider
  ('cc081000-0000-4081-8000-000000000003'); -- second member

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider081',
       headline             = 'Here to listen',
       about                = 'A provider row for the 081 suite.',
       languages            = array['English'],
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc081000-0000-4081-8000-000000000002';

update public.profiles set display_name = 'Member081', token_balance = 5000
where  id = 'cc081000-0000-4081-8000-000000000001';

update public.profiles set display_name = 'Member081b', token_balance = 5000
where  id = 'cc081000-0000-4081-8000-000000000003';

select test.accept_current_policies('cc081000-0000-4081-8000-000000000001');
select test.accept_current_policies('cc081000-0000-4081-8000-000000000002');
select test.accept_current_policies('cc081000-0000-4081-8000-000000000003');

-- Conversations are created by the send path itself, so both members get one by
-- sending. Ids are captured into a temp table because pgTAP has no variables.
create temp table t081 (label text primary key, val text);
-- The suite switches to `authenticated` below, which does not own this temp
-- table and is therefore refused by default. Granting is not a weakening of
-- anything real: the table exists only inside this transaction and is rolled
-- back with it.
grant all on table t081 to public;

-- ---------------------------------------------------------------------------
-- 1. The shape
-- ---------------------------------------------------------------------------
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name = 'client_nonce'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'messages'
      and indexname = 'messages_sender_client_nonce_key'
  ),
  '1. client_nonce and its partial unique index exist'
);

-- ---------------------------------------------------------------------------
-- The retry, which is the whole point
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc081000-0000-4081-8000-000000000001","role":"authenticated"}';

-- Create the conversation through the normal path FIRST, then capture its id.
-- (An earlier draft captured before creating and stored a NULL.)
select ok(
  public.open_conversation('cc081000-0000-4081-8000-000000000002') is not null,
  '2. a conversation opens'
);

insert into t081
select 'conv', (
  select c.id::text from public.conversations c
  where c.member_id = 'cc081000-0000-4081-8000-000000000001'
    and c.provider_id = 'cc081000-0000-4081-8000-000000000002'
);

-- First send, with a nonce.
insert into t081
select 'first', (
  public.send_message_idempotent(
    '11111111-1111-4111-8111-000000000081'::uuid,
    (select val from t081 where label = 'conv')::uuid,
    'hello once'
  ) ->> 'message_id'
);

-- The SAME nonce again. Telegram's retry: same random_id, no new message.
insert into t081
select 'again', (
  public.send_message_idempotent(
    '11111111-1111-4111-8111-000000000081'::uuid,
    (select val from t081 where label = 'conv')::uuid,
    'hello once'
  ) ->> 'message_id'
);

select is(
  (select val from t081 where label = 'again'),
  (select val from t081 where label = 'first'),
  '3. the same nonce returns the original message_id'
);

select is(
  (select count(*)::int from public.messages
   where sender_id = 'cc081000-0000-4081-8000-000000000001'
     and body = 'hello once'),
  1,
  '4. ...and exactly one row exists, not two'
);

-- ---------------------------------------------------------------------------
-- The guard that stops 3 from being a broken send path
-- ---------------------------------------------------------------------------
-- If dedup were over-eager, assertion 3 would pass just as happily against a
-- function that dropped every second message. A different nonce must land.
select ok(
  public.send_message_idempotent(
    '22222222-2222-4222-8222-000000000081'::uuid,
    (select val from t081 where label = 'conv')::uuid,
    'hello twice'
  ) ->> 'message_id' is not null,
  '5. a different nonce does create a second message'
);

-- ---------------------------------------------------------------------------
-- Pre-081 clients keep working
-- ---------------------------------------------------------------------------
-- The 10109/079 skew is the reason this is asserted rather than assumed: the
-- server must never require the client to have caught up.
select ok(
  public.send_message_idempotent(
    null,
    (select val from t081 where label = 'conv')::uuid,
    'no nonce at all'
  ) ->> 'message_id' is not null,
  '6. a null nonce still sends'
);

select ok(
  public.send_message_idempotent(
    null,
    (select val from t081 where label = 'conv')::uuid,
    'no nonce either'
  ) ->> 'message_id' is not null,
  '7. ...and a second null-nonce message coexists, the index being partial'
);

-- ---------------------------------------------------------------------------
-- Scoped to the sender
-- ---------------------------------------------------------------------------
-- The nonce is client-generated, so two members CAN produce the same uuid.
-- Scoping the index to sender_id is what stops that being one member's message
-- silencing another's.
set local request.jwt.claims =
  '{"sub":"cc081000-0000-4081-8000-000000000003","role":"authenticated"}';

-- Its OWN statement. Folded into the ok() below with `and`, the conversation
-- subquery could be evaluated before open_conversation had created the row —
-- expression evaluation order is not guaranteed — which is the same mistake as
-- capturing the id before creating it.
select public.open_conversation('cc081000-0000-4081-8000-000000000002');

select ok(
  public.send_message_idempotent(
    '11111111-1111-4111-8111-000000000081'::uuid,
    (select c.id from public.conversations c
     where c.member_id = 'cc081000-0000-4081-8000-000000000003'
       and c.provider_id = 'cc081000-0000-4081-8000-000000000002'),
    'same uuid, different member'
  ) ->> 'message_id' is not null,
  '8. another member may reuse the same uuid'
);

-- ---------------------------------------------------------------------------
-- The backstop
-- ---------------------------------------------------------------------------
-- The advisory lock makes the wrapper correct; the index makes the INVARIANT
-- true even for a future caller that forgets the lock. Asserted as the table
-- owner because a client cannot write client_nonce directly.
reset role;
select throws_ok(
  format(
    $$update public.messages set client_nonce = '22222222-2222-4222-8222-000000000081'
      where id = '%s'$$,
    (select val from t081 where label = 'first')
  ),
  '23505', null,
  '9. the unique index refuses a duplicate stamp'
);

select * from finish();
rollback;
