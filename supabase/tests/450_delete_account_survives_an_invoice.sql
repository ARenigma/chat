-- pgTAP: Delete Account must work for a user who has RECHARGED.
--
-- 440 covers the member who had a paid SESSION. This covers the member who put
-- money in, which is a different set of tables and a different pair of FKs, and
-- neither of the two blockers here needs a session to exist at all — so 440
-- stayed green through both of them.
--
-- THE TWO BUGS THIS PINS, reproduced on a fresh database with migrations
-- through 100 applied (2026-09-13):
--
--   1. ERROR: update or delete on table "token_transactions" violates foreign
--      key constraint "invoices_transaction_id_fkey" on table "invoices"
--      invoices.transaction_id is RESTRICT and NOT NULL; token_transactions.
--      user_id was CASCADE. Deleting the member destroyed the transaction the
--      GST invoice hangs off, and the invoice refused.
--
--   2. ERROR: update or delete on table "profiles" violates foreign key
--      constraint "refund_reviews_user_id_fkey" on table "refund_reviews"
--      refund_reviews.user_id was NO ACTION, and delete_user_account writes
--      that row itself, seven lines before the DELETE it then blocks. Any
--      member holding purchased balance hit this — no invoice required.
--
-- THE FIX (migration 101) and therefore what this file asserts. The invoice is
-- a statutory record — CGST Act s.36 requires it for 72 months, CGST Rules r.46
-- requires it to carry the recipient's particulars, and DPDP Act 2023 s.8(7)
-- exempts retention required by law from an erasure request. So the invoice
-- survives INTACT, buyer included. What is severed is the ACCOUNT LINK:
-- token_transactions.user_id and refund_reviews.user_id become nullable with ON
-- DELETE SET NULL, the same treatment 100 gave the other financial tables.
--
-- Assertion 9 is the one that stops the easy wrong fix. Making
-- invoices.transaction_id CASCADE would also make Delete Account work, and it
-- would delete the tax invoice to do it. That FK must stay RESTRICT.

begin;
select plan(10);

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- A leaves. B stays, and exists solely so that every "the orphan touched
-- nothing" assertion has a live account to have been wrong about.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000006a1', 'member450a@test.local'),
  ('aaaaaaaa-0000-0000-0000-0000000006b1', 'member450b@test.local');

-- A real recharge: the ₹354 pack, 300 tokens, 18% GST. Inserted as 'succeeded'
-- the way mock_recharge writes it; the on_recharge_inserted trigger (046) fires
-- and no-ops here because the harness has no Vault and no pg_net.
insert into public.token_transactions (
  id, user_id, kind, status, amount_paise, tokens_delta, gateway, gateway_ref
) values
  ('bbbbbbbb-0000-0000-0000-0000000006a1', 'aaaaaaaa-0000-0000-0000-0000000006a1',
   'recharge', 'succeeded', 35400, 300, 'cashfree', 'cf-450-a'),
  ('bbbbbbbb-0000-0000-0000-0000000006b1', 'aaaaaaaa-0000-0000-0000-0000000006b1',
   'recharge', 'succeeded', 29500, 250, 'cashfree', 'cf-450-b');

insert into public.invoices (
  transaction_id, invoice_number, document_type, fy, seller, buyer,
  place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise, gst_rate_bps
) values
  ('bbbbbbbb-0000-0000-0000-0000000006a1', 'PPL/2026-27/00042', 'tax_invoice', '2026-27',
   '{"legal_name":"Axionix Technologies","state":"Uttar Pradesh"}'::jsonb,
   '{"name":"Departing Member","state":"Uttar Pradesh"}'::jsonb,
   'Uttar Pradesh', 30000, 2700, 2700, 35400, 1800),
  ('bbbbbbbb-0000-0000-0000-0000000006b1', 'PPL/2026-27/00043', 'tax_invoice', '2026-27',
   '{"legal_name":"Axionix Technologies","state":"Uttar Pradesh"}'::jsonb,
   '{"name":"Staying Member","state":"Uttar Pradesh"}'::jsonb,
   'Uttar Pradesh', 25000, 2250, 2250, 29500, 1800);

-- Unspent purchased balance is what makes delete_user_account write the
-- refund_reviews row, which is blocker 2. A member who recharged and did not
-- spend every token is the ordinary case, not an edge one.
update public.profiles set purchased_balance = 300
  where id = 'aaaaaaaa-0000-0000-0000-0000000006a1';
update public.profiles set purchased_balance = 250
  where id = 'aaaaaaaa-0000-0000-0000-0000000006b1';

-- ── 1. THE BUG ─────────────────────────────────────────────────────────────
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006a1","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.delete_user_account() $$,
  'a member who recharged and was invoiced can delete their account'
);

reset role;

-- ── 2. The invoice survives INTACT, buyer and all ──────────────────────────
-- Not anonymised: a tax invoice without the recipient's particulars is not a
-- redacted invoice, it is an invalid one (CGST Rules r.46). If this ever reads
-- null, somebody decided to "anonymise" a statutory document.
select is(
  (
    select format('%s/%s/%s', invoice_number, total_paise, buyer ->> 'name')
    from public.invoices
    where transaction_id = 'bbbbbbbb-0000-0000-0000-0000000006a1'
  ),
  'PPL/2026-27/00042/35400/Departing Member',
  'the GST invoice survives with its number, total and buyer'
);

-- ── 3. The transaction survives with the money and no owner ────────────────
select is(
  (
    select format('%s/%s/%s', amount_paise, tokens_delta,
                  coalesce(user_id::text, 'null'))
    from public.token_transactions
    where id = 'bbbbbbbb-0000-0000-0000-0000000006a1'
  ),
  '35400/300/null',
  'the transaction survives with its amount, carrying no account link'
);

-- ── 4. The refund case survives ────────────────────────────────────────────
-- The half-fix catcher. Making ONLY refund_reviews.user_id SET NULL also makes
-- assertion 1 pass — and then the account_close_hold transaction cascades away
-- with the profile and takes this row with it via refund_reviews.transaction_id
-- (028, ON DELETE CASCADE). Measured on the repro database: 0 cases left, 0
-- paise owed, for a member who closed holding 120 purchased tokens. Both
-- columns have to be SET NULL, and this is the assertion that says why.
select is(
  (
    -- count(user_id) counts NON-NULL owners, so the trailing 0 is "no
    -- surviving case names anybody" — the anonymisation, stated as a number
    -- rather than as a null that could also mean "no rows".
    select format('%s/%s/%s/%s', count(*), coalesce(sum(purchased_tokens), 0),
                  coalesce(sum(amount_paise), 0), count(user_id))
    from public.refund_reviews
  ),
  '1/300/30000/0',
  'the unspent balance is still queued for refund, owed to nobody named'
);

-- ── 5-6. The orphan reaches no live wallet ─────────────────────────────────
-- 300 orphaned tokens now sit in the ledger with no owner. The reason they
-- cannot land in B's balance is not a filter someone remembered to write: no
-- code path recomputes a balance from token_transactions at all.
-- sync_token_balance is `token_balance := promo_balance + purchased_balance`,
-- a BEFORE trigger on profiles reading two columns of the row being written.
select is(
  (
    select token_balance from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000006b1'
  ),
  250,
  'a surviving member''s balance is untouched by the deletion'
);

-- Fire the recompute deliberately rather than trusting that it is never fired.
-- The trigger is UPDATE OF promo_balance, purchased_balance, so assigning a
-- column to itself still runs it.
update public.profiles set promo_balance = promo_balance
  where id = 'aaaaaaaa-0000-0000-0000-0000000006b1';

select is(
  (
    select token_balance from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000006b1'
  ),
  250,
  'recomputing that balance does not sum the orphaned 300 tokens into it'
);

-- ── 7-8. The two delete rules ──────────────────────────────────────────────
select is(
  (
    select rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.constraint_name = 'token_transactions_user_id_fkey'
  ),
  'SET NULL',
  'token_transactions.user_id is anonymised, because the row carries the GST amount'
);

select is(
  (
    select rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.constraint_name = 'refund_reviews_user_id_fkey'
  ),
  'SET NULL',
  'refund_reviews.user_id is anonymised, so the case outlives the person owed'
);

-- ── 9. The wrong fix, forbidden ────────────────────────────────────────────
-- CASCADE here would make assertion 1 pass by deleting the tax invoice. RESTRICT
-- is what makes the invoice un-deletable, and it is the reason the account link
-- had to be severed instead of the record destroyed.
select is(
  (
    select rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.constraint_name = 'invoices_transaction_id_fkey'
  ),
  'RESTRICT',
  'invoices.transaction_id stays RESTRICT: a tax invoice is never deleted to unblock a delete'
);

-- ── 10. Retained, not exposed ──────────────────────────────────────────────
-- The invoice is kept for the tax authority, not for the app. The existing RLS
-- policy — exists(... t.user_id = auth.uid()) — already fails closed on NULL,
-- so the orphaned invoice is readable by nobody while B still reads their own.
-- This is the assertion that proves "retain the record" did not quietly become
-- "publish a stranger's name and address".
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-0000000006b1","role":"authenticated"}',
  true
);

select is(
  (select string_agg(invoice_number, ',' order by invoice_number)
   from public.invoices),
  'PPL/2026-27/00043',
  'a signed-in member reads only their own invoice; the orphaned one is invisible'
);

reset role;

select * from finish();
rollback;
