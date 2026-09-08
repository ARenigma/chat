-- ===========================================================================
-- 088  refund_unanswered_messages belongs to a billing model we do not run
-- ===========================================================================
-- Amit, 2026-09-08, after an audit turned up that `refund_unanswered_messages`
-- (006) is scheduled nowhere: "fix all four now". The obvious fix is a
-- `cron.schedule`. That fix would give money away, so this migration does the
-- opposite, and the reasoning is written out because the obvious fix will look
-- correct to the next reader too.
--
-- ---------------------------------------------------------------------------
-- WHAT THE FUNCTION DOES
-- ---------------------------------------------------------------------------
-- 006 wrote it for PER-MESSAGE billing. One member message cost one token, so
-- a message a provider never answered was a token taken for nothing, and 006's
-- own comment gives the reason it exists: the difference "between a marketplace
-- and a slot machine". For each unanswered member message it does
--
--   update public.messages set refunded_at = now() ...
--   perform public.credit_user_token(r.sender_id, 1);
--
-- ---------------------------------------------------------------------------
-- WHY SCHEDULING IT NOW WOULD BE A GIVEAWAY
-- ---------------------------------------------------------------------------
-- Migration 037 replaced per-message billing with per-minute paid sessions.
-- After the cutover:
--
--   * `spend_chat_minute` is a documented no-op (037:700-712). Nothing is
--     debited per minute by the client any more.
--   * `send_message` — current version 077:164 — debits NOTHING. There is no
--     `deduct_tokens` and no `spend_*` call anywhere in it. Chat is charged by
--     the session meter: `claim_session_lease` takes minute one (037:439) and
--     `meter_active_sessions` takes each minute after (037:527).
--   * Nothing in the app reads `messages.refunded_at`. Its only readers are
--     006 itself and this file.
--
-- So a message today carries no charge of its own to refund. Crediting one
-- token per unanswered message would hand out tokens that were never taken —
-- once per message, including every message inside a per-minute session that
-- was already metered and settled correctly. On a chatty thread with a slow
-- provider that is not a rounding error.
--
-- The grievance 006 answered is now answered by the meter instead: a session
-- only bills while BOTH parties hold a live lease (037:427-441), so a member is
-- not charged for minutes spent talking to nobody. That is the same promise,
-- enforced at the point of sale rather than refunded a day later.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES
-- ---------------------------------------------------------------------------
-- Turns the function into a no-op that returns 0, exactly as 037 did to
-- `spend_chat_minute`, rather than dropping it:
--
--   * `scripts/moderate.mjs maintenance` calls it by name. Dropping it turns a
--     working operator command into an error; a no-op keeps the command
--     working and stops it paying out. (That call is being removed in the same
--     commit — this is the belt to that braces, for any operator still running
--     an older checkout of the script.)
--   * The name survives in the migration history, so the next person to search
--     for "unanswered" finds this explanation instead of an absence.
--
-- `refunded_at` is left on `messages`. It is the record of refunds that really
-- were paid under the old model, and deleting the evidence of past payouts to
-- tidy up a column is not a trade worth making.
--
-- If per-message billing ever returns, this function is the wrong thing to
-- revive: it should be rewritten against whatever the new charge record is,
-- because a refund must be computed from the debit that actually happened.
-- ---------------------------------------------------------------------------

create or replace function public.refund_unanswered_messages(
  p_after interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Deliberately does nothing. See migration 088's header for why, and do not
  -- schedule this: under per-minute session billing (037) a message carries no
  -- per-message charge, so there is nothing here to refund and every credit
  -- this used to issue would now be a gift.
  perform p_after;
  return 0;
end;
$$;

revoke all on function public.refund_unanswered_messages(interval) from public;
grant execute on function public.refund_unanswered_messages(interval) to service_role;

comment on function public.refund_unanswered_messages(interval) is
  '088: NO-OP, returns 0. Written in 006 for per-message billing (one token '
  'per message, refunded when the provider never replied). Migration 037 moved '
  'chat to per-minute paid sessions and send_message (077) debits nothing per '
  'message, so crediting a token per unanswered message would refund a charge '
  'that never happened. The equivalent protection now lives in '
  'claim_session_lease: a session only bills while both parties hold a live '
  'lease. Do not schedule this function.';
