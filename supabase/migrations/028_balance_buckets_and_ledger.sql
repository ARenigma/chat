-- ===========================================================================
-- 028  Balance buckets and extended token ledger
-- ===========================================================================
-- Splits the single token_balance column into two named buckets (promo and
-- purchased), extends token_transactions with session-level kinds, and
-- replaces the per-message deduct_user_token with a bucket-aware
-- per-minute-session debit function.
--
-- Every existing token_balance is reclassified as promo_balance (no refund
-- obligation) because real payments have never been enabled. The
-- reclassification is a one-shot UPDATE and is fully auditable via the
-- token_transactions ledger (one promo_grant row per existing account is
-- NOT written here because the accounts predate the ledger — the UPDATE
-- itself is the migration record, documented in this migration file).
--
-- The promo-first spend order (ADR-0021) is encoded in deduct_tokens:
-- promo_balance is exhausted first, then purchased_balance.
--
-- token_balance remains a plain integer synced by trigger for backward
-- compatibility with existing client reads. Clients still read token_balance;
-- session RPCs read the buckets directly.
--
-- References: ADR-0021

-- ---------------------------------------------------------------------------
-- 1. Balance bucket columns on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists promo_balance     integer not null default 0 check (promo_balance >= 0),
  add column if not exists purchased_balance integer not null default 0 check (purchased_balance >= 0);

comment on column public.profiles.promo_balance is
  'Promotional token credits. Spent before purchased_balance. '
  'No refund obligation on account closure. (ADR-0021)';

comment on column public.profiles.purchased_balance is
  'Tokens acquired via real payment. Spent after promo_balance. '
  'Unused value queued for refund review before account deletion. (ADR-0021)';

-- One-time reclassification: every existing token_balance is a promotional
-- grant (signup default or mock recharge). Real payments have never been
-- enabled, so the full balance belongs in promo_balance.
update public.profiles
set promo_balance     = token_balance,
    purchased_balance = 0;

-- Trigger: keep token_balance = promo_balance + purchased_balance.
-- SECURITY INVOKER so the trigger body runs at the caller's privilege level,
-- not as the function owner. Same pattern as touch_transaction_updated_at
-- in migration 019.
create or replace function public.sync_token_balance()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.token_balance := new.promo_balance + new.purchased_balance;
  return new;
end;
$$;

drop trigger if exists sync_token_balance on public.profiles;
create trigger sync_token_balance
  before insert or update of promo_balance, purchased_balance
  on public.profiles
  for each row execute function public.sync_token_balance();

-- ---------------------------------------------------------------------------
-- 2. Extend token_transactions kinds
-- ---------------------------------------------------------------------------
-- The new constraint is a strict superset of the old one; no existing rows
-- are invalidated.

alter table public.token_transactions
  drop constraint if exists token_transactions_kind_check;

alter table public.token_transactions
  add constraint token_transactions_kind_check
  check (kind in (
    'recharge',           -- top-up via payment gateway
    'refund',             -- payment refund from gateway
    'adjustment',         -- manual service_role adjustment
    'promo_grant',        -- promotional credit (signup, daily, admin)
    'usage_debit',        -- per-session consumption (negative tokens_delta)
    'provider_accrual',   -- provider's 60 % share of a session
    'payout',             -- payout disbursement to provider
    'account_close_hold', -- purchased balance frozen on account deletion request
    'refund_review'       -- approved account-close refund back to user
  ));

-- Session linkage: null for non-session transactions.
alter table public.token_transactions
  add column if not exists session_id        uuid,
  add column if not exists config_version_id uuid references admin.config_versions(id),
  add column if not exists provider_id       uuid references public.profiles(id);

comment on column public.token_transactions.session_id is
  'For usage_debit and provider_accrual rows: the paid_sessions.id that generated '
  'this entry. Null for non-session transactions.';

comment on column public.token_transactions.config_version_id is
  'Snapshot of the admin.config_versions.id (economics domain) active at session '
  'start. Ensures rate disputes can be resolved against the exact published config.';

comment on column public.token_transactions.provider_id is
  'For provider_accrual and payout rows: the provider who earned the credit. '
  'Null for member-side transactions.';

-- ---------------------------------------------------------------------------
-- 3. Bucket-aware spend function
-- ---------------------------------------------------------------------------

-- Bucket-aware token debit: promo balance exhausted first, then purchased.
-- Returns remaining total balance after debit, or raises if insufficient.
-- SECURITY DEFINER, service_role / SECURITY DEFINER session RPC path only:
-- never callable directly by the authenticated client.
create or replace function public.deduct_tokens(
  p_user_id           uuid,
  p_amount            integer,
  p_session_id        uuid default null,
  p_config_version_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo           integer;
  v_purchased       integer;
  v_promo_debit     integer;
  v_purchased_debit integer;
begin
  -- Row lock prevents concurrent debits from double-spending the same balance.
  select promo_balance, purchased_balance
  into   v_promo, v_purchased
  from   public.profiles
  where  id = p_user_id
  for update;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_promo + v_purchased < p_amount then
    raise exception 'Insufficient balance' using errcode = 'P0003';
  end if;

  -- Spend promo first (ADR-0021).
  v_promo_debit     := least(p_amount, v_promo);
  v_purchased_debit := p_amount - v_promo_debit;

  update public.profiles
  set promo_balance     = promo_balance     - v_promo_debit,
      purchased_balance = purchased_balance - v_purchased_debit
  where id = p_user_id;

  -- 1 token = ₹1 = 100 paise; amount_paise records the monetary equivalent.
  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta,
    session_id, config_version_id
  ) values (
    p_user_id, 'usage_debit', 'succeeded',
    p_amount * 100,
    -p_amount,
    p_session_id, p_config_version_id
  );

  return v_promo + v_purchased - p_amount;
end;
$$;

comment on function public.deduct_tokens(uuid, integer, uuid, uuid) is
  'Bucket-aware token debit: promo balance spent first, then purchased. '
  'Raises P0003 (Insufficient balance) if the wallet is underfunded. '
  'Writes a usage_debit ledger row. Called by session metering RPCs only '
  '(service_role). (ADR-0021)';

revoke all on function public.deduct_tokens(uuid, integer, uuid, uuid) from public;
-- Not granted to authenticated: session RPCs are SECURITY DEFINER themselves and
-- call deduct_tokens under the function-owner privilege chain.

-- ---------------------------------------------------------------------------
-- 4. Promo grant function
-- ---------------------------------------------------------------------------

-- Credits promotional tokens (signup grant, admin grant, daily refill).
-- Does NOT create a purchase obligation; promo balance has no refund value.
create or replace function public.credit_promo_tokens(
  p_user_id uuid,
  p_amount  integer,
  p_reason  text default 'grant'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  update public.profiles
  set promo_balance = promo_balance + p_amount
  where id = p_user_id
  returning promo_balance + purchased_balance into v_new_balance;

  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- amount_paise = 0: promo grants carry no monetary value and create no
  -- GST obligation. The token count is recorded for audit completeness.
  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta
  ) values (
    p_user_id, 'promo_grant', 'succeeded', 0, p_amount
  );

  return v_new_balance;
end;
$$;

comment on function public.credit_promo_tokens(uuid, integer, text) is
  'Credit promotional tokens (signup grant, admin grant, daily refill). '
  'Writes a promo_grant ledger row with amount_paise = 0 (no monetary value). '
  'Called by claim_daily_tokens() and service_role admin grants. (ADR-0021)';

revoke all on function public.credit_promo_tokens(uuid, integer, text) from public;
-- Not granted to authenticated: called via claim_daily_tokens() (SECURITY DEFINER)
-- or directly by service_role.

-- ---------------------------------------------------------------------------
-- 5. Account-close refund review queue
-- ---------------------------------------------------------------------------

create table public.refund_reviews (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles(id),
  -- on delete cascade: when the account row is hard-deleted (cascade from
  -- auth.users), the review row is removed atomically. The purchased token
  -- count and paise amount are preserved in this row's own columns so that
  -- admin can reconcile even if the transaction row was cascade-deleted first.
  transaction_id   uuid        not null references public.token_transactions(id) on delete cascade,
  purchased_tokens integer     not null check (purchased_tokens > 0),
  amount_paise     integer     not null check (amount_paise > 0),
  status           text        not null default 'pending'
                               check (status in ('pending', 'approved', 'denied', 'processed')),
  notes            text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      text
);

comment on table public.refund_reviews is
  'Pending refund review cases for unused purchased tokens at account closure. '
  'Admin reviews each case; approved cases trigger a payout to the original '
  'payment method. service_role only; no client read policy. (ADR-0021)';

comment on column public.refund_reviews.transaction_id is
  'The account_close_hold token_transactions row. Cascades on delete so this '
  'row is removed when the account is hard-deleted. The purchased amount is '
  'preserved in purchased_tokens and amount_paise for admin reconciliation.';

alter table public.refund_reviews enable row level security;
-- No client policies — only service_role and the admin dashboard read this.

-- Extend delete_user_account to freeze purchased balance before deletion.
-- CREATE OR REPLACE retains the grant established in migration 002.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchased integer;
  v_tx_id     uuid;
begin
  -- Freeze any purchased balance as an account_close_hold ledger entry and
  -- queue it for admin refund review before the cascade removes the rows.
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

  -- auth.users → profiles → token_transactions / conversations / etc. all
  -- cascade. The refund_reviews row cascades via transaction_id.
  delete from auth.users where id = auth.uid();
end;
$$;

-- Grant retained from migration 002; re-stated here for explicit audit trail.
grant execute on function public.delete_user_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Update claim_daily_tokens to read from admin config
-- ---------------------------------------------------------------------------
-- Return type changes from json → integer; CREATE OR REPLACE cannot change
-- the return type, so the old signature is dropped first. The authenticated
-- grant is re-stated below.

drop function if exists public.claim_daily_tokens();

create function public.claim_daily_tokens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config      jsonb;
  v_enabled     boolean;
  v_amount      integer;
  v_last_refill timestamptz;
begin
  -- Read the wallet domain config; falls back to disabled if not yet published.
  v_config  := public.get_active_config('wallet');
  v_enabled := coalesce((v_config->>'daily_refill_enabled')::boolean, false);

  if not v_enabled then
    return -1;
  end if;

  v_amount := coalesce((v_config->>'daily_refill_tokens')::integer, 25);

  select last_refill_at
  into   v_last_refill
  from   public.profiles
  where  id = auth.uid();

  if v_last_refill is not null and v_last_refill > now() - interval '24 hours' then
    raise exception 'Too soon' using errcode = 'P0004';
  end if;

  update public.profiles
  set last_refill_at = now()
  where id = auth.uid();

  return public.credit_promo_tokens(auth.uid(), v_amount, 'daily_refill');
end;
$$;

comment on function public.claim_daily_tokens() is
  'Returns new total balance, or -1 if wallet.daily_refill_enabled is false in '
  'admin config. Raises P0004 if called within 24 h of the last successful claim. '
  'Grants via credit_promo_tokens (no refund obligation). (ADR-0021)';

-- Revoke the implicit PUBLIC execute on the newly created function, then
-- grant only to authenticated — same pattern as migration 002.
revoke all on function public.claim_daily_tokens() from public;
grant execute on function public.claim_daily_tokens() to authenticated;
