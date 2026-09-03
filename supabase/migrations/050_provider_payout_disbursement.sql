-- ===========================================================================
-- 050  Provider payout disbursement (manual, admin-triggered)
-- ===========================================================================
-- 029 created provider_payout_batches; 048 added the payout account + Cashfree
-- beneficiary. This wires the disbursement: claim a provider's cleared, past-hold
-- earnings into a batch and settle it after the Cashfree transfer. Triggered
-- MANUALLY by a founder from the admin console (no cron yet, by request).
--
-- Money-critical, so the claim is atomic in SQL rather than spread across the
-- Edge function: create_provider_payout_batch locks the eligible ledger rows,
-- creates the batch, and stamps the rows 'paid' with the batch id in one
-- transaction, so two concurrent triggers cannot pay the same earning twice.
-- settle_provider_payout_batch records the terminal state (or reverts on
-- failure). Both are service-role only.

-- 1. Link each earning to the batch that paid it (also the revert handle).
alter table public.provider_earnings_ledger
  add column if not exists payout_batch_id uuid references public.provider_payout_batches(id);

create index if not exists provider_earnings_ledger_batch
  on public.provider_earnings_ledger (payout_batch_id);

-- 2. Atomically claim eligible earnings into a new batch.
--    Returns the batch to pay, or raises with a reason the admin can read.
create or replace function public.create_provider_payout_batch(
  p_provider_id     uuid,
  p_ignore_minimum  boolean default false
) returns table (
  batch_id        uuid,
  total_tokens    integer,
  total_paise     integer,
  method          text,
  beneficiary_id  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min_paise   integer;
  v_total_tok   integer;
  v_batch       uuid;
  v_method      text;
  v_ben         text;
begin
  -- Beneficiary must be a verified default account (ADR-0022).
  select a.method, a.cashfree_beneficiary_id
    into v_method, v_ben
  from public.provider_payout_accounts a
  where a.provider_id = p_provider_id
    and a.is_default
    and a.verification_status = 'verified'
    and a.cashfree_beneficiary_id is not null;

  if v_ben is null then
    raise exception 'provider has no verified payout account';
  end if;

  -- Lock the eligible earnings so a concurrent run cannot claim them too.
  perform 1
  from public.provider_earnings_ledger
  where provider_id = p_provider_id
    and status = 'cleared'
    and payout_batch_id is null
    and hold_until <= now()
  for update;

  select coalesce(sum(provider_tokens), 0)
    into v_total_tok
  from public.provider_earnings_ledger
  where provider_id = p_provider_id
    and status = 'cleared'
    and payout_batch_id is null
    and hold_until <= now();

  if v_total_tok <= 0 then
    raise exception 'no earnings are cleared and past their hold yet';
  end if;

  -- 1 token = ₹1 = 100 paise. Minimum is the ADR-0021 ₹500 default; an admin can
  -- override it (p_ignore_minimum) when settling a smaller balance by hand.
  v_min_paise := 50000;

  if not p_ignore_minimum and v_total_tok * 100 < v_min_paise then
    raise exception 'below minimum payout (% paise < % paise)', v_total_tok * 100, v_min_paise;
  end if;

  insert into public.provider_payout_batches (provider_id, status, total_tokens, total_paise, initiated_at)
  values (p_provider_id, 'processing', v_total_tok, v_total_tok * 100, now())
  returning id into v_batch;

  update public.provider_earnings_ledger
  set status = 'paid', payout_batch_id = v_batch
  where provider_id = p_provider_id
    and status = 'cleared'
    and payout_batch_id is null
    and hold_until <= now();

  return query select v_batch, v_total_tok, v_total_tok * 100, v_method, v_ben;
end;
$$;

revoke all on function public.create_provider_payout_batch(uuid, boolean) from public;

-- 3. Settle a batch after the Cashfree transfer resolves (or fails).
--    On failure, revert the claimed earnings so a retry can re-batch them.
create or replace function public.settle_provider_payout_batch(
  p_batch_id        uuid,
  p_cashfree_id     text,
  p_ok              boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update public.provider_payout_batches
    set status = 'completed', cashfree_batch_id = p_cashfree_id, completed_at = now()
    where id = p_batch_id;
  else
    update public.provider_payout_batches
    set status = 'failed', cashfree_batch_id = p_cashfree_id
    where id = p_batch_id;
    -- Release the earnings back to 'cleared' so they can be paid on a retry.
    update public.provider_earnings_ledger
    set status = 'cleared', payout_batch_id = null
    where payout_batch_id = p_batch_id;
  end if;
end;
$$;

revoke all on function public.settle_provider_payout_batch(uuid, text, boolean) from public;

-- 4. Admin list: providers with a claimable balance, for the manual payout page.
--    In the admin schema, read only by the service-role admin backend.
create or replace view admin.payable_providers as
with claimable as (
  select
    e.provider_id,
    sum(e.provider_tokens) as claimable_tokens
  from public.provider_earnings_ledger e
  where e.status = 'cleared'
    and e.payout_batch_id is null
    and e.hold_until <= now()
  group by e.provider_id
)
select
  c.provider_id,
  p.display_name,
  c.claimable_tokens,
  a.verification_status                                   as account_status,
  coalesce(t.status, 'not_provided')                     as pan_status,
  (a.verification_status = 'verified'
    and coalesce(t.status, 'not_provided') = 'verified')  as payable
from claimable c
join public.profiles p on p.id = c.provider_id
left join public.provider_payout_accounts a on a.provider_id = c.provider_id and a.is_default
left join public.provider_tax_profile t on t.provider_id = c.provider_id
where c.claimable_tokens > 0;

comment on view admin.payable_providers is
  'Providers with cleared, past-hold, unpaid earnings — the manual payout queue. '
  'payable = both the default payout account and the PAN are verified.';

