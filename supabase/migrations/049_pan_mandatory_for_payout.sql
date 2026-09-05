-- ===========================================================================
-- 049  PAN mandatory for payout readiness
-- ===========================================================================
-- 048 made PAN optional (tax-rate only). Product decision (Amit, 2026-09-03):
-- PAN is now MANDATORY — a provider is not payout-ready until BOTH a default
-- bank/UPI account is verified AND their PAN is verified. Redefine the readiness
-- view to add `pan_verified` and fold it into `can_go_live`. Append-only: this
-- supersedes the 048 view definition.

-- CREATE OR REPLACE cannot insert a column before an existing view column.
drop view if exists public.my_payout_readiness;

create or replace view public.my_payout_readiness
with (security_invoker = true) as
select
  p.id                                         as provider_id,
  (a.id is not null and a.verification_status = 'verified' and a.is_default)
                                               as payout_account_verified,
  coalesce(t.status, 'not_provided') = 'verified'
                                               as pan_verified,
  -- Both a verified default payout account AND a verified PAN are required.
  (a.id is not null and a.verification_status = 'verified' and a.is_default)
    and coalesce(t.status, 'not_provided') = 'verified'
                                               as can_go_live
from public.profiles p
left join public.provider_payout_accounts a
  on a.provider_id = p.id and a.is_default
left join public.provider_tax_profile t
  on t.provider_id = p.id
where p.id = auth.uid();

comment on view public.my_payout_readiness is
  'Own-row payout readiness for the signed-in provider: payout_account_verified, '
  'pan_verified, and can_go_live (both). PAN is mandatory as of migration 049 — '
  'a provider cannot be listed until bank + PAN are both verified (ADR-0022).';

grant select on public.my_payout_readiness to authenticated;
