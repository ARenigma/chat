-- ===========================================================================
-- 124  Usage ledger carries actual elapsed seconds (Amit, 2026-09-20)
-- ===========================================================================
-- Caller direction: "actual elapsed X min Y sec everywhere" — display shows
-- wall-clock talk time so members and providers see exactly how long each
-- conversation lasted. Billing charges remain on minutes_billed (whole started
-- minutes); the client uses elapsed_seconds for display and minutes_billed for
-- any cost-related display, so the two are never conflated.
--
-- CHANGE: add elapsed_seconds to each row:
--   floor(extract(epoch from (ended_at - started_at)))
-- Null when either timestamp is absent (a session that was accepted but whose
-- end timestamp was not recorded). The client falls back to minutes_billed * 60
-- when elapsed_seconds is null, so older server builds remain compatible.
-- ---------------------------------------------------------------------------

create or replace function public.get_usage_ledger(
  p_limit  integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows  jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row_started_at desc), '[]'::jsonb)
  into   v_rows
  from (
    select
      jsonb_build_object(
        'session_id',      ps.id,
        'channel',         ps.channel,
        'started_at',      ps.started_at,
        'ended_at',        ps.ended_at,
        -- Actual wall-clock elapsed seconds for display (124). Null when either
        -- timestamp is absent; client falls back to minutes_billed * 60.
        'elapsed_seconds', case
          when ps.started_at is not null and ps.ended_at is not null
            then greatest(0, floor(extract(epoch from (ps.ended_at - ps.started_at))))::integer
        end,
        'minutes',         ps.minutes_billed,
        -- The caller's own side of the money, never both.
        'i_am_member', ps.member_id = v_uid,
        'tokens', case
          when ps.member_id = v_uid then ps.tokens_debited
          else coalesce(e.provider_tokens, 0)
        end,
        'earnings_status', case when ps.provider_id = v_uid then e.status end,
        'peer_id', case when ps.member_id = v_uid then ps.provider_id else ps.member_id end,
        'peer_name', case
          when ps.member_id = v_uid
            then coalesce(d.display_name, 'Someone')
          else public.member_handle(ps.member_id)
        end
      ) as row,
      coalesce(ps.started_at, ps.accepted_at) as row_started_at
    from   public.paid_sessions ps
    left join public.provider_directory d on d.id = ps.provider_id
    left join public.provider_earnings_ledger e
           on e.session_id = ps.id and e.provider_id = v_uid
    where  (ps.member_id = v_uid or ps.provider_id = v_uid)
      and  ps.minutes_billed > 0
      and  (p_before is null or coalesce(ps.started_at, ps.accepted_at) < p_before)
    order  by coalesce(ps.started_at, ps.accepted_at) desc
    limit  v_limit
  ) t;

  return v_rows;
end;
$$;

comment on function public.get_usage_ledger(integer, timestamptz) is
  'Per-session usage for the caller, newest first (069, 124). One RPC for both '
  'roles: a member reads what they spent, a provider reads their own share, and '
  'neither is shown the other''s figure. Billed sessions only. elapsed_seconds '
  'is wall-clock talk time for display; minutes_billed is what was charged. '
  'Carries no message content.';

revoke all on function public.get_usage_ledger(integer, timestamptz) from public, anon;
grant execute on function public.get_usage_ledger(integer, timestamptz) to authenticated;
