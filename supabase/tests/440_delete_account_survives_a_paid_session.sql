-- pgTAP: Delete Account must work for a user who has actually used the app.
--
-- THE BUG THIS PINS. `delete_user_account()` (last defined in 028:271) deletes
-- `auth.users` and relies entirely on FK cascades: profiles → conversations →
-- messages are all ON DELETE CASCADE, so the advertised deletion happens.
--
-- But `paid_sessions` arrived later (030) with plain `references
-- public.profiles(id)` and no ON DELETE clause, so its three FKs were NO ACTION
-- — verified against the LIVE database on 2026-09-13, not just the migrations.
-- Deleting the profile cascaded the conversation away and left the
-- paid_sessions row pointing at both, so the RI check failed and the whole RPC
-- aborted with 23503.
--
-- Which meant Delete Account was broken for every user who had ever had a paid
-- session — i.e. every real user. It stayed green because both existing gates
-- delete a user who never had one: supabase/tests/010:141 bootstraps no
-- paid_sessions row, and scripts/seed-dev.sql seeds conversations, messages and
-- reviews but no session either.
--
-- THE FIX (migration 100) and therefore what this file asserts. Two kinds of
-- row, two answers:
--
--   • Financial rows are ANONYMISED, never destroyed. paid_sessions,
--     provider_earnings_ledger, provider_payout_batches and token_transactions
--     keep the row and SET NULL the identity, because minutes, rates and
--     amounts are the billing record and are not ours to delete because
--     somebody closed their account.
--   • Session mechanics CASCADE. A lease is a 30-second heartbeat and a request
--     is an invitation; neither means anything once a participant is gone.
--
-- So assertions 3 and 4 deliberately pin DIFFERENT delete rules on two FKs that
-- both used to be NO ACTION. That asymmetry is the decision, and a later change
-- that "tidies" them into one rule is the regression this file exists to catch.

begin;
select plan(8);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000005a1', 'member440@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000005a2', 'provider440@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a2'
);

-- The row that broke it: one ended, fully-billed session, which is what every
-- real account has.
insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, status, started_at, ended_at, end_reason,
  minutes_billed, tokens_debited
) values (
  'ffffffff-0000-0000-0000-0000000005a1',
  'cccccccc-0000-0000-0000-0000000005a1',
  'chat',
  'aaaaaaaa-0000-0000-0000-0000000005a1',
  'aaaaaaaa-0000-0000-0000-0000000005a2',
  22, 'ended', now() - interval '5 minutes', now(), 'manual', 5, 110
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

-- ── 2. Anonymised, not destroyed ───────────────────────────────────────────
-- The point of SET NULL over CASCADE. If this ever reads 0 rows, the session
-- row was deleted and 110 tokens of revenue left the books with it.
select is(
  (
    select format('%s/%s/%s', minutes_billed, tokens_debited,
                  coalesce(member_id::text, 'null'))
    from public.paid_sessions
    where id = 'ffffffff-0000-0000-0000-0000000005a1'
  ),
  '5/110/null',
  'the session row survives with its money, carrying no member identity'
);

-- ── 3-4. The two delete rules, which are deliberately different ────────────
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
  'SET NULL',
  'paid_sessions.member_id is anonymised, because the row is a billing record'
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
  'session_leases.user_id cascades, because a heartbeat outlives nobody'
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

-- ── 6-7. The PROVIDER side, which fails for a different reason ─────────────
-- Making provider_earnings_ledger survive the provider is what creates its own
-- blocker: record_provider_accrual (037) writes the paired token_transactions
-- row with user_id = provider_id, and THAT fk is CASCADE. So the transaction
-- disappears while the ledger row now stays, and ledger.transaction_id — also
-- NO ACTION until 100 — takes the delete down in place of the column this file
-- started out being about. A member-only test cannot see it.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000005b1', 'member440b@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000005b2', 'provider440b@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b2'
);

insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days,
  status, started_at, ended_at, end_reason, minutes_billed, tokens_debited
) values (
  'ffffffff-0000-0000-0000-0000000005b1',
  'cccccccc-0000-0000-0000-0000000005b1',
  'chat',
  'aaaaaaaa-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b2',
  22, 60, 7, 'ended', now() - interval '5 minutes', now(), 'manual', 5, 110
);

insert into public.token_transactions (
  id, user_id, kind, status, amount_paise, tokens_delta, session_id, provider_id
) values (
  'bbbbbbbb-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b2',
  'provider_accrual', 'succeeded', 6600, 66,
  'ffffffff-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b2'
);

insert into public.provider_earnings_ledger (
  id, provider_id, session_id, minutes_billed, rate_per_min,
  gross_tokens, provider_tokens, hold_until, transaction_id
) values (
  'dddddddd-0000-0000-0000-0000000005b1',
  'aaaaaaaa-0000-0000-0000-0000000005b2',
  'ffffffff-0000-0000-0000-0000000005b1',
  5, 22, 110, 66, now() + interval '7 days',
  'bbbbbbbb-0000-0000-0000-0000000005b1'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000005b2","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.delete_user_account() $$,
  'a provider who has been accrued earnings can delete their account'
);

reset role;

select is(
  (
    select format('%s/%s/%s', provider_tokens,
                  coalesce(provider_id::text, 'null'),
                  coalesce(transaction_id::text, 'null'))
    from public.provider_earnings_ledger
    where id = 'dddddddd-0000-0000-0000-0000000005b1'
  ),
  -- 101 changed this from '66/null/null': 100 made transaction_id SET NULL only
  -- because token_transactions.user_id was CASCADE and the accrual row was
  -- destroyed with the provider. Now user_id is SET NULL too (101), so the
  -- accrual transaction is anonymised rather than deleted and the ledger keeps
  -- its accounting cross-reference. provider_id (the identity column) is still
  -- null — the PII is still erased.
  '66/null/bbbbbbbb-0000-0000-0000-0000000005b1',
  'the earnings row survives with its amount, carrying no provider identity'
);

-- ── 8. A live session is ended BEFORE the cascade, never after ─────────────
-- The reason this matters is not tidiness. Section 1 of 100 lets an ENDED
-- session lose its identities; it does not make that safe for a live one.
-- meter_active_sessions would find an active session whose leases had cascaded
-- away, call end_session, and end_session inserts conversation_id into
-- conversation_thread_meta where it is the PRIMARY KEY — a 23502 that aborts
-- the whole cron pass and poisons every tick after it. Nobody gets billed
-- because one person tapped Delete Account.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000005c1', 'member440c@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000005c2', 'provider440c@test.local');

insert into public.conversations (id, member_id, provider_id)
values (
  'cccccccc-0000-0000-0000-0000000005c1',
  'aaaaaaaa-0000-0000-0000-0000000005c1',
  'aaaaaaaa-0000-0000-0000-0000000005c2'
);

insert into public.paid_sessions (
  id, conversation_id, channel, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days,
  status, accepted_at, started_at, last_activity_at, next_bill_at,
  minutes_billed, tokens_debited
) values (
  'ffffffff-0000-0000-0000-0000000005c1',
  'cccccccc-0000-0000-0000-0000000005c1',
  'audio',
  'aaaaaaaa-0000-0000-0000-0000000005c1',
  'aaaaaaaa-0000-0000-0000-0000000005c2',
  30, 60, 7, 'active',
  now() - interval '2 minutes', now() - interval '2 minutes',
  now(), now() + interval '1 minute', 2, 60
);

insert into public.session_leases (session_id, user_id) values
  ('ffffffff-0000-0000-0000-0000000005c1', 'aaaaaaaa-0000-0000-0000-0000000005c1'),
  ('ffffffff-0000-0000-0000-0000000005c1', 'aaaaaaaa-0000-0000-0000-0000000005c2');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000005c1","role":"authenticated"}',
  true
);
select public.delete_user_account();
reset role;

select is(
  (
    select status::text
    from public.paid_sessions
    where id = 'ffffffff-0000-0000-0000-0000000005c1'
  ),
  'ended',
  'a session the departing user was still in is ended before they are deleted'
);

select * from finish();
rollback;
