-- ===========================================================================
-- 058  Clear pending provider earnings past hold_until
-- ===========================================================================
-- Migration 029 wrote accruals as status='pending' with hold_until =
-- now() + payout_hold_days, and documented a settlement batch that flips
-- pending → cleared. create_provider_payout_batch (050) only claims
-- status='cleared' rows. Without this job, Cashfree never sees real accruals.
--
-- Refunded rows are already status='refunded' and are left alone.
-- Idempotent: re-running after a clear is a no-op (row_count 0).

create or replace function public.clear_pending_earnings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.provider_earnings_ledger
  set status = 'cleared'
  where status = 'pending'
    and hold_until <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.clear_pending_earnings() is
  'Settlement batch: pending → cleared once hold_until has passed. '
  'Service-role / cron only. ADR-0021 7-day hold; 050 claims cleared rows.';

revoke all on function public.clear_pending_earnings() from public, anon, authenticated;
grant execute on function public.clear_pending_earnings() to service_role;

-- Hourly is enough for a multi-day hold; :05 avoids colliding with the
-- minute-granularity meter jobs at :00.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping clear-pending-earnings schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'clear-pending-earnings') then
    perform cron.unschedule('clear-pending-earnings');
  end if;

  perform cron.schedule(
    'clear-pending-earnings',
    '5 * * * *',
    $cron$select public.clear_pending_earnings()$cron$
  );
end
$$;
