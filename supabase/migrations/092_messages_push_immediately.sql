-- ===========================================================================
-- 092  A message notification arrives when the message does, not up to a
--      minute later
-- ===========================================================================
-- Reported from two devices on 2026-09-08 (Amit, testing as ravilistens against
-- Yash): "provider sending msg but consistent notification is not there".
--
-- It is not a delivery failure. It is a poll.
--
--   * A CALL notifies immediately: `call_push_on_insert` is an AFTER INSERT
--     trigger on `public.calls` (017:77-80) that posts to `send-call` in the
--     same transaction.
--   * A MESSAGE had no trigger at all. The only triggers on `public.messages`
--     are three column guards and `messages_touch_session_activity`. Delivery
--     rested entirely on `dispatch-pending-pushes`, a pg_cron job on
--     `* * * * *` (009:147-160).
--
-- So a message notification was 0-60 seconds late depending on where in the
-- minute the message landed. That is exactly the shape of the complaint:
-- notifications DO arrive, and they feel unreliable, because the delay is
-- uniformly distributed and a fast reply beats its own notification.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER IS SAFE HERE, AND WHY IT IS NOT THE CALL TRIGGER'S SHAPE
-- ---------------------------------------------------------------------------
-- `pending_pushes` (009:21-42) is one row per (undelivered message, device),
-- filtered on `notified_at is null`, and `send-push` stamps `notified_at`. So
-- there is no debounce to preserve and nothing to double-send: firing the
-- dispatcher early only drains a queue the cron would have drained later, and
-- the cron stays in place as the retry path for anything the trigger's HTTP
-- call loses.
--
-- What this does NOT copy from `dispatch_call_push` is its error handling,
-- because it has none — it reads `vault.decrypted_secrets` bare. On `calls`
-- that is survivable; on `messages` it is not:
--
--   1. A notification must never be able to fail a message send. Without the
--      handler below, a pg_net queue error or a vault hiccup would abort the
--      INSERT and the member's message would vanish with a write error, to
--      deliver a notification. The message is the product; the notification is
--      an optimisation. Losing the greater to serve the lesser is the wrong
--      trade in every case.
--   2. `scripts/db-test.mjs` runs these migrations against plain
--      postgres+pgTAP with no pg_net and no Vault (009:60-65). An unguarded
--      trigger would make every message INSERT in every RLS test fail, which
--      would take the suite that proves user isolation down with it.
--
-- Hence: a `to_regclass` guard for the schema that may not exist, and an
-- exception block that swallows everything. A swallowed notification is a late
-- notification (the cron will retry within the minute). A raised one is a lost
-- message.
--
-- STATEMENT-level, not ROW-level: the dispatcher takes no arguments and drains
-- the whole queue, so one call per statement is sufficient and a bulk insert
-- does not fan out into N HTTP requests.
-- ---------------------------------------------------------------------------

create or replace function public.notify_message_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  -- The test harness has no Vault. Checked rather than assumed, because the
  -- alternative is every message INSERT failing there.
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  perform public.dispatch_pending_pushes();
  return null;
exception
  when others then
    -- Deliberately silent and deliberately total. The cron job on `* * * * *`
    -- is still scheduled and will send this message's notification on its next
    -- pass, so the cost of swallowing is at most the latency this migration
    -- exists to remove — and the cost of NOT swallowing is the member's message.
    return null;
end;
$$;

revoke all on function public.notify_message_push() from public, anon, authenticated;

comment on function public.notify_message_push() is
  '092. Fires dispatch_pending_pushes() as soon as a message is inserted, so a '
  'chat notification does not wait for the once-a-minute cron. Cannot fail its '
  'own INSERT: a notification is never worth a lost message.';

drop trigger if exists message_push_on_insert on public.messages;
create trigger message_push_on_insert
  after insert on public.messages
  for each statement execute function public.notify_message_push();
