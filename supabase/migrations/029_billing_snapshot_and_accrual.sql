-- ===========================================================================
-- 029  Billing config snapshot and provider accrual primitives
-- ===========================================================================
-- Introduces the provider earnings ledger, provider payout batch table, and
-- two RPCs that migration 031's session RPCs will call:
--   • get_session_billing_snapshot — reads and returns billing params to be
--     snapshotted at session start (rate, split, hold days, config version).
--   • record_provider_accrual       — writes the earnings ledger row and the
--     provider_accrual token_transactions row at session end.
--
-- provider_earnings_ledger.session_id is an unkeyed uuid here. The FK to
-- paid_sessions (migration 030) is added in migration 030 once that table
-- exists.
--
-- References: ADR-0021

-- ---------------------------------------------------------------------------
-- 1. Provider earnings ledger
-- ---------------------------------------------------------------------------

create table public.provider_earnings_ledger (
  id              uuid        primary key default gen_random_uuid(),
  provider_id     uuid        not null references public.profiles(id),
  -- FK to paid_sessions added in migration 030; bare uuid until then.
  session_id      uuid        not null,
  minutes_billed  integer     not null check (minutes_billed > 0),
  rate_per_min    integer     not null,
  gross_tokens    integer     not null,
  provider_tokens integer     not null,
  hold_until      timestamptz not null,
  status          text        not null default 'pending'
                              check (status in ('pending', 'cleared', 'paid', 'refunded')),
  transaction_id  uuid        references public.token_transactions(id),
  created_at      timestamptz not null default now()
);

comment on table public.provider_earnings_ledger is
  'Per-session provider earnings. One row per ended session with > 0 minutes. '
  'hold_until reflects the settlement hold period from admin payouts config. '
  'Cleared rows are eligible for the weekly payout batch. '
  'session_id FK to paid_sessions is added in migration 030. (ADR-0021)';

comment on column public.provider_earnings_ledger.rate_per_min is
  'Tokens per minute snapshotted at session start. Preserved for rate disputes.';

comment on column public.provider_earnings_ledger.gross_tokens is
  'minutes_billed × rate_per_min — the gross session charge before the revenue split.';

comment on column public.provider_earnings_ledger.provider_tokens is
  'gross_tokens × provider_share_percent / 100 — the provider''s net earning for the session.';

comment on column public.provider_earnings_ledger.hold_until is
  'Settlement date. Derived from admin payouts.hold_days at session end. '
  'The row transitions from pending → cleared by the settlement batch job once '
  'now() >= hold_until and no refund has been issued.';

comment on column public.provider_earnings_ledger.transaction_id is
  'The provider_accrual token_transactions row written atomically with this record. '
  'Null only if the transaction insert failed (should never occur in normal flow).';

alter table public.provider_earnings_ledger enable row level security;

-- Providers can read their own earnings; no client write policy.
create policy "Providers read own earnings"
  on public.provider_earnings_ledger
  for select to authenticated
  using (provider_id = auth.uid());

-- Supports the provider earnings history screen (newest first).
create index on public.provider_earnings_ledger (provider_id, created_at desc);
-- Supports the settlement batch job that clears pending rows past hold_until.
create index on public.provider_earnings_ledger (status, hold_until)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. Provider payout batches
-- ---------------------------------------------------------------------------

create table public.provider_payout_batches (
  id                uuid        primary key default gen_random_uuid(),
  provider_id       uuid        not null references public.profiles(id),
  status            text        not null default 'pending'
                                check (status in ('pending', 'processing', 'completed', 'failed')),
  total_tokens      integer     not null check (total_tokens > 0),
  total_paise       integer     not null check (total_paise > 0),
  cashfree_batch_id text,
  initiated_at      timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.provider_payout_batches is
  'Provider payout batches. One row per weekly disbursement attempt. '
  'cashfree_batch_id is populated by the payout Edge Function once the batch '
  'is submitted to Cashfree Payouts. status moves to completed or failed when '
  'the Cashfree webhook is received. (ADR-0021)';

comment on column public.provider_payout_batches.total_paise is
  'total_tokens × 100 (1 token = ₹1 = 100 paise). Stored explicitly so payout '
  'arithmetic is auditable without recalculating from the ledger.';

alter table public.provider_payout_batches enable row level security;

-- Providers can read their own payout batches; no client write policy.
create policy "Providers read own batches"
  on public.provider_payout_batches
  for select to authenticated
  using (provider_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Billing snapshot helper (called at session start)
-- ---------------------------------------------------------------------------
-- Returns the four billing parameters the session RPC must snapshot before
-- the call begins. Reading at session start and storing on the session row
-- ensures that an admin config change mid-session does not split a bill at
-- two different rates. (ADR-0021)

create or replace function public.get_session_billing_snapshot(p_channel text)
returns table(
  rate_tokens_per_min    integer,
  provider_share_percent integer,
  payout_hold_days       integer,
  economics_version_id   uuid
)
language plpgsql
stable
security definer
set search_path = public, admin
as $$
declare
  v_economics  jsonb;
  v_payouts    jsonb;
  v_rate       integer;
  v_share      integer;
  v_hold       integer;
  v_version_id uuid;
begin
  -- Both calls fall back to ADR-0021 defaults when no active prod config exists.
  v_economics := public.get_active_config('economics');
  v_payouts   := public.get_active_config('payouts');

  v_rate := case p_channel
    when 'chat'  then coalesce((v_economics->>'chat_rate_tokens_per_min')::integer,  22)
    when 'audio' then coalesce((v_economics->>'audio_rate_tokens_per_min')::integer, 22)
    when 'video' then coalesce((v_economics->>'video_rate_tokens_per_min')::integer, 35)
    else 22
  end;

  v_share := coalesce((v_economics->>'provider_share_percent')::integer, 60);
  v_hold  := coalesce((v_payouts->>'hold_days')::integer, 7);

  -- The config_version_id lets a future rate dispute pinpoint the exact
  -- published economics payload that governed this session's billing.
  select ca.version_id
  into   v_version_id
  from   admin.config_active ca
  where  ca.domain      = 'economics'
    and  ca.environment = 'prod';

  return query select v_rate, v_share, v_hold, v_version_id;
end;
$$;

comment on function public.get_session_billing_snapshot(text) is
  'Returns (rate_tokens_per_min, provider_share_percent, payout_hold_days, '
  'economics_version_id) from the active prod admin config. Falls back to '
  'ADR-0021 defaults (chat/audio 22, video 35, split 60 %, hold 7 days) if '
  'no active prod config has been published. Called at session start; the '
  'session row snapshots these values for audit and dispute resolution. (ADR-0021)';

revoke all on function public.get_session_billing_snapshot(text) from public;
grant execute on function public.get_session_billing_snapshot(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Provider accrual writer (called at session end)
-- ---------------------------------------------------------------------------
-- Writes a provider_earnings_ledger row and a provider_accrual
-- token_transactions row in a single transaction. Called inside end_session
-- (migration 031); not directly callable by the authenticated client.

create or replace function public.record_provider_accrual(
  p_provider_id            uuid,
  p_session_id             uuid,
  p_minutes_billed         integer,
  p_rate_per_min           integer,
  p_provider_share_percent integer,
  p_payout_hold_days       integer,
  p_config_version_id      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross    integer := p_minutes_billed * p_rate_per_min;
  v_provider integer := (v_gross * p_provider_share_percent) / 100;
  v_tx_id    uuid;
begin
  -- Zero-minute sessions (ended before the first full minute) accrue nothing.
  if v_gross = 0 then return; end if;

  -- Write the ledger row first; the earnings row points back to it.
  insert into public.token_transactions (
    user_id, kind, status, amount_paise, tokens_delta,
    session_id, config_version_id, provider_id
  ) values (
    p_provider_id, 'provider_accrual', 'succeeded',
    v_provider * 100, v_provider,
    p_session_id, p_config_version_id, p_provider_id
  )
  returning id into v_tx_id;

  insert into public.provider_earnings_ledger (
    provider_id, session_id,
    minutes_billed, rate_per_min,
    gross_tokens, provider_tokens,
    hold_until, transaction_id
  ) values (
    p_provider_id, p_session_id,
    p_minutes_billed, p_rate_per_min,
    v_gross, v_provider,
    now() + make_interval(days => p_payout_hold_days),
    v_tx_id
  );
end;
$$;

comment on function public.record_provider_accrual(uuid, uuid, integer, integer, integer, integer, uuid) is
  'Writes a provider_earnings_ledger row and a provider_accrual '
  'token_transactions row at session end. No-ops when p_minutes_billed * '
  'p_rate_per_min = 0. Called inside end_session RPC (migration 031); not '
  'directly client-callable. (ADR-0021)';

revoke all on function public.record_provider_accrual(uuid, uuid, integer, integer, integer, integer, uuid) from public;
-- Not granted to authenticated: called only from session RPCs that run as
-- SECURITY DEFINER under service_role ownership.
