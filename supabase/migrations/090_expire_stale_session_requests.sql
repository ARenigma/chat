-- ===========================================================================
-- 090  A pending request past its own expiry suppresses every request after it
-- ===========================================================================
-- Found against PRODUCTION on 2026-09-08, running scripts/prod-check.mjs after
-- the 089 repair. One row failed the "chat request answered but never started"
-- invariant: a chat request from 2026-09-07 18:26, answered by the provider a
-- minute later, still `pending` 21 hours on, with thirteen messages in the
-- conversation and no session created for it. The conversation's only paid
-- session had ended hours earlier (5 minutes, 110 tokens, settled correctly).
--
-- That row is the 2026-09-07 deadlock's shape, and left alone it was about to
-- get worse rather than better, at a predictable time.
--
-- ---------------------------------------------------------------------------
-- THE MECHANISM
-- ---------------------------------------------------------------------------
-- Three pieces that are each individually reasonable:
--
--   1. `session_requests_one_pending` is UNIQUE (conversation_id, channel)
--      WHERE status = 'pending'. One open request per conversation per channel.
--
--   2. `send_message` (077) decides whether to open a request with
--
--        if not exists (select 1 from public.session_requests
--                       where conversation_id = ... and channel = 'chat'
--                         and status = 'pending')
--
--      — `status` only. It does not look at `expires_at`.
--
--   3. `confirm_chat_session` (077:41-43) and `accept_session_request` (086)
--      both REFUSE a request whose `expires_at` has passed, and mark it
--      `expired` on the way out.
--
-- So a request that passes its 24-hour expiry without anybody touching it
-- keeps `status = 'pending'` indefinitely. From that moment:
--
--   * (2) sees a pending request and opens no new one, on every send, forever.
--   * (3) is never reached, because the member's consent sheet is what reaches
--     it, and the sheet is exactly what the member did not open.
--
-- The result is a conversation permanently unable to open a paid session while
-- still able to exchange messages: an unbilled chat with no expiry and no
-- error. Nothing throws. It is the failure class scripts/prod-check.mjs was
-- written for — "every layer did exactly what its own code said, and the
-- composition deadlocked".
--
-- It self-heals only if the member opens the sheet once more, which costs them
-- one "Request has expired" error and is not something the product can rely
-- on. The live row expires at 2026-09-08 18:26:31+00; before this migration,
-- that timestamp was the moment its conversation became permanently free.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY IT IS THIS ONE
-- ---------------------------------------------------------------------------
-- A sweep that applies the rule the code ALREADY BELIEVES. Both readers of a
-- request treat `expires_at < now()` as expired; only the writer of the status
-- column disagrees, by omission. So this changes no policy — it stops the row
-- from lying about a decision that was already made by the clock.
--
-- NOT a rewrite of `send_message` to add `and expires_at > now()`. That is the
-- more targeted change and it is deliberately not being made here: it is a
-- 250-line SECURITY DEFINER function on the billing path, the predicate alone
-- is not sufficient (the stale row still occupies the unique index, so the
-- insert that follows would need the expiry too), and a same-day rewrite of it
-- to close a hole a one-minute sweep closes is the wrong trade. With the sweep
-- running on the meters' cadence the suppression window is at most sixty
-- seconds instead of forever. The predicate remains worth adding on its own,
-- with its own tests, and is not urgent once this exists.
--
-- Idempotent, and safe on any database: it only ever moves rows the readers
-- would already refuse.
-- ---------------------------------------------------------------------------

create or replace function public.expire_stale_session_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.session_requests
    set    status = 'expired'
    where  status = 'pending'
      and  expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_session_requests()
  from public, anon, authenticated;
grant execute on function public.expire_stale_session_requests() to service_role;

comment on function public.expire_stale_session_requests() is
  '090: marks pending session_requests expired once expires_at has passed. '
  'Applies the rule confirm_chat_session and accept_session_request already '
  'enforce on read. Exists because send_message tests status only, so a '
  'pending-but-expired row suppresses every later request in that '
  'conversation — an unbilled chat with no error. Scheduled every minute.';

-- One-time: clear anything already in that state, so the fix applies to the
-- rows that motivated it and not only to future ones.
select public.expire_stale_session_requests();

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping expire-stale-session-requests schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'expire-stale-session-requests') then
    perform cron.unschedule('expire-stale-session-requests');
  end if;

  -- Every minute, the same cadence as meter-active-sessions and
  -- meter-active-calls. This is a correctness sweep on the billing path, not
  -- housekeeping: a minute of suppression is one missed request, a day of it
  -- is a conversation that has quietly stopped being a product.
  perform cron.schedule(
    'expire-stale-session-requests',
    '* * * * *',
    $cron$select public.expire_stale_session_requests()$cron$
  );
end
$$;
