-- ===========================================================================
-- 048  Provider payout accounts
-- ===========================================================================
-- The earnings ledger and weekly payout batches already exist (029), and the
-- admin `payouts` config sets cadence/hold/minimum/split (026). What was missing
-- is the MIDDLE: a provider accrues earnings but has no bank/UPI account to be
-- paid into and no Cashfree beneficiary. ADR-0022: "no provider may be listed
-- until their payout account is verified."
--
-- Scope (product decision, 2026-09-03): NO PAN/Aadhaar KYC. The only PII a
-- provider gives for payout is name, phone, email (all already on the profile)
-- and a bank account / UPI VPA. This migration adds the payout-account table, the
-- client-facing upsert RPC, and the readiness gate. The Cashfree calls (reverse
-- penny drop for name-match, beneficiary creation, disbursement) live in
-- service-role Edge functions and are the ONLY writers of the verification
-- columns and the beneficiary id.
--
-- Security model: the client never writes verification state. Authenticated RLS
-- grants SELECT on own rows only; account details are written through the
-- SECURITY DEFINER RPC `upsert_my_payout_account`, which always resets the row to
-- unverified so editing details can never carry a stale "verified" forward. The
-- Edge functions use the service-role key, which bypasses RLS, to set
-- `verification_status`, `cashfree_beneficiary_id`, and the name-match fields.

-- ---------------------------------------------------------------------------
-- 1. Provider payout accounts (bank / UPI)
-- ---------------------------------------------------------------------------
create table if not exists public.provider_payout_accounts (
  id                    uuid        primary key default gen_random_uuid(),
  provider_id           uuid        not null references public.profiles(id) on delete cascade,
  method                text        not null check (method in ('upi', 'bank')),
  -- UPI rail
  upi_vpa               text,
  -- Bank rail
  account_number        text,
  ifsc                  text,
  account_holder_name   text,
  -- Cashfree beneficiary + verification (service-role only)
  cashfree_beneficiary_id text,
  verification_status   text        not null default 'unverified'
                                    check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  name_at_bank          text,
  name_match_score      numeric,
  verification_ref      text,       -- Cashfree reverse-penny-drop / verification request id
  verification_error    text,
  is_default            boolean     not null default true,
  verified_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Each rail carries only its own identifiers.
  constraint payout_method_fields check (
    (method = 'upi'  and upi_vpa is not null and account_number is null and ifsc is null)
    or
    (method = 'bank' and account_number is not null and ifsc is not null and upi_vpa is null)
  )
);

comment on table public.provider_payout_accounts is
  'Where a provider is paid: one row per bank/UPI destination. verification_* and '
  'cashfree_beneficiary_id are written ONLY by the service-role verify-payout-account '
  'Edge function (Cashfree reverse penny drop + beneficiary create). A provider is '
  'payout-ready when a row here is verification_status = ''verified'' and is_default. '
  'Name/phone/email for the beneficiary come from the profile (no separate KYC). '
  'See ADR-0021/0022.';

-- At most one default per provider — the batch job pays the default.
create unique index if not exists provider_payout_accounts_one_default
  on public.provider_payout_accounts (provider_id)
  where is_default;

create index if not exists provider_payout_accounts_provider
  on public.provider_payout_accounts (provider_id);

alter table public.provider_payout_accounts enable row level security;

-- Providers read their own payout accounts; they never write verification state.
create policy provider_payout_accounts_select_own
  on public.provider_payout_accounts
  for select to authenticated
  using (provider_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Client-facing RPC: save a payout destination (always unverified)
-- ---------------------------------------------------------------------------
-- The client submits raw details; verification is a separate service-role step.
-- SECURITY DEFINER so it can write the RLS-protected table, but it pins the row
-- to the caller and forces the unverified state, so a client can never mark its
-- own account verified or attach a beneficiary id.
create or replace function public.upsert_my_payout_account(
  p_method              text,
  p_upi_vpa             text default null,
  p_account_number      text default null,
  p_ifsc                text default null,
  p_account_holder_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := auth.uid();
  v_id uuid;
begin
  if v_provider is null then
    raise exception 'not authenticated';
  end if;
  if p_method not in ('upi', 'bank') then
    raise exception 'invalid method %', p_method;
  end if;

  -- One destination per provider for now: replace any prior row so editing the
  -- account is a fresh unverified state rather than a second dangling default.
  delete from public.provider_payout_accounts where provider_id = v_provider;

  insert into public.provider_payout_accounts (
    provider_id, method, upi_vpa, account_number, ifsc, account_holder_name,
    verification_status, is_default
  )
  values (
    v_provider, p_method,
    case when p_method = 'upi' then p_upi_vpa end,
    case when p_method = 'bank' then p_account_number end,
    case when p_method = 'bank' then p_ifsc end,
    p_account_holder_name,
    'unverified', true
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_my_payout_account(text, text, text, text, text) from public;
grant execute on function public.upsert_my_payout_account(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Readiness view: can this provider go live? (ADR-0022 gate)
-- ---------------------------------------------------------------------------
-- With no KYC step, a provider may be listed once a default payout account is
-- verified. `security_invoker` so the underlying RLS scopes each caller to their
-- own row.
create or replace view public.my_payout_readiness
with (security_invoker = true) as
select
  p.id                                         as provider_id,
  (a.id is not null and a.verification_status = 'verified' and a.is_default)
                                               as payout_account_verified,
  (a.id is not null and a.verification_status = 'verified' and a.is_default)
                                               as can_go_live
from public.profiles p
left join public.provider_payout_accounts a
  on a.provider_id = p.id and a.is_default
where p.id = auth.uid();

comment on view public.my_payout_readiness is
  'Own-row payout readiness for the signed-in provider: payout_account_verified '
  'and can_go_live. The listing gate for ADR-0022 once payouts are enforced. No '
  'full KYC — name/phone/email + bank account (+ optional PAN) is the only PII.';

grant select on public.my_payout_readiness to authenticated;

-- ---------------------------------------------------------------------------
-- 4. PAN (tax only — NOT a listing gate)
-- ---------------------------------------------------------------------------
-- Not KYC: no Aadhaar, no liveness. Just the PAN number, validated via Cashfree's
-- Verification Suite (returns the name on the PAN), so TDS-194O withholding is
-- 0.1% instead of 5%. A provider can still be paid without a PAN (at 5%), so PAN
-- is deliberately absent from `my_payout_readiness`. Written ONLY by the
-- service-role verify-pan Edge function; the client submits the number through
-- the RPC below and never sets the verified state.
create table if not exists public.provider_tax_profile (
  provider_id     uuid        primary key references public.profiles(id) on delete cascade,
  pan             text,
  pan_name        text,       -- name on the PAN, from Cashfree
  status          text        not null default 'not_provided'
                              check (status in ('not_provided', 'pending', 'verified', 'failed')),
  verification_ref text,
  failure_reason  text,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.provider_tax_profile is
  'Provider PAN for TDS purposes only (not KYC). Validated via Cashfree; PAN drops '
  'TDS-194O from 5% to 0.1%. Written only by the service-role verify-pan function.';

alter table public.provider_tax_profile enable row level security;

create policy provider_tax_profile_select_own
  on public.provider_tax_profile
  for select to authenticated
  using (provider_id = auth.uid());

-- Client submits the PAN number; the verified state is set by the Edge function.
create or replace function public.set_my_pan(p_pan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := auth.uid();
begin
  if v_provider is null then
    raise exception 'not authenticated';
  end if;
  if p_pan is null or p_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'invalid PAN format';
  end if;

  insert into public.provider_tax_profile (provider_id, pan, status)
  values (v_provider, upper(p_pan), 'pending')
  on conflict (provider_id) do update
    set pan = excluded.pan,
        status = 'pending',
        pan_name = null,
        verification_ref = null,
        failure_reason = null,
        verified_at = null,
        updated_at = now();
end;
$$;

revoke all on function public.set_my_pan(text) from public;
grant execute on function public.set_my_pan(text) to authenticated;
