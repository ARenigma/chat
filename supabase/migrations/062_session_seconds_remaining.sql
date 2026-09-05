-- ===========================================================================
-- 062  Session seconds remaining — one server snapshot for the chat countdown
-- ===========================================================================
-- The member's chat bar is to count DOWN the time their balance still buys,
-- ticking per second only inside the last five minutes (Amit, 2026-09-05,
-- goal item 5). The client cannot compute that number honestly on its own:
--
--   minute k is entitled from started_at + (k-1) min and DEDUCTED by pg_cron
--   at the first meter_active_sessions() tick at or after next_bill_at — up
--   to a minute later. So a balance the client fetched may or may not already
--   include the current minute, and a countdown derived from balance alone
--   jumps by ±60 s on every refetch.
--
-- Read in ONE snapshot, the two terms agree by construction:
--
--   seconds_remaining = (next_bill_at - now()) + floor(balance / rate) * 60
--
-- Before the cron catches up, next_bill_at is in the past (negative first
-- term) and the balance still holds the current minute's tokens (one more
-- minute in the second term). After it, the first term is positive and the
-- second is one minute smaller. Same sum, to the second — test 240 proves it.
--
-- Member only. The provider's bar has no countdown, and the figure is the
-- member's wallet in disguise (seconds × rate ÷ 60); it stays null for them
-- until showing it is a product decision rather than a side effect.
--
-- `minutes_billed` and `next_bill_at` ride along for the same reason the
-- snapshot exists: a client that wants to reason about billing should be
-- reading the row Postgres billed from, not reconstructing it.

create or replace function public.get_active_session(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_session   public.paid_sessions%rowtype;
  v_balance   integer;
  v_remaining integer;
begin
  if v_uid is null then return null; end if;

  select * into v_session
  from   public.paid_sessions
  where  conversation_id = p_conversation_id
    and  (member_id = v_uid or provider_id = v_uid)
    and  status in ('pending_leases', 'active', 'warning', 'grace')
  order  by accepted_at desc
  limit  1;

  if not found then return null; end if;

  -- Member only, and only once billing has started: claim_session_lease sets
  -- next_bill_at alongside started_at at activation (migration 037).
  if v_uid = v_session.member_id
     and v_session.next_bill_at is not null
     and v_session.rate_tokens_per_min > 0 then
    select token_balance into v_balance
    from   public.profiles
    where  id = v_session.member_id;

    -- Integer division on purpose: a partial minute is not a minute the
    -- balance buys. Floored at zero: once the paid minute has lapsed and the
    -- balance is spent, the next cron tick ends the session — there is no
    -- negative time to show.
    v_remaining := greatest(
      0,
      floor(extract(epoch from (v_session.next_bill_at - now())))::integer
        + (coalesce(v_balance, 0) / v_session.rate_tokens_per_min) * 60
    );
  end if;

  return jsonb_build_object(
    'id',                  v_session.id,
    'conversation_id',     v_session.conversation_id,
    'status',              v_session.status,
    'channel',             v_session.channel,
    'member_id',           v_session.member_id,
    'provider_id',         v_session.provider_id,
    'rate_tokens_per_min', v_session.rate_tokens_per_min,
    'started_at',          v_session.started_at,
    'accepted_at',         v_session.accepted_at,
    'ended_at',            v_session.ended_at,
    'last_activity_at',    v_session.last_activity_at,
    'minutes_billed',      v_session.minutes_billed,
    'next_bill_at',        v_session.next_bill_at,
    'seconds_remaining',   v_remaining
  );
end;
$$;

comment on function public.get_active_session(uuid) is
  'Returns the pending_leases or active paid session for a conversation, or '
  'NULL if none. Callers see only sessions they are party to. The member '
  'additionally receives seconds_remaining = (next_bill_at - now) + '
  'floor(balance / rate) * 60, read in one snapshot so the chat countdown '
  'never jumps when the cron catches up on a minute. ADR-0020; migration 062.';

revoke all on function public.get_active_session(uuid) from public, anon;
grant execute on function public.get_active_session(uuid) to authenticated;
