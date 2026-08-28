-- ===========================================================================
-- 022  Chat-session per-minute token meter — drain-to-zero semantics
-- ===========================================================================
-- Supersedes migration 021's spend_chat_minute() with correct "last minute"
-- semantics.  The key difference from 021:
--
--   021 behaviour (wrong): debits 22 and returns INSUFFICIENT_BALANCE when
--   balance < 22, stranding the sub-minute remainder and ending the session
--   early.
--
--   022 behaviour (correct):
--     • When balance >= 1 and balance < 22 (sub-minute remainder), the minute
--       is STILL granted and the balance is drained to exactly 0 via
--       greatest(0, token_balance - 22).  No pro-rating by second.  The
--       remainder is never stranded.
--     • The session ends only when a charge is attempted and the balance is
--       ALREADY 0 (OUT_OF_TOKENS).  Not when balance < 22.
--     • The return shape adds `last` (true when the balance just hit 0) so
--       the client knows the session is serving its final minute and can end
--       cleanly on the NEXT OUT_OF_TOKENS response.
--
-- Return shapes:
--   {success:true,  new_balance:<n>, last:<bool>}  — debit succeeded.
--   {success:false, error:'OUT_OF_TOKENS'}          — balance was already 0.
--   {success:false, error:'NOT_AUTHENTICATED'}      — no session.
--   {success:false, error:'NO_PROFILE'}             — profile row missing.

create or replace function public.spend_chat_minute()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_bal integer;
  v_new integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return json_build_object('success', false, 'error', 'NOT_AUTHENTICATED');
  end if;

  select token_balance into v_bal
  from public.profiles
  where id = v_uid;

  if not found then
    return json_build_object('success', false, 'error', 'NO_PROFILE');
  end if;

  -- Balance already 0: the last minute has been fully consumed.
  -- This is the ONLY condition that ends the session.
  if v_bal <= 0 then
    return json_build_object('success', false, 'error', 'OUT_OF_TOKENS');
  end if;

  -- Drain: greatest(0, …) handles a sub-minute remainder (1–21 tokens)
  -- without going negative and without pro-rating by second.
  -- 22 = DEFAULT_RATES.chat (src/lib/rates.ts).
  update public.profiles
  set    token_balance = greatest(0, token_balance - 22)
  where  id = v_uid
  returning token_balance into v_new;

  -- last=true: balance just hit 0.  The caller serves the full minute and
  -- then ends the session on the NEXT charge attempt (OUT_OF_TOKENS).
  return json_build_object(
    'success',     true,
    'new_balance', v_new,
    'last',        (v_new = 0)
  );
end;
$$;

-- Self-scoped: only the authenticated user's own balance is touched.
revoke all on function public.spend_chat_minute() from public, anon, service_role;
grant execute on function public.spend_chat_minute() to authenticated;
