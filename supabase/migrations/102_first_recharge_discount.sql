-- 102_first_recharge_discount.sql
--
-- A member's FIRST EVER recharge is half price. The decision is made here, in
-- the database, and nowhere else — a client that computes its own discount is a
-- client that can be told to lie about it, and `create-order` is the only place
-- the order amount is set.
--
-- Three things are needed and none of them can be skipped:
--
--   1. "Has this member ever recharged?" — a fact, read from the ledger.
--   2. A single-use CLAIM, so two orders opened before either is paid cannot
--      both be priced at half.
--   3. A read-only PREVIEW the client can show, so the recharge screen states
--      the same total the gateway will charge. The runbook
--      docs/runbooks/create-order-deploy.md exists because that equality was
--      once broken (₹354 charged against a ₹300 display); a discount that only
--      the server knows about would break it again in the other direction.
--
-- What counts as "ever recharged"
-- ---------------------------------------------------------------------------
-- `token_transactions.kind` has nine values (migration 028). Only ONE of them
-- means money changed hands for tokens:
--
--   'recharge'      — the purchased path. Written with status='created' by
--                     create-order and moved to 'succeeded' by
--                     credit_purchased_recharge (033), which is the only
--                     function the Cashfree webhook and verify-order call.
--                     mock_recharge (020/097) writes one directly at
--                     'succeeded' with gateway='mock'.
--   'promo_grant'   — the promo path: credit_promo_tokens (028), amount_paise
--                     ZERO, "does NOT create a purchase obligation". Signup
--                     grants, daily refills and admin grants all land here.
--                     A member who has only ever been GIVEN tokens has not
--                     recharged, and is still owed the offer.
--
-- The other seven ('refund', 'adjustment', 'usage_debit', 'provider_accrual',
-- 'payout', 'account_close_hold', 'refund_review') are not purchases either.
--
-- status is checked as ('succeeded', 'refunded') rather than 'succeeded' alone.
-- A refunded recharge DID complete — reverting it must not re-arm a half-price
-- first purchase, or a refund becomes a way to buy at half price repeatedly.
-- Rows still sitting at 'created' (an order opened and never paid) and 'failed'
-- ones do not count: nothing was bought.

-- ---------------------------------------------------------------------------
-- 1. The ledger records what a row was priced at
-- ---------------------------------------------------------------------------
-- Without this the ledger cannot answer "why was this ₹177 and not ₹354?", and
-- neither can an invoice dispute. Default 0 so every existing row reads as
-- undiscounted, which is what they are.

alter table public.token_transactions
  add column if not exists discount_bps integer not null default 0;

alter table public.token_transactions
  drop constraint if exists token_transactions_discount_bps_check;

alter table public.token_transactions
  add constraint token_transactions_discount_bps_check
  check (discount_bps >= 0 and discount_bps < 10000);

comment on column public.token_transactions.discount_bps is
  'Basis points taken off the pack base before GST when this order was priced. '
  '0 for every ordinary recharge. Non-zero only on a first-recharge order, and '
  'amount_paise already reflects it — generate-invoice backs the tax out of '
  'amount_paise, so the invoice shows the discounted taxable value with no '
  'further arithmetic. (migration 102)';

-- ---------------------------------------------------------------------------
-- 2. The claim slot
-- ---------------------------------------------------------------------------
-- One row per member, holding the id of the single order allowed to carry the
-- discount right now. The primary key IS the concurrency control: two
-- create-order calls racing each other both attempt the same INSERT, Postgres
-- serialises them on the row, and exactly one comes back holding the slot.
--
-- order_id carries NO foreign key to token_transactions, deliberately. The
-- claim has to be taken BEFORE the Cashfree order exists, because the claim is
-- what decides the amount to create it for; the token_transactions row is only
-- written afterwards, once there is a payment_session_id worth recording. A FK
-- would invert that order and there is nothing to gain from it — the column is
-- read by joining, and a dangling id simply means the order was never created.

create table if not exists public.first_recharge_discounts (
  user_id      uuid        primary key references public.profiles(id) on delete cascade,
  order_id     uuid        not null,
  discount_bps integer     not null check (discount_bps > 0 and discount_bps < 10000),
  claimed_at   timestamptz not null default now()
);

comment on table public.first_recharge_discounts is
  'Single-use claim on the first-recharge discount: at most one order per member '
  'may be priced at the discount at a time. Written only by '
  'claim_first_recharge_discount (service_role). Not a record of the discount '
  'being USED — that is token_transactions.discount_bps on a succeeded row. '
  '(migration 102)';

alter table public.first_recharge_discounts enable row level security;
-- No policies, on purpose. service_role bypasses RLS and is the only writer;
-- a member reads their own eligibility through my_first_recharge_discount_bps()
-- below, which answers the one question they need without exposing the slot.

-- ---------------------------------------------------------------------------
-- 3. The rate
-- ---------------------------------------------------------------------------
-- 5000 bps = 50%. Operator-overridable through the economics config domain so
-- the offer can be changed or switched off without a deploy — the same domain
-- and the same accessor create-order already reads gst_rate_bps from, which is
-- what keeps the two from drifting apart.
--
-- The override is validated rather than cast blindly: a non-numeric or
-- out-of-range value falls back to 50% instead of raising, because a typo in an
-- admin console must not take recharge down.

create or replace function public.first_recharge_discount_bps()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw text;
begin
  v_raw := public.get_active_config('economics') ->> 'first_recharge_discount_bps';

  if v_raw is not null and v_raw ~ '^[0-9]+$' then
    if v_raw::integer > 0 and v_raw::integer < 10000 then
      return v_raw::integer;
    end if;
    -- A published 0 is a deliberate "offer is off", and is honoured as such.
    if v_raw::integer = 0 then
      return 0;
    end if;
  end if;

  return 5000;
end;
$$;

comment on function public.first_recharge_discount_bps() is
  'Basis points off a member''s first recharge. economics.first_recharge_discount_bps '
  'when published and in range, otherwise 5000 (50%). A published 0 turns the '
  'offer off. (migration 102)';

revoke all on function public.first_recharge_discount_bps() from public, anon;
grant execute on function public.first_recharge_discount_bps() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Has this member ever bought tokens?
-- ---------------------------------------------------------------------------

create or replace function public.has_ever_recharged(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from   public.token_transactions t
    where  t.user_id = p_user_id
      and  t.kind    = 'recharge'
      and  t.status in ('succeeded', 'refunded')
  );
$$;

comment on function public.has_ever_recharged(uuid) is
  'True once a purchased recharge has completed for this member. promo_grant '
  'rows (free tokens, amount_paise 0) are not purchases and do not count; a '
  'refunded recharge does, so a refund cannot re-arm the first-recharge offer. '
  '(migration 102)';

revoke all on function public.has_ever_recharged(uuid) from public, anon;
grant execute on function public.has_ever_recharged(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Take the claim — the one place the discount is granted
-- ---------------------------------------------------------------------------
-- Returns the basis points THIS order may be priced at: the configured rate if
-- it holds the slot, 0 otherwise. create-order calls it once, before it asks
-- Cashfree for an order, and prices what comes back.
--
-- The slot moves to a new order in exactly three cases, and no others:
--
--   a. the same order asking again (a retried create-order for one id) — it
--      already holds the slot, so the answer must not flip to 0 on a retry;
--   b. the order holding it has been marked 'failed'. Two things do that, and
--      between them they cover the ordinary abandon: cashfree-webhook on
--      PAYMENT_FAILED_WEBHOOK / PAYMENT_USER_DROPPED_WEBHOOK — which is the
--      path a member who backs out of the gateway actually takes — and
--      verify-order when Cashfree reports a terminal, unpayable status. So a
--      first attempt that dies hands the offer back in seconds, and the member
--      who falls back from UPI to card is still charged half price;
--   c. the claim is older than 20 minutes — the backstop for the case nobody
--      reconciles. A Cashfree payment session does not outlive that, so the
--      order the slot is protecting can no longer be paid at the old price.
--
-- What this closes: two create-order calls in flight together cannot both be
-- priced at half — the second sees the first's fresh claim and is quoted full
-- price. What it does NOT close: a member who opens a discounted order, leaves
-- it payable, waits out the 20 minutes, opens a second, and then pays BOTH
-- sessions. Closing that needs create-order to TERMINATE the superseded
-- Cashfree order (PATCH /pg/orders/{id}) before taking the slot over; until it
-- does, the exposure is one extra half-price pack per member per 20 minutes,
-- and it is written down here rather than left to be discovered.

create or replace function public.claim_first_recharge_discount(
  p_user_id  uuid,
  p_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bps     integer;
  v_claimed boolean;
begin
  if p_user_id is null or p_order_id is null then
    return 0;
  end if;

  -- Already bought once: there is no first recharge left to discount.
  if public.has_ever_recharged(p_user_id) then
    return 0;
  end if;

  v_bps := public.first_recharge_discount_bps();
  if v_bps <= 0 then
    return 0;
  end if;

  -- The whole race is decided by this one statement. Both callers contend on
  -- the same primary key; the loser's ON CONFLICT branch re-evaluates its WHERE
  -- against the winner's committed row and returns nothing.
  insert into public.first_recharge_discounts as d (user_id, order_id, discount_bps)
  values (p_user_id, p_order_id, v_bps)
  on conflict (user_id) do update
     set order_id     = excluded.order_id,
         discount_bps = excluded.discount_bps,
         claimed_at   = now()
   where d.order_id = excluded.order_id                        -- (a) same order retrying
      or d.claimed_at < now() - interval '20 minutes'          -- (c) stale backstop
      or exists (                                              -- (b) reconciled dead
           select 1
           from   public.token_transactions t
           where  t.id     = d.order_id
             and  t.status = 'failed'
         )
  returning true into v_claimed;

  if coalesce(v_claimed, false) then
    return v_bps;
  end if;

  return 0;
end;
$$;

comment on function public.claim_first_recharge_discount(uuid, uuid) is
  'Grant the first-recharge discount to one order, atomically. Returns the basis '
  'points to price it at, or 0. Server-side only: this is the sole authority on '
  'whether a recharge is half price. (migration 102)';

revoke all on function public.claim_first_recharge_discount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_first_recharge_discount(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The preview the member is allowed to see
-- ---------------------------------------------------------------------------
-- Self-scoped and read-only: it takes no argument, answers only for auth.uid(),
-- and grants nothing. The recharge screen needs it so the price on the chip is
-- the price at the gateway — but it is a DISPLAY input, never an authority.
-- create-order re-decides from scratch and returns the amount it actually
-- created the order for; the client refuses to open the gateway if the two
-- disagree (src/api/billing.ts), so a tampered preview can only mis-draw a
-- screen, never mis-charge a card.

create or replace function public.my_first_recharge_discount_bps()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return 0;
  end if;

  if public.has_ever_recharged(v_uid) then
    return 0;
  end if;

  return public.first_recharge_discount_bps();
end;
$$;

comment on function public.my_first_recharge_discount_bps() is
  'Basis points the calling member would get on a recharge started now, for '
  'DISPLAY only. Does not take the claim; create-order does that and its '
  'returned amount is what the client must match before paying. (migration 102)';

revoke all on function public.my_first_recharge_discount_bps() from public, anon;
grant execute on function public.my_first_recharge_discount_bps() to authenticated, service_role;
