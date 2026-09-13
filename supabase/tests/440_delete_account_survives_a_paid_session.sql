-- pgTAP: Delete Account must work for a user who has actually used the app.
--
-- THE BUG. `delete_user_account()` (last defined in 028:271) deletes
-- `auth.users` and relies entirely on FK cascades: profiles → conversations →
-- messages are all ON DELETE CASCADE, so the advertised deletion happens.
--
-- But `paid_sessions` arrived later (030) with plain `references
-- public.profiles(id)` and no ON DELETE clause, so its three FKs are NO ACTION
-- — verified against the LIVE database on 2026-09-13, not just the migrations.
-- Deleting the profile cascades the conversation away and leaves the
-- paid_sessions row pointing at both, so the RI check fails and the whole RPC
-- aborts with 23503.
--
-- Which means Delete Account is broken for every user who has ever had a paid
-- session — i.e. every real user. It has stayed green because both existing
-- gates delete a user who never had one: supabase/tests/010:141 bootstraps no
-- paid_sessions row, and scripts/seed-dev.sql seeds conversations, messages and
-- reviews but no session either.
--
-- Assertion 1 is the bug, stated as the behaviour we want; it FAILS until the
-- cascade decision is made and implemented. 2-4 pin the surrounding facts so a
-- fix cannot quietly trade one breakage for another.

begin;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000005a1', 'member440@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000005a2', 'provider440@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a2'
);

-- The row that breaks it: one ended, fully-billed session, which is what every
-- real account has.
insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, status, started_at, ended_at, end_reason, minutes_billed
) values (
  'ffffffff-0000-0000-0000-0000000005a1',
  'cccccccc-0000-0000-0000-0000000005a1',
  'chat',
  'aaaaaaaa-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a2',
  22, 'ended', now() - interval '5 minutes', now(), 'manual', 5
);

-- ── 1. THE BUG ─────────────────────────────────────────────────────────────
-- Run as the member, which is who the RPC serves.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000005a1","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.delete_user_account() $$,
  'a member who has had a paid session can delete their account'
);

reset role;

-- ── 2-4. The facts a fix must not break ────────────────────────────────────
select is(
  (
    select rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.constraint_name = 'paid_sessions_member_id_fkey'
  ),
  'CASCADE',
  'paid_sessions.member_id no longer blocks the delete'
);

select is(
  (
    select rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.constraint_name = 'session_leases_user_id_fkey'
  ),
  'CASCADE',
  'session_leases.user_id no longer blocks the delete'
);

/*
 * The RPC still exists and is still callable by an ordinary signed-in user —
 * asserted so a fix cannot "solve" this by revoking the grant or renaming the
 * function, which would make the button fail differently rather than work.
 */
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_user_account'
  ),
  1,
  'delete_user_account is still the one function the client calls'
);

select * from finish();
rollback;
