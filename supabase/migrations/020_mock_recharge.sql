-- ===========================================================================
-- 020  Mock recharge — gated dev-only payment stub
-- ===========================================================================
-- Enables the full recharge UX with a real ledger write, without touching any
-- live payment rail.  Inert in production: the function returns MOCK_DISABLED
-- until an operator flips app_flags.mock_payments = true, which is never done
-- in the production environment.
--
-- Safe to deploy to production: the seed row is inserted with enabled=false,
-- and the client gate (MOCK_PAYMENTS = APP_ENV !== 'production') means the
-- Pay button is never enabled in a production build regardless of the flag.

-- ---------------------------------------------------------------------------
-- 1. Feature flags table
-- ---------------------------------------------------------------------------
create table public.app_flags (
  key     text    primary key,
  enabled boolean not null default false
);

comment on table public.app_flags is
  'Operator-controlled feature flags. Readable only by service_role (no RLS '
  'policies); authenticated clients call SECURITY DEFINER functions that read '
  'the relevant row internally, so the flag table itself is never client-visible.';

alter table public.app_flags enable row level security;
-- No policies: service_role bypasses RLS; all other roles are denied SELECT.

-- Seed the mock-payments flag as OFF so production is never accidentally armed.
insert into public.app_flags (key, enabled)
values ('mock_payments', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. mock_recharge — self-scoped, validated, flag-gated ledger credit
-- ---------------------------------------------------------------------------
-- To enable for testing:
--   update public.app_flags set enabled = true where key = 'mock_payments';
-- To disable:
--   update public.app_flags set enabled = false where key = 'mock_payments';

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
  perform credit_user_token(v_uid, p_tokens);

  return json_build_object(
    'success',        true,
    'transaction_id', v_tx_id,
    'new_balance',    (select token_balance from public.profiles where id = v_uid)
  );
end;
$$;

-- Callable by the authenticated client (self-scoped, cannot credit another user).
revoke all on function public.mock_recharge(integer, integer)
  from public, anon, service_role;
grant execute on function public.mock_recharge(integer, integer)
  to authenticated;
