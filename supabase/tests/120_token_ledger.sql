-- pgTAP for migration 019: token ledger, invoice counters, and GST invoices.
--
-- Assertions proven here:
--   - The three tables exist and their key columns are NOT NULL.
--   - RLS is enabled on every table.
--   - No client role may execute the four SECURITY DEFINER functions.
--   - service_role may execute all four.
--   - complete_recharge writes a ledger row AND credits the balance atomically.
--   - An authenticated client cannot INSERT into token_transactions (RLS denies).
--   - next_invoice_seq is gapless: call twice, get 1 then 2.

\set ON_ERROR_STOP on
begin;
select plan(30);

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select has_table('public', 'token_transactions', 'token_transactions exists');
select has_table('public', 'invoices', 'invoices exists');
select has_table('public', 'invoice_counters', 'invoice_counters exists');

-- Key NOT NULL columns
select col_not_null('public', 'token_transactions', 'user_id',      'token_transactions.user_id not null');
select col_not_null('public', 'token_transactions', 'kind',         'token_transactions.kind not null');
select col_not_null('public', 'token_transactions', 'status',       'token_transactions.status not null');
select col_not_null('public', 'token_transactions', 'amount_paise', 'token_transactions.amount_paise not null');
select col_not_null('public', 'token_transactions', 'tokens_delta', 'token_transactions.tokens_delta not null');
select col_not_null('public', 'invoices', 'transaction_id',  'invoices.transaction_id not null');
select col_not_null('public', 'invoices', 'invoice_number',  'invoices.invoice_number not null');
select col_not_null('public', 'invoices', 'document_type',   'invoices.document_type not null');
select col_not_null('public', 'invoices', 'taxable_paise',   'invoices.taxable_paise not null');
select col_not_null('public', 'invoices', 'total_paise',     'invoices.total_paise not null');

-- ---------------------------------------------------------------------------
-- RLS enabled on all three tables
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.token_transactions'::regclass),
  'RLS enabled on token_transactions'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass),
  'RLS enabled on invoices'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.invoice_counters'::regclass),
  'RLS enabled on invoice_counters'
);

-- ---------------------------------------------------------------------------
-- Least privilege: no client role may execute the SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
select function_privs_are(
  'public', 'complete_recharge',
  ARRAY['uuid', 'integer', 'integer', 'text', 'text', 'text'],
  'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on complete_recharge'
);
select function_privs_are(
  'public', 'record_invoice',
  ARRAY['uuid', 'text', 'text', 'jsonb', 'jsonb', 'text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on record_invoice'
);
select function_privs_are(
  'public', 'next_invoice_seq',
  ARRAY['text'],
  'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on next_invoice_seq'
);
select function_privs_are(
  'public', 'set_invoice_pdf',
  ARRAY['uuid', 'text'],
  'authenticated', ARRAY[]::text[],
  'authenticated has no privilege on set_invoice_pdf'
);

-- service_role may execute all four
select function_privs_are(
  'public', 'complete_recharge',
  ARRAY['uuid', 'integer', 'integer', 'text', 'text', 'text'],
  'service_role', ARRAY['EXECUTE'],
  'service_role may execute complete_recharge'
);
select function_privs_are(
  'public', 'record_invoice',
  ARRAY['uuid', 'text', 'text', 'jsonb', 'jsonb', 'text', 'integer', 'integer', 'integer', 'integer', 'integer', 'integer'],
  'service_role', ARRAY['EXECUTE'],
  'service_role may execute record_invoice'
);
select function_privs_are(
  'public', 'next_invoice_seq',
  ARRAY['text'],
  'service_role', ARRAY['EXECUTE'],
  'service_role may execute next_invoice_seq'
);
select function_privs_are(
  'public', 'set_invoice_pdf',
  ARRAY['uuid', 'text'],
  'service_role', ARRAY['EXECUTE'],
  'service_role may execute set_invoice_pdf'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id) values ('dddddddd-0000-4000-8000-000000000004');

-- ---------------------------------------------------------------------------
-- complete_recharge: credits balance and writes a ledger row atomically
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.complete_recharge(
      'dddddddd-0000-4000-8000-000000000004'::uuid,
      30000,  -- ₹300.00 in paise
      300,    -- 300 tokens (1 token = ₹1 = 100 paise)
      'razorpay', 'pay_test_001', 'order_test_001'
    )$$,
  'complete_recharge succeeds for a seeded user'
);

select is(
  (select token_balance from public.profiles
    where id = 'dddddddd-0000-4000-8000-000000000004'),
  -- STARTING_BALANCE (50) + 300 tokens
  350,
  'complete_recharge credited 300 tokens on top of the starting balance'
);

select is(
  (select count(*)::int from public.token_transactions
    where user_id = 'dddddddd-0000-4000-8000-000000000004'
      and kind = 'recharge' and status = 'succeeded'
      and amount_paise = 30000 and tokens_delta = 300),
  1,
  'complete_recharge inserted exactly one ledger row'
);

-- ---------------------------------------------------------------------------
-- RLS blocks a direct authenticated INSERT into token_transactions
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}';

select throws_ok(
  $$insert into public.token_transactions (user_id, kind, status, amount_paise, tokens_delta)
    values ('dddddddd-0000-4000-8000-000000000004', 'recharge', 'succeeded', 10000, 100)$$,
  '42501', null,
  'authenticated cannot INSERT into token_transactions: no insert policy'
);

reset role;

-- ---------------------------------------------------------------------------
-- next_invoice_seq is gapless (calling twice on a new FY gives 1, then 2)
-- ---------------------------------------------------------------------------
select is(
  public.next_invoice_seq('2099-00'),
  1::bigint,
  'next_invoice_seq returns 1 on first call for a new FY'
);
select is(
  public.next_invoice_seq('2099-00'),
  2::bigint,
  'next_invoice_seq returns 2 on second call (gapless)'
);

select * from finish();
rollback;
