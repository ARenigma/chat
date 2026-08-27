-- ===========================================================================
-- 019  Token ledger, invoice counters, and GST invoices
-- ===========================================================================
-- Event-sourced ledger: every wallet movement writes one immutable row before
-- the balance column is touched. The row is the record of truth; the balance
-- is a materialised projection for fast reads. Never delete ledger rows.
--
-- Money is stored as INTEGER PAISE (1 rupee = 100 paise) in all new tables.
-- Razorpay reports amounts in paise, and GST arithmetic (18% of ₹283.05) is
-- sub-rupee exact. Tokens stay integer (1 token = 1 rupee = 100 paise) so
-- amounts_paise = tokens * 100 for current packs.
--
-- Invoice numbering is gapless per fiscal year: invoice_counters holds one row
-- per FY, incremented atomically by next_invoice_seq via an upsert row lock.
-- A gap in the sequence would invite a GST scrutiny notice, so the counter
-- never decrements and rolled-back sequences are simply lost (not re-used).

-- ---------------------------------------------------------------------------
-- 1. Token transactions — the ledger
-- ---------------------------------------------------------------------------
create table public.token_transactions (
  id               uuid         default gen_random_uuid() primary key,
  user_id          uuid         not null references public.profiles(id) on delete cascade,
  kind             text         not null check (kind in ('recharge', 'refund', 'adjustment')),
  status           text         not null default 'succeeded'
                                check (status in ('created', 'succeeded', 'failed', 'refunded')),
  amount_paise     integer      not null check (amount_paise >= 0),
  tokens_delta     integer      not null,
  gateway          text,
  gateway_ref      text,
  gateway_order_id text,
  created_at       timestamptz  default now() not null,
  updated_at       timestamptz  default now() not null
);

comment on table public.token_transactions is
  'Immutable ledger of wallet events. Every credit or debit that moves '
  'token_balance is recorded here first. status starts at succeeded for '
  'manual/recharge paths and moves to refunded if a payment is reversed.';

comment on column public.token_transactions.amount_paise is
  'Gross amount charged in paise (100 paise = ₹1). Zero is valid for manual '
  'adjustments that carry no monetary value.';

comment on column public.token_transactions.tokens_delta is
  'Signed token change: positive for credits, negative for debits. '
  'Currently always positive (recharge only); the sign convention is stated '
  'now so a debit path is not invented twice.';

alter table public.token_transactions enable row level security;

-- Members may read their own rows. No client INSERT / UPDATE / DELETE policy:
-- service_role bypasses RLS and is the only writer.
create policy "Members read own transactions"
  on public.token_transactions
  for select to authenticated
  using (user_id = auth.uid());

create index on public.token_transactions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 1a. updated_at stamp — SECURITY INVOKER so current_user stays the caller
-- ---------------------------------------------------------------------------
create or replace function public.touch_transaction_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_transaction_updated_at
  before update on public.token_transactions
  for each row execute function public.touch_transaction_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Invoice sequence counters (one row per fiscal year)
-- ---------------------------------------------------------------------------
create table public.invoice_counters (
  fy       text   primary key,
  last_seq bigint not null default 0
);

comment on table public.invoice_counters is
  'Gapless per-FY counter for GST invoice numbers. '
  'Only service_role may touch this; there are no RLS policies.';

alter table public.invoice_counters enable row level security;
-- No policies: service_role bypasses RLS; all other roles are denied.

-- ---------------------------------------------------------------------------
-- 3. next_invoice_seq — atomic, gapless, concurrency-safe
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_seq(p_fy text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  -- The upsert locks the row (or the gap) before incrementing, which is what
  -- makes this safe under concurrent calls: Postgres serialises the UPDATE half
  -- of ON CONFLICT, so two simultaneous recharges cannot receive the same seq.
  insert into public.invoice_counters (fy, last_seq)
  values (p_fy, 1)
  on conflict (fy) do update
    set last_seq = invoice_counters.last_seq + 1
  returning last_seq into v_seq;

  return v_seq;
end;
$$;

revoke all on function public.next_invoice_seq(text) from public, anon, authenticated;
grant execute on function public.next_invoice_seq(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id              uuid         default gen_random_uuid() primary key,
  transaction_id  uuid         not null unique references public.token_transactions(id) on delete restrict,
  invoice_number  text         not null unique,
  document_type   text         not null check (document_type in ('tax_invoice', 'bill_of_supply')),
  fy              text         not null,
  issued_at       timestamptz  default now() not null,
  seller          jsonb        not null,  -- {legal_name, address, gstin, email, state}
  buyer           jsonb        not null,  -- {name, state, gstin}
  place_of_supply text,
  taxable_paise   integer      not null,
  cgst_paise      integer      not null default 0,
  sgst_paise      integer      not null default 0,
  igst_paise      integer      not null default 0,
  total_paise     integer      not null,
  gst_rate_bps    integer      not null default 0,  -- basis points: 1800 = 18%
  pdf_path        text,
  created_at      timestamptz  default now() not null
);

comment on table public.invoices is
  'GST-compliant invoice record generated after a successful recharge. '
  'document_type is ''tax_invoice'' when the seller has a GSTIN, and '
  '''bill_of_supply'' otherwise (composition/unregistered). All monetary '
  'amounts are integer paise. pdf_path is set asynchronously by '
  'generate-invoice after the PDF is uploaded to storage.';

comment on column public.invoices.gst_rate_bps is
  'GST rate in basis points (1 basis point = 0.01%). 1800 = 18%, 0 = exempt.';

alter table public.invoices enable row level security;

-- A member may read their own invoices, identified via the FK to their
-- transaction row. No client writes.
create policy "Members read own invoices"
  on public.invoices
  for select to authenticated
  using (
    exists (
      select 1
      from public.token_transactions t
      where t.id = invoices.transaction_id
        and t.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. complete_recharge — atomically records the ledger row and credits balance
-- ---------------------------------------------------------------------------
create or replace function public.complete_recharge(
  p_user_id          uuid,
  p_amount_paise     integer,
  p_tokens           integer,
  p_gateway          text    default null,
  p_gateway_ref      text    default null,
  p_gateway_order_id text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta,
    gateway, gateway_ref, gateway_order_id
  )
  values (
    p_user_id, 'recharge', 'succeeded', p_amount_paise, p_tokens,
    p_gateway, p_gateway_ref, p_gateway_order_id
  )
  returning id into v_id;

  -- Reuse the existing credit path: never write token_balance directly.
  -- credit_user_token validates p_tokens > 0 and is itself SECURITY DEFINER.
  perform public.credit_user_token(p_user_id, p_tokens);

  return v_id;
end;
$$;

revoke all on function public.complete_recharge(uuid, integer, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_recharge(uuid, integer, integer, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. record_invoice — inserts the invoice row and returns its id + number
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice(
  p_transaction_id uuid,
  p_document_type  text,
  p_fy             text,
  p_seller         jsonb,
  p_buyer          jsonb,
  p_place_of_supply text,
  p_taxable_paise  integer,
  p_cgst_paise     integer,
  p_sgst_paise     integer,
  p_igst_paise     integer,
  p_total_paise    integer,
  p_gst_rate_bps   integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq    bigint;
  v_number text;
  v_id     uuid;
begin
  v_seq    := public.next_invoice_seq(p_fy);
  v_number := 'AXN/' || p_fy || '/' || lpad(v_seq::text, 5, '0');

  insert into public.invoices (
    transaction_id, invoice_number, document_type, fy,
    seller, buyer, place_of_supply,
    taxable_paise, cgst_paise, sgst_paise, igst_paise,
    total_paise, gst_rate_bps
  )
  values (
    p_transaction_id, v_number, p_document_type, p_fy,
    p_seller, p_buyer, p_place_of_supply,
    p_taxable_paise, p_cgst_paise, p_sgst_paise, p_igst_paise,
    p_total_paise, p_gst_rate_bps
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'invoice_number', v_number);
end;
$$;

revoke all on function public.record_invoice(uuid, text, text, jsonb, jsonb, text, integer, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_invoice(uuid, text, text, jsonb, jsonb, text, integer, integer, integer, integer, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. set_invoice_pdf — called by the edge function after the PDF is uploaded
-- ---------------------------------------------------------------------------
create or replace function public.set_invoice_pdf(
  p_invoice_id uuid,
  p_pdf_path   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invoices
  set pdf_path = p_pdf_path
  where id = p_invoice_id;
end;
$$;

revoke all on function public.set_invoice_pdf(uuid, text) from public, anon, authenticated;
grant execute on function public.set_invoice_pdf(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Private storage bucket for invoice PDFs
-- ---------------------------------------------------------------------------
-- Objects are stored at '<user_id>/<invoice_number>.pdf' (slashes in the
-- invoice number are replaced with hyphens by the edge function, so paths
-- look like '<uuid>/AXN-2026-27-00001.pdf').
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent, skipping the invoices bucket (expected in the test harness)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('invoices', 'invoices', false, 5242880, array['application/pdf'])
  on conflict (id) do update
    set public             = false,
        file_size_limit    = 5242880,
        allowed_mime_types = array['application/pdf'];

  -- A member may read their own invoice PDFs. The first path segment of an
  -- object is the user_id, which is the cheapest membership check possible.
  execute $p$drop policy if exists "Members read own invoice PDFs" on storage.objects$p$;
  execute $p$
    create policy "Members read own invoice PDFs"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'invoices'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;

  -- No INSERT, UPDATE, or DELETE policy for client roles: only the edge
  -- function (service_role) uploads PDFs, and invoices are immutable once
  -- issued. Removal is a manual compliance operation, not a product feature.
end
$$;
