-- 510, Truecaller external identity ownership and one-time challenges
--
-- Migration 127 is an authentication boundary. These are executable checks of
-- its grants, owner resolution, conflict behavior, idempotency, challenge
-- retryability/consumption, and deletion cascade.
begin;
select plan(24);

select has_schema('private', 'private identity schema exists');
select has_table('private', 'external_identities', 'external identities are private');
select has_table('private', 'pending_identity_challenges', 'pending challenges are private');

-- Neither app role can inspect the private tables or invoke the resolver RPCs.
select is(
  (select count(*)::int
     from information_schema.role_table_grants
    where table_schema = 'private'
      and grantee in ('anon', 'authenticated')),
  0,
  'private identity tables have no app-role grants'
);
select is(
  (select count(*)::int
     from information_schema.role_routine_grants
    where routine_name in (
      'resolve_phone_owner',
      'resolve_external_identity',
      'upsert_external_identity',
      'create_pending_challenge',
      'read_pending_challenge',
      'consume_and_link_pending_challenge'
    )
      and grantee in ('anon', 'authenticated')),
  0,
  'identity RPCs have no app-role grants'
);
select is(
  (select count(distinct routine_name)::int
     from information_schema.role_routine_grants
    where routine_name in (
      'resolve_phone_owner',
      'resolve_external_identity',
      'upsert_external_identity',
      'create_pending_challenge',
      'read_pending_challenge',
      'consume_and_link_pending_challenge'
    )
      and grantee = 'service_role'),
  6,
  'service_role can execute every identity RPC'
);

insert into auth.users (id, phone) values
  ('cccccccc-5100-4000-8000-000000000001', '919000000001'),
  ('cccccccc-5100-4000-8000-000000000002', null),
  ('cccccccc-5100-4000-8000-000000000003', null);

-- User 2 represents an existing Google account that verified its phone through
-- the prior verification flow: auth.users.phone is null, profiles owns it.
select public.verify_phone(
  'cccccccc-5100-4000-8000-000000000002',
  '+919000000002'
);

select is(
  public.resolve_phone_owner('+919000000001'),
  'cccccccc-5100-4000-8000-000000000001'::uuid,
  'auth.users.phone resolves the existing phone-auth account'
);
select is(
  public.resolve_phone_owner('+919000000002'),
  'cccccccc-5100-4000-8000-000000000002'::uuid,
  'verified profile phone resolves an existing Google account'
);
select is(
  public.resolve_phone_owner('+919000000099'),
  null::uuid,
  'an unseen phone has no owner'
);
select throws_ok(
  $$select public.resolve_phone_owner('9000000001')$$,
  '22023', null,
  'phone resolution requires E.164'
);

-- First link and exact retry are allowed.
select lives_ok(
  $$select public.upsert_external_identity(
      'truecaller', 'tc-sub-1', '+919000000001',
      'cccccccc-5100-4000-8000-000000000001'
    )$$,
  'first Truecaller identity link succeeds'
);
select lives_ok(
  $$select public.upsert_external_identity(
      'truecaller', 'tc-sub-1', '+919000000001',
      'cccccccc-5100-4000-8000-000000000001'
    )$$,
  'exact identity retry is idempotent'
);
select is(
  public.resolve_external_identity('truecaller', 'tc-sub-1'),
  'cccccccc-5100-4000-8000-000000000001'::uuid,
  'stable Truecaller subject resolves its user'
);

-- Reassignment and phone mutation fail closed.
select throws_ok(
  $$select public.upsert_external_identity(
      'truecaller', 'tc-sub-1', '+919000000001',
      'cccccccc-5100-4000-8000-000000000002'
    )$$,
  'P0001', null,
  'a subject cannot move to another user'
);
select throws_ok(
  $$select public.upsert_external_identity(
      'truecaller', 'tc-sub-1', '+919000000003',
      'cccccccc-5100-4000-8000-000000000001'
    )$$,
  'P0001', null,
  'a subject cannot silently change phone'
);
select throws_ok(
  $$select public.upsert_external_identity(
      'truecaller', 'tc-sub-2', '+919000000001',
      'cccccccc-5100-4000-8000-000000000002'
    )$$,
  'P0001', null,
  'a phone cannot move to another Truecaller subject'
);

-- Pending challenge is readable without consumption, then atomically linked
-- and consumed. A second consume fails; no half-linked success is possible.
select public.create_pending_challenge(
  'truecaller', 'tc-sub-2', '+919000000002', 'challenge-hash-1'
);
select is(
  (select out_phone from public.read_pending_challenge('challenge-hash-1')),
  '+919000000002',
  'active challenge can be read before a network-side user operation'
);
select is(
  (select consumed_at is null
     from private.pending_identity_challenges
    where challenge_hash = 'challenge-hash-1'),
  true,
  'reading a challenge does not consume it'
);
select lives_ok(
  $$select public.consume_and_link_pending_challenge(
      'challenge-hash-1',
      'cccccccc-5100-4000-8000-000000000002'
    )$$,
  'link and challenge consumption commit atomically'
);
select is(
  public.resolve_external_identity('truecaller', 'tc-sub-2'),
  'cccccccc-5100-4000-8000-000000000002'::uuid,
  'atomic consume created the external identity'
);
select throws_ok(
  $$select public.consume_and_link_pending_challenge(
      'challenge-hash-1',
      'cccccccc-5100-4000-8000-000000000002'
    )$$,
  'P0002', null,
  'a consumed challenge cannot be replayed'
);

-- Expired challenge cannot be read or consumed.
insert into private.pending_identity_challenges
  (provider, subject, phone_e164, challenge_hash, expires_at)
values
  ('truecaller', 'tc-expired', '+919000000003', 'challenge-expired', now() - interval '1 second');
select is(
  (select out_phone from public.read_pending_challenge('challenge-expired')),
  null::text,
  'expired challenge is unreadable'
);
select throws_ok(
  $$select public.consume_and_link_pending_challenge(
      'challenge-expired',
      'cccccccc-5100-4000-8000-000000000003'
    )$$,
  'P0002', null,
  'expired challenge cannot link'
);

-- Auth-user deletion cascades identity ownership.
delete from auth.users where id = 'cccccccc-5100-4000-8000-000000000001';
select is(
  (select count(*)::int from private.external_identities where subject = 'tc-sub-1'),
  0,
  'account deletion removes the external identity'
);

select * from finish();
rollback;
