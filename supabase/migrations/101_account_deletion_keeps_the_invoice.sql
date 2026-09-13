-- 101_account_deletion_keeps_the_invoice.sql
--
-- Delete Account works for a user who has RECHARGED. 100 finished the sentence
-- it started with "STILL BROKEN AFTER THIS MIGRATION, deliberately"; this is
-- the rest of it, plus a second blocker 100 did not name.
--
-- THE BUG, both halves, reproduced on a fresh database with every migration
-- through 100 applied (2026-09-13). Neither needs a paid session, so 440 —
-- which is entirely about paid sessions — cannot see either one.
--
--   1. A member who was issued a GST invoice.
--        ERROR: update or delete on table "token_transactions" violates
--        foreign key constraint "invoices_transaction_id_fkey" on table
--        "invoices"
--      invoices.transaction_id is RESTRICT and NOT NULL, and
--      token_transactions.user_id is CASCADE. Deleting the user destroys the
--      transaction the invoice hangs off, the invoice refuses, the RPC aborts.
--
--   2. A member with any purchased balance at all — no invoice required.
--        ERROR: update or delete on table "profiles" violates foreign key
--        constraint "refund_reviews_user_id_fkey" on table "refund_reviews"
--      delete_user_account itself writes the refund_reviews row (028 §3, still
--      there in 100) one statement before the DELETE, and
--      refund_reviews.user_id is NO ACTION. The RPC is blocked by a row it
--      created seven lines earlier.
--
-- Live FK rules on 2026-09-13, read off the deployed database rather than the
-- migration files:
--
--   invoices.transaction_id       | RESTRICT  | NOT NULL
--   refund_reviews.user_id        | NO ACTION | NOT NULL
--   token_transactions.user_id    | CASCADE   | NOT NULL
--
-- THE DECISION (Amit, 2026-09-13). A GST tax invoice is a statutory record, so
-- it is kept INTACT — including invoices.buyer, which carries the recipient's
-- name and state:
--
--   • CGST Act 2017 s.36 requires the invoice to be retained until 72 months
--     from the due date of furnishing the annual return for that year.
--   • CGST Rules 2017 r.46 prescribes the particulars a tax invoice must bear,
--     and the recipient's name and address are among them. An invoice with the
--     buyer blanked is not an anonymised invoice, it is an invalid one — so
--     invoices.buyer is NOT anonymisable the way 100 anonymised member_id.
--   • DPDP Act 2023 s.8(7) requires erasure on withdrawal of consent EXCEPT
--     where retention is necessary for compliance with any law in force. The
--     invoice is that exception; nothing else about the account is.
--
-- So what changes is the ACCOUNT LINK, not the invoice. token_transactions.
-- user_id becomes nullable + ON DELETE SET NULL, exactly the treatment 100 gave
-- provider_earnings_ledger, provider_payout_batches and paid_sessions. The
-- transaction row — the GST-bearing record, the one carrying amount_paise —
-- survives with no owner, the invoice hanging off it survives untouched, and
-- nothing in the database points back at a deleted person.
--
-- WHY refund_reviews.user_id GETS THE SAME TREATMENT, AND WHY BOTH HALVES ARE
-- REQUIRED TOGETHER. This is the load-bearing part, and it was measured, not
-- reasoned: fixing refund_reviews.user_id ALONE makes the delete succeed and
-- silently destroys the refund case. Run against the repro database with
-- token_transactions.user_id left CASCADE:
--
--     refund_cases_left | paise_owed
--     ------------------+-----------
--                     0 |          0
--
-- ...for a member who closed an account holding 120 purchased tokens. The
-- reason is 028's own design: refund_reviews.transaction_id is ON DELETE
-- CASCADE onto the account_close_hold row, so when that transaction cascaded
-- away with the profile it took the refund case with it. 028's comment says so
-- in as many words — "Cascades on delete so this row is removed when the
-- account is hard-deleted" — which describes a queue that empties itself at the
-- moment it is filled. Once user_id is SET NULL the hold transaction survives,
-- so the refund case survives with it, and the money a departing member is owed
-- is finally still on the books when an admin goes looking for it.
--
-- THE READER AUDIT. Dropping NOT NULL means every reader can now see NULL, and
-- 100 found two that failed open. Every reader of these two columns was
-- enumerated from the LIVE catalog — pg_proc.prosrc, pg_policies,
-- pg_get_viewdef over public and admin, pg_trigger — not from the migration
-- files, and then read in full. The result this time is that NOTHING needs
-- changing, which is a claim that has to be shown rather than asserted:
--
--   • RLS token_transactions "Members read own transactions": user_id =
--     auth.uid(). NULL = uuid is NULL, not true, so an orphaned row is
--     invisible to every client. Fails CLOSED.
--   • RLS invoices "Members read own invoices": exists (... t.user_id =
--     auth.uid()). Same shape, same answer — the retained invoice is readable
--     by nobody once its owner is gone. Fails CLOSED. It is kept for the tax
--     authority, not for the app, and the RLS already says so.
--   • refund_reviews has RLS enabled and ZERO policies (028: "No client
--     policies — only service_role and the admin dashboard read this"), and a
--     repo-wide grep finds no reader at all: no view, no RPC, no admin surface,
--     no src/api. Dropping its NOT NULL cannot reach a reader because it has
--     none.
--   • credit_purchased_recharge (033): `where id = p_transaction_id and
--     user_id = p_user_id and status = 'created'`. On an orphaned row the
--     predicate is NULL, zero rows update, and the function takes its existing
--     "already processed or not found" early return without crediting. Fails
--     CLOSED — which is the right answer for a webhook landing after the payer
--     deleted their account.
--   • complete_recharge (097), mock_recharge (097), credit_promo_tokens (028),
--     deduct_tokens (028), delete_user_account (100): every one of them only
--     ever INSERTs user_id. None reads it.
--   • record_provider_accrual (037) is the only aggregate over this table, and
--     it counts `where session_id = p_session_id and kind = 'usage_debit'` —
--     keyed on the session, never on user_id. An orphaned row cannot enter
--     somebody else's total through it.
--   • Views: none. pg_get_viewdef over public and admin returns zero rows
--     mentioning either table, so admin.session_margin and
--     admin.payable_providers are untouched by this.
--
-- THE BALANCE QUESTION, answered directly because it is the scariest one: an
-- orphaned transaction cannot be summed into a live user's balance because NO
-- code path anywhere recomputes a balance from this ledger. sync_token_balance
-- is `new.token_balance := new.promo_balance + new.purchased_balance` — a
-- BEFORE trigger on profiles reading two columns of the row being written. The
-- ledger is an append-only record beside the balance, never its source. 450
-- pins this by touching a surviving member's profile after the deletion, firing
-- the recompute, and asserting the orphan's 300 tokens do not appear.
--
-- THE NEAR MISS, worth naming because it is invisible until it fires: SET NULL
-- is an UPDATE, and token_transactions carries an AFTER UPDATE trigger,
-- on_recharge_credited (046), which POSTs to the generate-invoice Edge Function.
-- It does not fire here only because its WHEN clause includes `old.status is
-- distinct from new.status`, and nulling user_id does not touch status. Had
-- that clause been the obvious `new.status = 'succeeded' and new.kind =
-- 'recharge'`, one Delete Account would have fired an invoice-generation HTTP
-- request per recharge the member ever made. A future edit to that WHEN clause
-- has to keep the status guard, and this is the second reason why.
--
-- WHY THERE IS NO CHECK CONSTRAINT HERE, unlike 100. 100 added
-- paid_sessions_live_rows_are_identified because a LIVE session has readers
-- that fail open on NULL, and forbidding the state was cheaper than re-auditing
-- them. Nothing equivalent exists here: every reader above fails closed, so a
-- CHECK would protect nothing and would instead convert a working deletion —
-- the member with a pending 'created' recharge — back into the 23503 this
-- migration exists to remove.

-- ── 1. token_transactions — keep the GST record, drop the owner ────────────
-- NOT NULL was right while the ledger belonged to somebody. The row outlives
-- them: amount_paise is what was charged, and that stays true after they leave.

alter table public.token_transactions
  alter column user_id drop not null;

alter table public.token_transactions
  drop constraint token_transactions_user_id_fkey;

alter table public.token_transactions
  add constraint token_transactions_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;

comment on column public.token_transactions.user_id is
  'Null once the account is deleted (101). The row is retained rather than '
  'cascaded because amount_paise is the GST-bearing record and invoices.'
  'transaction_id is RESTRICT — the statutory invoice hangs off it and must '
  'survive 72 months (CGST Act s.36). Only the account link goes. RLS '
  '(user_id = auth.uid()) makes an orphaned row invisible to every client by '
  'construction, and no balance is ever computed from this table, so an '
  'ownerless row cannot reach anybody''s wallet.';

-- ── 2. refund_reviews — the case outlives the person it is owed to ─────────
-- Same rule, and required in the same migration: on its own this only stops the
-- 23503, it does not stop the case being destroyed by the cascade above.

alter table public.refund_reviews
  alter column user_id drop not null;

alter table public.refund_reviews
  drop constraint refund_reviews_user_id_fkey;

alter table public.refund_reviews
  add constraint refund_reviews_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete set null;

comment on column public.refund_reviews.user_id is
  'Null once the account is deleted (101). Until now this FK was NO ACTION and '
  'blocked the very deletion that writes the row. The case is kept because the '
  'money is genuinely owed: purchased_tokens and amount_paise are the amount, '
  'and they are on this row rather than fetched through the profile precisely '
  'so the case still reads after the person is gone.';

-- 028 wrote this comment describing a row that cascades away with the account.
-- It no longer does, and leaving the old text in place would tell the next
-- reader the queue self-empties on purpose.
comment on column public.refund_reviews.transaction_id is
  'The account_close_hold token_transactions row. Still ON DELETE CASCADE, but '
  'since 101 that transaction is anonymised rather than deleted when the '
  'account goes, so this case now SURVIVES the closure it records. Before 101 '
  'it did not: the hold transaction cascaded with the profile and took the '
  'refund case with it, so the queue emptied itself at the moment it was '
  'filled and no departing member''s purchased balance was ever reviewed.';

-- No change to delete_user_account. Its body is already correct for this — it
-- writes the hold and the review and then deletes auth.users; the only reason
-- that failed was the two FK rules above. Re-defining it would churn the grant
-- for nothing.
