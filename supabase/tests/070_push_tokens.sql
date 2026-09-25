-- pgTAP for migration 008: push tokens.
--
-- A device token is a capability, not a preference: whoever holds it can put a
-- notification on that lock screen. So the assertions here are about who can
-- read and write them, and one about what a notification is allowed to contain.

\set ON_ERROR_STOP on
begin;
select plan(24);

select has_table('public', 'push_tokens', 'push_tokens exists');
select has_column('public', 'messages', 'notified_at', 'messages record when they were pushed');

insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Registration names the caller, never the client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.register_push_token(repeat('t', 40), 'android')$$,
  'a signed-in device registers its token'
);
select throws_ok(
  $$select public.register_push_token('short', 'android')$$,
  '22023', null,
  'and a value too short to be a token is refused'
);
select throws_ok(
  $$select public.register_push_token(repeat('t', 40), 'windows')$$,
  '22023', null,
  'as is an unknown platform'
);
-- The client cannot enumerate tokens, not even its own: there is no SELECT policy.
select is(
  (select count(*)::int from public.push_tokens), 0,
  'a client cannot read the token table at all'
);
reset role;

select is(
  (select user_id from public.push_tokens where token = repeat('t', 40)),
  'aaaaaaaa-0000-4000-8000-000000000001',
  'the row belongs to the caller, who never sent a user id'
);

-- ---------------------------------------------------------------------------
-- The case that matters: a second account on the same phone
-- ---------------------------------------------------------------------------
-- FCM reissues one token per app install, so a shared or resold device
-- re-registers the *same* token under a new account. Leaving it pointed at the
-- previous user would push one person's messages to another person's phone.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.register_push_token(repeat('t', 40), 'android')$$,
  'the next account on the same device re-registers the same token'
);
reset role;
select is(
  (select user_id from public.push_tokens where token = repeat('t', 40)),
  'bbbbbbbb-0000-4000-8000-000000000002',
  'and the token follows the new owner rather than the old one'
);
select is(
  (select count(*)::int from public.push_tokens), 1,
  'without accumulating a row per reinstall'
);

-- ---------------------------------------------------------------------------
-- The sender's surface is off limits to clients
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.mark_notified(array['aaaaaaaa-0000-4000-8000-000000000001'::uuid])$$,
  '42501', null,
  'a client cannot mark messages notified'
);
reset role;

-- ---------------------------------------------------------------------------
-- What the notification needs to be openable, and what it must never carry
-- ---------------------------------------------------------------------------
-- Both halves of this are contracts with code outside the database, which is
-- exactly why they belong here. `src/lib/push.ts` routes on `data.peerId`, and
-- the sender can only put a peer id in the payload if the view hands it one,
-- it did not, originally, so notifications would have arrived and gone nowhere.
--
-- The negative assertion is the more important one. The privacy promise in
-- web/privacy.html is that a notification says who replied and never what they
-- said. That holds because the view has no body column to leak, not because the
-- Edge Function remembers not to select it. If someone adds one, this fails.
select has_column('public', 'pending_pushes', 'peer_id',
  'the sender can tell the device which conversation to open');
select hasnt_column('public', 'pending_pushes', 'body',
  'and cannot leak the message onto a lock screen, because there is no body to select');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_name = 'pending_pushes' and grantee in ('anon', 'authenticated')),
  0,
  'no client role can read the pending queue'
);

-- ---------------------------------------------------------------------------
-- A sign-out's row delete, which has to delete (143)
-- ---------------------------------------------------------------------------
-- The client used to delete its row with a plain DELETE under RLS, and with
-- no SELECT policy a DELETE whose WHERE reads `token` matches nothing: the
-- row stayed, with no error, and kept delivering the old account's pushes.
-- The token now belongs to B (above); A registers a second one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select public.register_push_token(repeat('a', 40), 'android');
delete from public.push_tokens where token = repeat('a', 40);
reset role;
select is(
  (select count(*)::int from public.push_tokens where token = repeat('a', 40)),
  1,
  'the plain DELETE the client used to send removes nothing (why the function exists)'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  public.unregister_push_token(repeat('a', 40)),
  false,
  'another account cannot remove a token that is not theirs'
);
reset role;
select is(
  (select count(*)::int from public.push_tokens where token = repeat('a', 40)),
  1,
  '...and the row is still there'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.unregister_push_token(repeat('a', 40)),
  true,
  'the owner removes their own row by the token'
);
-- The shared token is B's now: A's retry of a sign-out must not take it.
select is(
  public.unregister_push_token(repeat('t', 40)),
  false,
  'a leaving account''s delete leaves the next account''s row for the same token alone'
);
reset role;
select is(
  (select string_agg(right(user_id::text, 1) || ':' || left(token, 1), ',' order by token)
   from public.push_tokens),
  '2:t',
  'only the owner''s row went'
);

-- Whose push it is (143): the senders put the row's owner in the payload, and
-- the app posts a push only for the account signed in.
select has_column('public', 'pending_pushes', 'recipient_id',
  'the message queue names the account each row is for');
select has_column('public', 'pending_call_pushes', 'recipient_id',
  'and so does the call queue');

-- And that it names the right account, not only that the column exists: a
-- wrong expression (c.member_id for every message, say) passed every suite,
-- and each device would then drop every push it was sent as another
-- account's. Messages both ways, a provider's chat request and a ringing
-- call, each row checked against its token's owner.
insert into auth.users (id) values
  ('c0700000-0000-4070-8000-000000000001'),   -- member M
  ('c0700000-0000-4070-8000-000000000010');   -- provider P
update public.profiles
set    role                 = 'provider',
       languages            = array['en'],
       display_name         = 'Provider070',
       date_of_birth        = date '1990-01-01',
       identity_verified_at = now()
where  id = 'c0700000-0000-4070-8000-000000000010';
select test.accept_current_policies(id) from public.profiles where id::text like 'c0700000-%';
insert into public.push_tokens (user_id, token, platform) values
  ('c0700000-0000-4070-8000-000000000001', repeat('m', 40), 'android'),
  ('c0700000-0000-4070-8000-000000000010', repeat('p', 40), 'android');
insert into public.conversations (id, member_id, provider_id) values
  ('c0700000-0000-4070-8000-0000000000b1', 'c0700000-0000-4070-8000-000000000001',
   'c0700000-0000-4070-8000-000000000010');
insert into public.messages (conversation_id, sender_id, body, created_at) values
  ('c0700000-0000-4070-8000-0000000000b1', 'c0700000-0000-4070-8000-000000000001', 'to P',
   now() - interval '2 minutes'),
  ('c0700000-0000-4070-8000-0000000000b1', 'c0700000-0000-4070-8000-000000000010', 'to M',
   now() - interval '1 minute');
insert into public.session_requests (conversation_id, channel, initiator_id, recipient_id, status, expires_at)
values ('c0700000-0000-4070-8000-0000000000b1', 'chat', 'c0700000-0000-4070-8000-000000000010',
        'c0700000-0000-4070-8000-000000000001', 'pending', now() + interval '23 hours');
insert into public.calls (conversation_id, caller_id, callee_id, medium, status)
values ('c0700000-0000-4070-8000-0000000000b1', 'c0700000-0000-4070-8000-000000000001',
        'c0700000-0000-4070-8000-000000000010', 'voice', 'ringing');

select is(
  (select string_agg(pp.kind || ':' || right(pp.recipient_id::text, 2)
                     || ':' || (pp.recipient_id = t.user_id)::text, ',' order by pp.created_at, pp.kind)
   from public.pending_pushes pp
   join public.push_tokens t on t.token = pp.token
   where pp.conversation_id = 'c0700000-0000-4070-8000-0000000000b1'),
  'message:10:true,message:01:true,contact:01:true',
  'every queued message and request names its token''s owner: the other side of the message, the member for a request'
);
select is(
  (select string_agg(right(cp.recipient_id::text, 2) || ':' || (cp.recipient_id = t.user_id)::text, ',')
   from public.pending_call_pushes cp
   join public.push_tokens t on t.token = cp.token
   where cp.conversation_id = 'c0700000-0000-4070-8000-0000000000b1'),
  '10:true',
  'and a ringing call names the callee, its token''s owner'
);

select * from finish();
rollback;
