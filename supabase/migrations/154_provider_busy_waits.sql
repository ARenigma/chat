-- ===========================================================================
-- 154  provider_busy_waits: "Busy, wait ~N m" on the provider card
-- ===========================================================================
-- Owner decision (Amit, 2026-09-27): a provider who is in a paid session shows
-- a red Chat/Call CTA with "wait ~N m" under it, server-synced. N is the
-- BALANCE-LIMITED REMAINING time of the session they are in: the most it can
-- still run on the member's balance at that session's rate. The server knows
-- that bound exactly, so the client is given it and never derives it. When no
-- bound can be computed (no rate on the row) the minutes are null and the card
-- says just "Busy".
--
-- ── "In a session" ──────────────────────────────────────────────────────────
-- A live paid_sessions row: status in ('pending_leases', 'active', 'warning',
-- 'grace'). That is exactly the set get_active_session (062) returns, the set
-- get_home_suggestions (126) treats as "this provider is taken", and the
-- complement of the terminal states paid_sessions_one_live (030) excludes.
--
-- ── The bound ───────────────────────────────────────────────────────────────
-- Spendable balance is promo_balance + purchased_balance, the sum deduct_tokens
-- (028) checks before every minute; promo tokens are spent first but are still
-- minutes. The rate is paid_sessions.rate_tokens_per_min, snapshotted at
-- acceptance (037) and raised in place when a call switches to video (132), so
-- it is the rate the NEXT minute will be billed at.
--
--   * Billing started (next_bill_at set by claim_session_lease, 037): the same
--     figure the member's own countdown reads, 062's
--       seconds = (next_bill_at - now()) + floor(balance / rate) * 60
--     rounded UP to whole minutes. This is the true upper bound. The naive
--     ceil(balance / rate) is equal to it except when the balance is an exact
--     multiple of the rate right after the cron has debited a minute, where it
--     is one minute SHORT because it forgets the current, already-paid minute
--     (569 test 4 pins that case). And like 062 it does not jump by a minute
--     when the cron catches up on a lagged tick.
--   * Accepted, leases pending (next_bill_at null): nothing is debited yet, and
--     every minute is debited before it is used (037: minute 1 at activation,
--     minute k at next_bill_at), so the session can bill floor(balance / rate)
--     minutes. The lease wait itself is seconds in practice; the 15-minute
--     pending expiry in meter_active_sessions is a backstop, not a duration.
--   * rate null or <= 0: no computable bound, null. No path writes such a row
--     today; mock_payments (020) only fakes recharge, and sessions still debit
--     real tokens. The null branch is there so a free or promotional session
--     added later degrades to "Busy" rather than to a division by zero.
--
-- Displayed as at least 1 (a provider still in a session is not "wait 0 m";
-- the next cron tick ends a spent session within a minute) and at most 99.
-- A provider with several live sessions reads the longest, and null if any of
-- them is unbounded: they are free when the last one ends.
--
-- ── Privacy: this is derived from someone else's wallet ─────────────────────
-- The minutes are a function of ANOTHER member's balance, which 062 withholds
-- even from the provider in that session ("the member's wallet in disguise").
-- Publishing a coarse form of it here is acceptable, and bounded, because:
--   1. It is what the busy provider's NEXT member needs, and nothing more: how
--      long until this person can talk to me. The alternative the product
--      rejected is a bare "Busy" that sends them away.
--   2. It names nobody. The row is (provider_id, wait_minutes). No member id,
--      conversation id, session id, channel, rate or balance leaves the
--      function, and the directory gives no way to learn who the provider is
--      talking to, so the figure attaches to no identity.
--   3. It is coarse. Whole minutes rounded up, and capped at 99, so any balance
--      above 99 minutes' worth is indistinguishable from any other. Multiplying
--      back by a rate gives a range a whole rate wide, about a member nobody
--      can name.
--   4. The provider in the session cannot read it. The caller must be a member
--      (providers get no rows), so the one person who knows who the member is
--      cannot turn this into that member's balance. A member reading their own
--      session learns their own balance, which they already have.
--   5. The directory's own boundaries hold: listed providers only
--      (provider_is_listed, 070, over the 004 view) and never across a block in
--      either direction (is_blocked_pair, 005), the same two rules
--      get_home_suggestions and story_is_visible apply. A blocked member learns
--      nothing about the blocker's sessions.
--   6. The input is capped at 100 ids, the directory page scale, so this is
--      not a bulk scan of the whole provider base per call.
--
-- ── Grants ──────────────────────────────────────────────────────────────────
-- Revoked from PUBLIC and anon, granted to authenticated, and on 568's list.
-- 153 closed the default for new functions, so without this grant the RPC is
-- uncallable, and without the 568 entry that suite fails.

create or replace function public.provider_busy_waits(p_provider_ids uuid[])
returns table (provider_id uuid, wait_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if coalesce(cardinality(p_provider_ids), 0) > 100 then
    raise exception 'at most 100 provider ids per call'
      using errcode = '22023';
  end if;

  -- Member-facing, like the directory it decorates. A provider (including the
  -- one in the session) gets nothing: see point 4 above.
  if not exists (
    select 1 from public.profiles me
    where me.id = v_uid and me.role = 'member'
  ) then
    return;
  end if;

  return query
  with wanted as (
    select distinct w.id
    from   unnest(coalesce(p_provider_ids, '{}'::uuid[])) as w(id)
    where  w.id is not null
  ),
  live as (
    select ps.provider_id as pid,
           case
             when ps.rate_tokens_per_min is null or ps.rate_tokens_per_min <= 0
               then null
             when ps.next_bill_at is null
               then (coalesce(m.promo_balance, 0) + coalesce(m.purchased_balance, 0))
                    / ps.rate_tokens_per_min
             else ceil(
                    greatest(
                      0,
                      floor(extract(epoch from (ps.next_bill_at - now())))::integer
                        + ((coalesce(m.promo_balance, 0) + coalesce(m.purchased_balance, 0))
                           / ps.rate_tokens_per_min) * 60
                    ) / 60.0
                  )::integer
           end as minutes
    from   wanted
    join   public.paid_sessions ps on ps.provider_id = wanted.id
    left join public.profiles m on m.id = ps.member_id
    where  ps.status in ('pending_leases', 'active', 'warning', 'grace')
      and  public.provider_is_listed(ps.provider_id)
      and  not public.is_blocked_pair(v_uid, ps.provider_id)
  )
  select live.pid,
         case
           when bool_or(live.minutes is null) then null
           else least(99, greatest(1, max(live.minutes)))::integer
         end
  from   live
  group  by live.pid;
end;
$$;

comment on function public.provider_busy_waits(uuid[]) is
  'For up to 100 provider ids: one row per listed, unblocked provider who is in '
  'a live paid session (pending_leases/active/warning/grace, as 062), with the '
  'most minutes that session can still run on the member''s balance at its rate, '
  'rounded up, clamped to 1..99, or null when no bound is computable. Members '
  'only. Returns no member id, balance, rate or session detail (154).';

revoke all on function public.provider_busy_waits(uuid[]) from public, anon;
grant execute on function public.provider_busy_waits(uuid[]) to authenticated;
