-- 100_account_deletion_cascades.sql
--
-- Delete Account works for a user who has actually used the app.
--
-- THE BUG. `delete_user_account()` (last defined in 028) deletes `auth.users`
-- and relies entirely on FK cascades. profiles → conversations → messages are
-- ON DELETE CASCADE, so a user who only ever chatted is deleted fine. But
-- `paid_sessions` (030), `session_leases` (030), `session_requests` (030),
-- `provider_earnings_ledger` (029) and `provider_payout_batches` (029) were all
-- written as plain `references public.profiles(id)` with no ON DELETE clause,
-- which is NO ACTION. Verified against the LIVE database on 2026-09-13:
--
--   paid_sessions_member_id_fkey             | a (NO ACTION)
--   paid_sessions_provider_id_fkey           | a
--   paid_sessions_conversation_id_fkey       | a
--   session_leases_user_id_fkey              | a
--   session_requests_initiator_id_fkey       | a
--   session_requests_recipient_id_fkey       | a
--   provider_earnings_ledger_provider_id_fkey| a
--   provider_payout_batches_provider_id_fkey | a
--   token_transactions_provider_id_fkey      | a
--
-- So the cascade removes the profile and the conversation, the paid_sessions
-- row is left pointing at both, the end-of-statement RI check fails, and the
-- whole RPC aborts with 23503. Delete Account has been broken for every user
-- who has ever had a paid session — i.e. every real user. It stayed green
-- because both existing gates delete a user who never had one.
--
-- THE DECISION (Amit, 2026-09-13). Two different kinds of row, two different
-- answers, and conflating them is what makes this look hard:
--
--   • ANONYMISE, never destroy, anything financial. provider_earnings_ledger,
--     provider_payout_batches and token_transactions are billing and GST
--     records. They must survive a deletion with the identity removed, not go
--     with it. Identity columns become nullable + ON DELETE SET NULL.
--
--   • CASCADE pure session mechanics. session_leases is a 30-second liveness
--     heartbeat and session_requests is an invitation; neither means anything
--     once one of the two people is gone.
--
--   • paid_sessions is BOTH. The row carries the money (minutes_billed,
--     tokens_debited, rate, timestamps) and the session state. Keep the ROW,
--     SET NULL the identities. `admin.session_margin` reads paid_sessions
--     directly with no join to profiles, so revenue still totals after a
--     deletion — which is the whole point of keeping the row.
--
-- WHAT THE DECISION DID NOT COVER, and is fixed here because the decision
-- cannot be implemented without it:
--
--   • paid_sessions.call_id and paid_sessions.request_id. Both are NO ACTION,
--     and their parents (calls, session_requests) now disappear with the user
--     while the paid_sessions row survives. Left alone, a member who had an
--     audio/video session still gets 23503 — the same bug, one table over, and
--     invisible to a chat-only test.
--   • provider_earnings_ledger.transaction_id. `record_provider_accrual` (037)
--     writes the provider_accrual token_transactions row with
--     `user_id = provider_id`, and token_transactions.user_id is CASCADE. So
--     deleting a PROVIDER deletes that transaction while the ledger row now
--     survives, and the NO ACTION transaction_id blocks the delete. Making the
--     ledger survive is precisely what creates this one.
--
-- STILL BROKEN AFTER THIS MIGRATION, deliberately, because it needs an owner
-- decision this one does not contain: `invoices.transaction_id` is RESTRICT and
-- NOT NULL, and token_transactions.user_id is CASCADE, so any member who has
-- ever been issued a GST invoice still cannot delete their account. Reproduced
-- on a fresh migrated database: "update or delete on table token_transactions
-- violates foreign key constraint invoices_transaction_id_fkey". Fixing it
-- means keeping a statutory invoice — which carries the buyer's name in
-- `invoices.buyer` — for a user who asked to be deleted. That is a legal and
-- product call, not a schema call.

-- No explicit BEGIN/COMMIT here, matching the other 99 migrations: the Supabase
-- CLI wraps each file in its own transaction, and a COMMIT inside that closes
-- it early — which would let the schema change land while the version record
-- that tracks it does not. That is the "deployed DB holds half a migration"
-- failure this project has already been bitten by.

-- ── 1. paid_sessions — keep the money, drop the identities ──────────────────
-- Three NOT NULLs come off. They were right for a live session and wrong for a
-- historical one: the row outlives the people in it.

alter table public.paid_sessions
  alter column member_id       drop not null,
  alter column provider_id     drop not null,
  alter column conversation_id drop not null;

alter table public.paid_sessions
  drop constraint paid_sessions_member_id_fkey,
  drop constraint paid_sessions_provider_id_fkey,
  drop constraint paid_sessions_conversation_id_fkey,
  drop constraint paid_sessions_request_id_fkey,
  drop constraint paid_sessions_call_fk;

alter table public.paid_sessions
  add constraint paid_sessions_member_id_fkey
    foreign key (member_id) references public.profiles(id) on delete set null,
  add constraint paid_sessions_provider_id_fkey
    foreign key (provider_id) references public.profiles(id) on delete set null,
  add constraint paid_sessions_conversation_id_fkey
    foreign key (conversation_id) references public.conversations(id) on delete set null,
  -- The invitation and the call row are session mechanics and cascade away with
  -- their participants (session_requests below; calls.caller_id/callee_id were
  -- already CASCADE). Without SET NULL here the surviving session row is left
  -- holding a dangling handle and the delete fails exactly as before.
  add constraint paid_sessions_request_id_fkey
    foreign key (request_id) references public.session_requests(id) on delete set null,
  add constraint paid_sessions_call_fk
    foreign key (call_id) references public.calls(id) on delete set null;

-- The NOT NULLs are not abandoned, they are re-scoped. A LIVE session must
-- still know who is in it and where: every reader that acts on a live session
-- (end_session, claim_session_lease, meter_active_sessions, get_active_session)
-- was written against three non-null columns, and several of them fail open on
-- NULL — `auth.uid() not in (member_id, provider_id)` is NULL, not true, so the
-- participant check does not raise. Rather than re-audit each of those for a
-- state that should never exist, forbid the state.
--
-- This also turns a silent corruption into a loud one: a profile deleted by
-- some path that does NOT end the user's sessions first (an admin deleting the
-- row by hand) now fails with 23514 instead of leaving an active, unbilled,
-- un-endable session behind. It is not a regression on today's behaviour —
-- today that same delete fails with 23503.
alter table public.paid_sessions
  add constraint paid_sessions_live_rows_are_identified check (
    status in ('ended', 'reported_hold')
    or (member_id is not null
        and provider_id is not null
        and conversation_id is not null)
  );

comment on constraint paid_sessions_live_rows_are_identified on public.paid_sessions is
  'A non-terminal session must carry all three identities (100). The columns '
  'are nullable so an ended session survives its participants being deleted — '
  'the row is a billing record — but a live one may never be anonymous: the '
  'metering and participant checks read those columns and fail open on NULL.';

comment on column public.paid_sessions.member_id is
  'Null once the member deletes their account (100). The row is kept because '
  'minutes_billed, tokens_debited and the rate snapshot are the billing record; '
  'only the identity goes. RLS (member_id = auth.uid()) makes an anonymised row '
  'invisible to every client, by construction rather than by a filter.';

comment on column public.paid_sessions.provider_id is
  'Null once the provider deletes their account (100). See member_id.';

comment on column public.paid_sessions.conversation_id is
  'Null once either participant deletes their account — conversations cascade '
  'with the profile (100). Kept nullable rather than cascading the session away '
  'because the session row is the billing record and the conversation is not.';

-- ── 2. Session mechanics — cascade ─────────────────────────────────────────
-- A lease is a 30-second heartbeat and a request is an invitation. Neither
-- survives its owner in any useful sense, and keeping either would only leave
-- meter_active_sessions reasoning about half a session.

alter table public.session_leases
  drop constraint session_leases_user_id_fkey;

alter table public.session_leases
  add constraint session_leases_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

alter table public.session_requests
  drop constraint session_requests_initiator_id_fkey,
  drop constraint session_requests_recipient_id_fkey;

alter table public.session_requests
  add constraint session_requests_initiator_id_fkey
    foreign key (initiator_id) references public.profiles(id) on delete cascade,
  add constraint session_requests_recipient_id_fkey
    foreign key (recipient_id) references public.profiles(id) on delete cascade;

-- ── 3. Financial records — anonymise ───────────────────────────────────────
-- These rows outlive the account on purpose. A payout that was accrued was
-- earned, and a GST-bearing ledger row is not ours to delete because someone
-- closed their account.

alter table public.provider_earnings_ledger
  alter column provider_id drop not null;

alter table public.provider_earnings_ledger
  drop constraint provider_earnings_ledger_provider_id_fkey,
  drop constraint provider_earnings_ledger_transaction_id_fkey;

alter table public.provider_earnings_ledger
  add constraint provider_earnings_ledger_provider_id_fkey
    foreign key (provider_id) references public.profiles(id) on delete set null,
  -- record_provider_accrual writes the paired token_transactions row with
  -- user_id = provider_id, and that FK is CASCADE. Deleting a provider
  -- therefore removes the transaction while this row now stays, so the handle
  -- has to be droppable or the delete fails on THIS constraint instead.
  add constraint provider_earnings_ledger_transaction_id_fkey
    foreign key (transaction_id) references public.token_transactions(id) on delete set null;

comment on column public.provider_earnings_ledger.provider_id is
  'Null once the provider deletes their account (100). The row is retained: '
  'minutes_billed, gross_tokens and provider_tokens are the accounting record '
  'for a session that was really billed. An anonymised row is invisible to '
  'admin.payable_providers (inner join to profiles) and to '
  'create_provider_payout_batch (where provider_id = p_provider_id), so a '
  'deleted provider is never paid — but the money is still counted.';

alter table public.provider_payout_batches
  alter column provider_id drop not null;

alter table public.provider_payout_batches
  drop constraint provider_payout_batches_provider_id_fkey;

alter table public.provider_payout_batches
  add constraint provider_payout_batches_provider_id_fkey
    foreign key (provider_id) references public.profiles(id) on delete set null;

comment on column public.provider_payout_batches.provider_id is
  'Null once the provider deletes their account (100). The batch is a payment '
  'that was actually made to a bank account; total_paise and cashfree_batch_id '
  'have to survive the payee. settle_provider_payout_batch and '
  'mark_provider_payout_submitted key off the batch id, never provider_id, so '
  'a Cashfree webhook for an in-flight batch still settles after the deletion.';

-- token_transactions.provider_id is already nullable (028 added it as "null for
-- non-session transactions"); only the delete rule is wrong.
alter table public.token_transactions
  drop constraint token_transactions_provider_id_fkey;

alter table public.token_transactions
  add constraint token_transactions_provider_id_fkey
    foreign key (provider_id) references public.profiles(id) on delete set null;

-- ── 4. delete_user_account — end the live sessions FIRST ───────────────────
-- The order matters and is the load-bearing part of this migration.
--
-- Section 1 lets an ENDED session lose its identities. It does not make that
-- safe for a LIVE one, and deleting an account does not otherwise end the
-- session the user is sitting in. Left alone, the next meter_active_sessions
-- tick would find an active session whose leases have cascaded away, call
-- end_session on it, and end_session would insert conversation_id = NULL into
-- conversation_thread_meta — where it is the PRIMARY KEY. That is a 23502
-- inside the cron sweep, which aborts the whole pass: nobody gets billed, and
-- the same row poisons every subsequent tick. A billing outage caused by one
-- person tapping Delete Account.
--
-- So the session is ended here, while the row is still whole: end_session bills
-- the final minute, records the provider accrual, hides the content and writes
-- the thread meta with a real conversation_id. Only then does the cascade run.
-- `paid_sessions_live_rows_are_identified` is what stops this being a promise —
-- if this loop is ever removed or misses a state, the DELETE fails loudly.
--
-- CREATE OR REPLACE retains the grant established in migration 002 and
-- re-stated in 028.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchased  integer;
  v_tx_id      uuid;
  v_session_id uuid;
begin
  -- 1. End anything still running. 'system' is an accepted end_reason (091).
  --    end_session's own participant check passes because the caller IS a
  --    participant — this runs before auth.uid()'s profile is gone.
  for v_session_id in
    select id
    from   public.paid_sessions
    where  (member_id = auth.uid() or provider_id = auth.uid())
      and  status not in ('ended', 'reported_hold')
    order  by created_at
  loop
    perform public.end_session(v_session_id, 'system', null, null, null);
  end loop;

  -- 2. Freeze any purchased balance as an account_close_hold ledger entry and
  --    queue it for admin refund review before the cascade removes the rows.
  select purchased_balance
  into   v_purchased
  from   public.profiles
  where  id = auth.uid();

  if v_purchased > 0 then
    insert into public.token_transactions (
      user_id, kind, status, amount_paise, tokens_delta
    ) values (
      auth.uid(), 'account_close_hold', 'created',
      v_purchased * 100, -v_purchased
    )
    returning id into v_tx_id;

    insert into public.refund_reviews (
      user_id, transaction_id, purchased_tokens, amount_paise
    ) values (
      auth.uid(), v_tx_id, v_purchased, v_purchased * 100
    );
  end if;

  -- 3. auth.users → profiles → conversations / messages / leases / requests
  --    cascade; paid_sessions and the billing ledgers are anonymised in place.
  --    The refund_reviews row cascades via transaction_id.
  delete from auth.users where id = auth.uid();
end;
$$;

comment on function public.delete_user_account() is
  'Deletes the caller''s account (002, 028, 100). Ends any live paid session '
  'first so no session is ever left active with a NULL participant, freezes '
  'purchased balance for refund review, then deletes auth.users and lets the '
  'FK rules run: session mechanics cascade, billing records are anonymised.';

grant execute on function public.delete_user_account() to authenticated;

-- ── 5. The two readers a NULL actually reaches ─────────────────────────────
-- Everything that acts on a LIVE session is unreachable by construction (§1's
-- CHECK). What remains are the readers of ENDED sessions, and two of them see
-- a NULL the code was not written for: one shows the surviving counterparty
-- the wrong thing, the other is an authorisation check that fails open. The
-- other readers were checked and are fine on NULL — get_active_session,
-- claim_session_lease, submit_review and the conversation_summaries lateral all
-- key off conversation_id or auth.uid() and simply stop matching; the
-- admin.session_margin and admin.payable_providers views still total the money
-- and correctly stop offering a deleted provider a payout.

-- 5a. get_usage_ledger (069). The provider's own ledger still lists the session
--     (ps.provider_id = v_uid still matches), and two fields go null underneath
--     a client that types them non-null in src/api/usage.ts:
--
--       'i_am_member' → `ps.member_id = v_uid` is NULL, not false, and
--       src/api/usage.ts types it `boolean`. The screen picks its role with
--       `rows[0]?.i_am_member === false` (UsageLedgerScreen.tsx:110), and
--       `null === false` is false — so if the provider's newest row happens to
--       be one of these, their whole earnings summary is labelled as spending.
--
--       'peer_name' → member_handle(NULL) concatenates to NULL, so the row
--       renders with a blank name.
--
--     `is not distinct from` returns a real boolean, and the deleted member
--     gets a name that says what happened.
create or replace function public.get_usage_ledger(
  p_limit  integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows  jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row_started_at desc), '[]'::jsonb)
  into   v_rows
  from (
    select
      jsonb_build_object(
        'session_id', ps.id,
        'channel',    ps.channel,
        'started_at', ps.started_at,
        'ended_at',   ps.ended_at,
        'minutes',    ps.minutes_billed,
        -- The caller's own side of the money, never both. `is not distinct
        -- from` rather than `=` because member_id is null once that account is
        -- deleted, and a null here is read as "not the provider" downstream.
        'i_am_member', ps.member_id is not distinct from v_uid,
        'tokens', case
          when ps.member_id = v_uid then ps.tokens_debited
          else coalesce(e.provider_tokens, 0)
        end,
        'earnings_status', case when ps.provider_id = v_uid then e.status end,
        'peer_id', case when ps.member_id = v_uid then ps.provider_id else ps.member_id end,
        'peer_name', case
          when ps.member_id is not distinct from v_uid
            then coalesce(d.display_name, 'Someone')
          -- member_handle(null) is null, and the row would render nameless.
          else coalesce(public.member_handle(ps.member_id), 'Deleted member')
        end
      ) as row,
      coalesce(ps.started_at, ps.accepted_at) as row_started_at
    from   public.paid_sessions ps
    left join public.provider_directory d on d.id = ps.provider_id
    left join public.provider_earnings_ledger e
           on e.session_id = ps.id and e.provider_id = v_uid
    where  (ps.member_id = v_uid or ps.provider_id = v_uid)
      -- Billed sessions only. A request that never became a minute is not a
      -- line in a ledger; it is something that did not happen.
      and  ps.minutes_billed > 0
      and  (p_before is null or coalesce(ps.started_at, ps.accepted_at) < p_before)
    order  by coalesce(ps.started_at, ps.accepted_at) desc
    limit  v_limit
  ) t;

  return v_rows;
end;
$$;

comment on function public.get_usage_ledger(integer, timestamptz) is
  'Per-session usage for the caller, newest first (069, 100). One RPC for both '
  'roles: a member reads what they spent, a provider reads their own share, '
  'and neither is shown the other''s figure. Billed sessions only. Carries no '
  'message content, because paid_sessions has none to carry. Sessions whose '
  'counterparty has deleted their account still appear, named "Deleted '
  'member" — the money was real.';

revoke all on function public.get_usage_ledger(integer, timestamptz) from public, anon;
grant execute on function public.get_usage_ledger(integer, timestamptz) to authenticated;

-- 5b. submit_session_review (066). `if v_uid <> v_session.member_id then raise`
--     is NULL when member_id is NULL, and `if NULL` does not raise — so the
--     "only the member may review" gate fails OPEN on an anonymised session,
--     which is by definition status = 'ended' and therefore past the other
--     gate. The insert then dies on reviews.conversation_id NOT NULL, so the
--     symptom is a 23502 rather than a forged review, but the check is still
--     wrong. `is distinct from` closes it, and an anonymised session gets the
--     honest answer: there is no member to review it.
create or replace function public.submit_session_review(
  p_session_id uuid,
  p_rating     smallint,
  p_comment    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session public.paid_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be 1..5' using errcode = '22023';
  end if;

  select * into v_session from public.paid_sessions where id = p_session_id;
  if not found then
    raise exception 'no such session' using errcode = 'no_data_found';
  end if;

  -- Only the paying side reviews. A provider rating a member is a different
  -- feature with different consequences, and is not this one (006's rule).
  -- `is distinct from`, not `<>`: member_id is null on a session whose member
  -- deleted their account, and `v_uid <> null` is null, which does not raise.
  if v_uid is distinct from v_session.member_id then
    raise exception 'only the member may review' using errcode = '42501';
  end if;

  -- Rate it when it is over. A rating mid-session would be a live scoreboard
  -- between two people who are still talking.
  if v_session.status <> 'ended' then
    raise exception 'the session has not ended' using errcode = '22023';
  end if;

  insert into public.reviews (
    conversation_id, session_id, member_id, provider_id, rating, comment
  ) values (
    v_session.conversation_id, p_session_id, v_session.member_id,
    v_session.provider_id, p_rating, nullif(btrim(coalesce(p_comment, '')), '')
  )
  on conflict (session_id) where session_id is not null do update
    set rating = excluded.rating,
        comment = excluded.comment,
        created_at = now();
end;
$$;

comment on function public.submit_session_review(uuid, smallint, text) is
  'The member rates ONE ended session, 1..5 with an optional comment (066, '
  '100). Re-submitting corrects it rather than adding a second opinion. Every '
  'row counts toward the provider''s average via refresh_provider_rating.';

revoke all on function public.submit_session_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_session_review(uuid, smallint, text) to authenticated;
