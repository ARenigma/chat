-- 097_recharge_helpers_credit_the_bucket.sql
--
-- mock_recharge (dev-only, gated behind app_flags.mock_payments) and
-- complete_recharge (dead code, never called by an active path) both credited
-- via credit_user_token, which writes profiles.token_balance directly. Since
-- migration 028 introduced promo_balance/purchased_balance with a
-- sync_token_balance trigger that recomputes token_balance = promo + purchased
-- on any bucket update, a direct token_balance write is silently erased on the
-- next debit. Both now credit purchased_balance, the same path
-- credit_purchased_recharge (migration 033) uses.
--
-- Neither affects production balances: mock_recharge is double-gated off (client
-- MOCK_PAYMENTS + server app_flags.mock_payments), and complete_recharge has no
-- caller. This is correctness/consistency, recreated verbatim with only the
-- credit line changed.

create or replace function public.mock_recharge(
  p_amount_paise integer,
  p_tokens       integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_tx_id  uuid;
begin
  -- Self-scoped: the credit goes to the calling user only.
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  -- Feature gate: inert until an operator enables it.
  if not (
    select enabled from public.app_flags where key = 'mock_payments'
  ) then
    return json_build_object('success', false, 'error', 'MOCK_DISABLED');
  end if;

  -- Input validation: mirrors the reasonable limits of a real recharge.
  if p_tokens <= 0 or p_tokens > 5000 or p_amount_paise < 0 then
    return json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  end if;

  -- Write the ledger row first, then credit the balance.
  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta, gateway, gateway_ref
  )
  values (
    v_uid, 'recharge', 'succeeded',
    p_amount_paise, p_tokens,
    'mock', 'mock-' || gen_random_uuid()::text
  )
  returning id into v_tx_id;

  -- credit_user_token is SECURITY DEFINER; callable from within this function
  -- because this function runs as the function owner (owner-level privileges).
  -- Credit purchased_balance directly, NOT credit_user_token (which writes
  -- token_balance and is then wiped by the sync_token_balance trigger on the
  -- next bucket update). Mirrors credit_purchased_recharge. (2026-09-10 audit)
  update public.profiles
  set    purchased_balance = purchased_balance + p_tokens
  where  id = v_uid;

  return json_build_object(
    'success',        true,
    'transaction_id', v_tx_id,
    'new_balance',    (select token_balance from public.profiles where id = v_uid)
  );
end;
$$;

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

  -- Credit purchased_balance directly, NOT credit_user_token (which writes
  -- token_balance and is then wiped by the sync_token_balance trigger on the
  -- next bucket update). Mirrors credit_purchased_recharge. (2026-09-10 audit)
  update public.profiles
  set    purchased_balance = purchased_balance + p_tokens
  where  id = p_user_id;

  return v_id;
end;
$$;
