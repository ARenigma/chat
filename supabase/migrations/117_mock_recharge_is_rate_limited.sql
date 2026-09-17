-- `mock_recharge` is rate-limited per user. Telegram-CTO audit, 2026-09-17,
-- contested finding: one verifier's claimed mechanism (the client-side
-- MOCK_PAYMENTS constant "gates the button, never the RPC") was correct on
-- the RPC point but wrong about the safety argument being purely client-side
-- -- 097's own header already states the real one: "mock_recharge is
-- double-gated off (client MOCK_PAYMENTS + server app_flags.mock_payments)".
-- The server gate is real and this migration does not weaken or replace it.
--
-- What it addresses is the SIZE of the blast radius if that server gate is
-- ever on -- for a demo, a manual test, an operator mistake, or a future
-- feature that needs it briefly. Today `EXECUTE` on this function is granted
-- to every `authenticated` user on the one production project, capped only
-- at 5000 tokens PER CALL with no limit on the number of calls. The moment
-- `app_flags.mock_payments` is true, every signed-in user -- not just
-- whoever the operator meant to test with -- can mint free balance, and can
-- do it as many times as they call the RPC.
--
-- Revoking the `authenticated` grant outright was considered and rejected:
-- `PaymentSheet.tsx:149` calls `supabase.rpc('mock_recharge', ...)` as the
-- signed-in user, gated client-side on `MOCK_PAYMENTS` (`APP_ENV !==
-- 'production'`), and that is how every internal/test build actually
-- recharges today. Revoking the grant breaks that real, currently-used path
-- rather than closing a hole.
--
-- Instead: capped at 3 successful calls per user per rolling 24 hours,
-- counted from `token_transactions` (kind='recharge', gateway='mock') --
-- the same ledger the function already writes to, so this adds a read, not
-- a new table. Three is enough for a tester to correct a mistake or run a
-- multi-pack test in one sitting; it is nowhere near enough to be worth
-- scripting, and it turns "every user, unlimited" into "every user, capped
-- hard" even in the worst case of the server flag being on in production.
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
  v_uid          uuid;
  v_tx_id        uuid;
  v_recent_count integer;
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

  -- Rate limit: at most 3 mock recharges per user per rolling 24 hours,
  -- regardless of how the server gate above came to be enabled.
  select count(*) into v_recent_count
  from public.token_transactions
  where user_id = v_uid
    and kind = 'recharge'
    and gateway = 'mock'
    and created_at > now() - interval '24 hours';

  if v_recent_count >= 3 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
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

comment on function public.mock_recharge(integer, integer) is
  'Dev-only recharge, double-gated (client MOCK_PAYMENTS + server '
  'app_flags.mock_payments) and rate-limited to 3 calls per user per '
  'rolling 24h regardless of the server gate''s state. Migration 117, '
  '2026-09-17 audit.';
