-- ===========================================================================
-- 021  Chat-session per-minute token meter
-- ===========================================================================
-- Lets the member-side client debit one chat minute's cost (22 tokens =
-- DEFAULT_RATES.chat) from their own balance during an open session.
--
-- Why a dedicated RPC rather than reusing deduct_user_token?
--   `deduct_user_token(p_user_id, p_cost)` is service_role-only — the client
--   cannot call it, by design (migration 002).  A self-scoped SECURITY DEFINER
--   wrapper is the same pattern as `claim_daily_tokens` and `mock_recharge`:
--   the function runs as the owner, debits auth.uid() exclusively, and the
--   caller cannot touch another user's balance.
--
-- Rate is hardcoded at 22 tokens (mirrors DEFAULT_RATES.chat in
-- src/lib/rates.ts).  When per-provider rates are introduced, swap the literal
-- for a lookup; the RPC signature stays the same.

create or replace function public.spend_chat_minute()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  -- Atomic debit: only succeeds if balance >= 22 so it cannot go negative.
  update public.profiles
  set    token_balance = token_balance - 22
  where  id = v_uid
    and  token_balance >= 22
  returning token_balance into v_new;

  if not found then
    return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  return json_build_object('success', true, 'new_balance', v_new);
end;
$$;

-- Self-scoped, so authenticated clients may call it; no other role needs to.
revoke all on function public.spend_chat_minute() from public, anon, service_role;
grant execute on function public.spend_chat_minute() to authenticated;
