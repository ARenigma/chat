-- pgTAP for migration 012: presence as a declaration, and the fourth guard on
-- profiles.
--
-- Written as the attack, or as the lie, wherever there is one. The assertions
-- that carry weight are not "presence can be set" but the four a plausible
-- implementation gets wrong:
--
--   - the new guard silently deleted the three that were already there, which is
--     what 010 did and the reason additive triggers are the house rule
--   - the guard is SECURITY DEFINER, so `current_user` is the owner, the branch
--     is never reached, and every check inside it passes everything
--   - a provider restates the age or gender a member paid to choose them on
--   - a MEMBER declares presence and the provider waiting on them still cannot
--     see it, because the old column resolved a provider-only join

\set ON_ERROR_STOP on
begin;
select plan(38);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_column('public', 'profiles', 'presence', 'presence is a declared column');
select col_not_null('public', 'profiles', 'presence', 'and every row has one');
select has_trigger(
  'public', 'profiles', 'guard_profile_pii_columns',
  'the PII columns get a FOURTH additive guard, not an edit to the other three'
);

-- The regression 010 is the record of. Each of these is a trigger an earlier
-- migration added, and the way to delete one is to rewrite a sibling from an
-- older copy of its body, which leaves no diff worth reading.
-- Note the words are swapped between the two: the FUNCTION is
-- `guard_privileged_profile_columns` and the TRIGGER is
-- `guard_profile_privileged_columns`. Worth the sentence, because getting it the
-- wrong way round makes `has_trigger` fail while the guard is perfectly attached.
select has_trigger(
  'public', 'profiles', 'guard_profile_privileged_columns',
  'and 003''s guard is still attached'
);
select has_trigger(
  'public', 'profiles', 'guard_profile_phone_columns',
  'and 010''s'
);
select has_trigger(
  'public', 'profiles', 'guard_profile_presence_columns',
  'and 011''s'
);

-- SECURITY INVOKER is not a style preference here. Under DEFINER `current_user`
-- is the function owner, so `current_user in ('authenticated','anon')` is false
-- for every caller and the guard passes everything while reading as a guard.
select is(
  (select p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_pii_columns'),
  false,
  'the guard runs as the caller, or its own condition can never be true'
);

select has_column(
  'public', 'provider_directory', 'presence',
  'the directory publishes the declared state'
);
select hasnt_column(
  'public', 'provider_directory', 'date_of_birth',
  'and still never the birth date, after the replace'
);
select has_column(
  'public', 'provider_directory', 'age',
  'which is still computed rather than stored'
);
select has_column(
  'public', 'conversation_peers', 'peer_presence',
  'the peer projection publishes it for either role'
);
select has_column(
  'public', 'conversation_summaries', 'peer_presence',
  'and so does the inbox'
);
-- 012 removed it so nothing could read the listing switch as presence. That
-- decision was reversed on 2026-09-17 (111): the master switch IS reachability
-- now, and 037's rebuild left the inbox without it, so every provider read as
-- not loaded on the rail. 155 put it back on purpose; 570 asserts the value.
select has_column(
  'public', 'conversation_summaries', 'peer_available',
  'the master switch is back on the inbox, because it is what the rail reads (155)'
);

-- Dropping and recreating a view discards its grants, and `authenticated`
-- losing SELECT here empties every inbox in the product. Counted rather than
-- compared for equality on purpose: harness.sql runs `alter default privileges
-- in schema public grant all on tables to anon, authenticated` BEFORE the
-- migrations, so a freshly created view arrives holding every privilege and an
-- exact-equality assertion would measure the harness rather than the migration.
-- The revoke is what closes it, which is why anon is checked separately below.
select is(
  (select count(*)::int
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'conversation_summaries'
     and grantee = 'authenticated' and privilege_type = 'SELECT'),
  1,
  'the recreated inbox view kept the grant a drop would have discarded'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_name = 'conversation_summaries' and grantee = 'anon'),
  0, 'and anon still cannot read it'
);

-- ---------------------------------------------------------------------------
-- Fixtures: one provider, one member, one outsider, one thread
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-000000000001'),  -- provider
  ('bbbbbbbb-0000-4000-8000-000000000002'),  -- member
  ('cccccccc-0000-4000-8000-000000000003');  -- unrelated member

-- `languages` required by migration 075 for the approval below to succeed.
insert into public.provider_applications (user_id, display_name, date_of_birth, gender, headline, languages)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Ada',
        (current_date - interval '26 years')::date, 'female', 'I listen', array['English']);

select lives_ok(
  $$select public.approve_provider_application('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'the provider is admitted, which is the one path that may write these columns'
);
select is(
  (select gender from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001')::text,
  'female',
  'and the definer path wrote through the guard, as SECURITY DEFINER should'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
insert into test.fixture (k, v)
values ('thread', public.open_conversation('aaaaaaaa-0000-4000-8000-000000000001'));
reset role;

-- ---------------------------------------------------------------------------
-- The guard: narrow enough to be usable, wide enough to be worth having
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

-- The hole 012 closes. Before it, `member_is_pseudonymous` stopped a member
-- holding these and nothing stopped a PROVIDER rewriting them, which are the
-- two fields plus the age a member paid to choose a person on.
select throws_ok(
  $$update public.profiles set gender = 'male'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'a provider cannot restate the gender a member chose them on'
);
select throws_ok(
  $$update public.profiles set headline = 'anything you like'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor the headline'
);
select throws_ok(
  $$update public.profiles set date_of_birth = (current_date - interval '19 years')::date
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor the birth date the age is computed from'
);
select is(
  (select headline from public.profiles
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  'I listen', 'and none of the three landed'
);

-- Narrowness proved, not assumed. A guard that also froze the two switches
-- would put a support ticket between somebody and the ability to stop being
-- contacted, which is the opposite of what this product owes them.
select lives_ok(
  $$update public.profiles set presence = 'here'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'presence is writable by its owner, instantly and without an RPC'
);
select lives_ok(
  $$update public.profiles set is_available = false
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'and so is the listing switch, which is a different question'
);
-- The three siblings still fire, which is the whole claim of the additive
-- pattern: four triggers on one table, each raising on its own columns.
select throws_ok(
  $$update public.profiles set token_balance = 9999
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  '003''s guard still refuses a self-granted balance'
);
select throws_ok(
  $$update public.profiles set last_active_at = now() - interval '3 days'
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null,
  'and 011''s still refuses a backdated stamp'
);
reset role;

-- ---------------------------------------------------------------------------
-- A member is pseudonymous, and the CHECK is what says so
-- ---------------------------------------------------------------------------
-- Two mechanisms, two error codes, and the difference is worth pinning: 23514 is
-- the constraint saying a member row holding this is not representable, 42501 is
-- the guard saying no client writes it. A member hits the guard first because
-- both are true of them.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set headline = 'looking for someone'
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'$$,
  '42501', null,
  'a member has no headline to set, and now two separate things say so'
);
select lives_ok(
  $$select public.submit_provider_application(
      'Bea', 'female', (current_date - interval '31 years')::date,
      'I listen too', ARRAY['en'], 'Years of it.')$$,
  'and can still apply, because the application holds the claim, not the profile'
);
select is(
  (select date_of_birth from public.profiles
    where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  null, 'leaving no birth date on the member row while it is under review'
);
reset role;

-- The service role bypasses RLS but not a CHECK, which is the point of 011
-- stating pseudonymity as a constraint rather than as a policy.
select throws_ok(
  $$update public.profiles set gender = 'female'
    where id = 'cccccccc-0000-4000-8000-000000000003'$$,
  '23514', null,
  'not even the owner can put a gender on a member row'
);

-- ---------------------------------------------------------------------------
-- Presence reaches the person waiting on it, from either side
-- ---------------------------------------------------------------------------
-- The bug the old column made unrepresentable. `peer_available` was
-- `case when peer.role = 'provider' then peer.is_available else false end`, so a
-- member peer was false forever and the provider's inbox rendered every row as
-- absent whatever the member had chosen.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
update public.profiles set presence = 'here'
where id = 'bbbbbbbb-0000-4000-8000-000000000002';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
-- Migration 037 renamed conversation_summaries.id → conversation_summaries.conversation_id (ADR-0020).
select is(
  (select peer_presence from public.conversation_summaries
    where conversation_id = (select v from test.fixture where k = 'thread'))::text,
  'here',
  'a MEMBER can be present to the provider waiting on them, which is new'
);
select is(
  (select peer_display_name from public.conversation_summaries
    where conversation_id = (select v from test.fixture where k = 'thread')),
  'Member bbbb',
  'and is still addressed by a handle rather than a name they typed elsewhere'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select peer_presence from public.conversation_summaries
    where conversation_id = (select v from test.fixture where k = 'thread'))::text,
  'here',
  'and the provider''s own declaration reaches the member, symmetrically'
);
-- Availability is a different question, and the answer being different is the
-- evidence that 012 separated two things that were one column.
select is(
  (select presence from public.provider_directory
    where id = 'aaaaaaaa-0000-4000-8000-000000000001')::text,
  'here', 'the directory publishes presence'
);
select is(
  (select is_available from public.provider_directory
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  false,
  'for a provider who is here and closed for work, which used to be one dot'
);
reset role;

-- Hidden publishes nothing, and the value itself is what a client reads to
-- render no line at all rather than guessing from a null.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set presence = 'hidden'
where id = 'aaaaaaaa-0000-4000-8000-000000000001';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select peer_presence from public.conversation_summaries
    where conversation_id = (select v from test.fixture where k = 'thread'))::text,
  'hidden', 'turning it off is retroactive, and says so rather than going null'
);
select is(
  (select count(*)::int from public.conversation_peers),
  1, 'and a caller still sees only the peers of threads they are in'
);
reset role;

-- The outsider check, because `conversation_peers` is SECURITY DEFINER and its
-- WHERE clause is the entire access control. 004 is the record of what a
-- decorative definer boundary costs.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversation_peers),
  0, 'somebody with no thread here learns nobody''s presence'
);
select is(
  (select count(*)::int from public.conversation_summaries),
  0, 'nor sees the thread'
);
reset role;

select * from finish();
rollback;
