-- session_leases could be planted for ANY paid session by ANY authenticated
-- user. Telegram-CTO audit, 2026-09-17, confirmed CRITICAL (M16).
--
-- "Participants upsert own lease" (030) checks only `user_id = auth.uid()` --
-- never that auth.uid() is actually member_id/provider_id of the referenced
-- paid_sessions row. claim_session_lease (115) guards its OWN insert with
-- `auth.uid() not in (member_id, provider_id) => raise exception`, but that
-- guard only covers calls THROUGH the RPC. Migration 030 also grants
-- insert/update on session_leases directly to `authenticated`, and RLS never
-- checked participancy on the row being written -- so a stranger could
-- insert straight into the table:
--
--   insert into session_leases (session_id, user_id, kind, last_heartbeat_at)
--   values ('<any other pair''s session>', auth.uid(), 'connected', now());
--
-- and the policy would allow it, because `user_id = auth.uid()` was the only
-- check.
--
-- claim_session_lease's own presence check compounds it: `v_both_leases` and
-- `v_both_media` count ANY two session_leases rows for the session_id, not
-- specifically the two rows belonging to v_session.member_id/provider_id.
-- A planted stranger's row is therefore indistinguishable from the real
-- second participant's -- the genuine participant claiming their own lease
-- sees "both present" and the session activates and starts billing even
-- though the person on the other end of the conversation never joined,
-- solely because a third party planted a row for a session_id they read or
-- guessed.
--
-- Two independent fixes, defense in depth:
--   1. The RLS policy now requires auth.uid() to actually be a participant
--      of the referenced paid_sessions row, closing the write path entirely.
--   2. claim_session_lease's counts are narrowed to
--      user_id in (member_id, provider_id), so even a legacy or
--      future stray row for this session_id cannot be counted.

drop policy if exists "Participants upsert own lease" on public.session_leases;
create policy "Participants upsert own lease"
  on public.session_leases
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.paid_sessions ps
      where ps.id = session_leases.session_id
        and auth.uid() in (ps.member_id, ps.provider_id)
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.paid_sessions ps
      where ps.id = session_leases.session_id
        and auth.uid() in (ps.member_id, ps.provider_id)
    )
  );

create or replace function public.claim_session_lease(
  p_session_id uuid,
  p_kind       public.lease_kind default 'foreground'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session     public.paid_sessions%rowtype;
  v_both_leases boolean;
  v_both_media  boolean;
  v_chat_id     uuid;
begin
  select * into v_session
  from public.paid_sessions
  where id = p_session_id
  for update;

  if not found or v_session.status in ('ended', 'reported_hold') then
    return 'ended';
  end if;

  if auth.uid() not in (v_session.member_id, v_session.provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  insert into public.session_leases (session_id, user_id, kind, last_heartbeat_at)
  values (p_session_id, auth.uid(), p_kind, now())
  on conflict (session_id, user_id) do update
    set kind = excluded.kind,
        last_heartbeat_at = excluded.last_heartbeat_at;

  -- M16: narrowed to the session's own two participants. Any other row for
  -- this session_id (planted or stale) no longer counts toward "present".
  select count(*) = 2 into v_both_leases
  from public.session_leases
  where session_id = p_session_id
    and user_id in (v_session.member_id, v_session.provider_id)
    and last_heartbeat_at > now() - interval '30 seconds';

  select count(*) = 2 into v_both_media
  from public.session_leases
  where session_id = p_session_id
    and user_id in (v_session.member_id, v_session.provider_id)
    and kind = 'connected'
    and last_heartbeat_at > now() - interval '30 seconds';

  if v_session.status = 'pending_leases'
     and v_both_leases
     and (v_session.channel = 'chat' or v_both_media)
  then
    begin
      perform public.deduct_tokens(
        v_session.member_id,
        v_session.rate_tokens_per_min,
        p_session_id,
        v_session.economics_config_version_id
      );
    exception when sqlstate 'P0003' then
      perform public.end_session(
        p_session_id, 'balance_exhausted', null, null, null
      );
      return 'ended';
    end;

    update public.paid_sessions
    set status           = 'active',
        started_at       = now(),
        last_activity_at = now(),
        minutes_billed   = 1,
        tokens_debited   = rate_tokens_per_min,
        next_bill_at     = now() + interval '1 minute'
    where id = p_session_id;

    -- A CALL just became real. The chat session it supersedes ends NOW.
    -- (Unchanged from 099 -- see that migration for why this line is here.)
    if v_session.channel <> 'chat' then
      select id into v_chat_id
      from   public.paid_sessions
      where  conversation_id = v_session.conversation_id
        and  channel = 'chat'
        and  status not in ('ended', 'reported_hold')
      limit  1;

      if v_chat_id is not null then
        perform public.end_session(v_chat_id, 'upgraded_to_call');
      end if;
    end if;

    return 'active';
  end if;

  -- Call heartbeat as activity (115): a lease claim on a non-chat session
  -- that is already billing counts as activity, unchanged by this migration.
  if v_session.channel <> 'chat' and v_session.status in ('active', 'warning', 'grace') then
    update public.paid_sessions
    set last_activity_at = now(),
        status = case
          when status in ('warning', 'grace') then 'active'::public.paid_session_status
          else status
        end,
        warning_at = null
    where id = p_session_id;
  end if;

  return v_session.status::text;
end;
$$;

comment on function public.claim_session_lease(uuid, public.lease_kind) is
  'Upserts a per-user session_leases heartbeat and activates a pending call once '
  'both sides hold a live lease (both media leases for a non-chat channel). '
  'Presence counts are restricted to the session''s own member_id/provider_id '
  '(migration 118) -- a stray or planted session_leases row for this session_id '
  'no longer counts as a participant. For an already-active call, also refreshes '
  'last_activity_at (115) -- the only activity signal a call-less-of-messages '
  'channel can produce. Migration 118, 2026-09-17.';
