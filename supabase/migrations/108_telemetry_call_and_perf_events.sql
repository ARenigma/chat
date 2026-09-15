-- ---------------------------------------------------------------------------
-- Migration 108: telemetry allowlist — media failures and the perf events.
--
-- Two gaps closed so real-device bugs land in the queryable `events` table:
--
--   * 'call_media_failed' — the media layer failing after the channel opened
--     (Agora onError / connState 'failed') is the "no audio / won't connect"
--     class, and until now NOTHING recorded it: the call_ended cleanup only
--     fires from the 'active' phase, so a pre-connected media failure produced
--     no signal anywhere in `events`. CallScreen now tracks it.
--
--   * 'screen_opened', 'sheet_closed', 'query_slow', 'frame_jank' — already
--     emitted client-side by perfTelemetry.ts (wired in App.tsx) and already in
--     the TypeScript TelemetryEvent union, but MISSING from this DB allowlist, so
--     every one was raised as 22023 and silently swallowed by record()'s
--     try/catch. Adding them makes frame jank and slow queries queryable.
--
-- guard_event_shape is reproduced in full per the convention (migrations 032/039):
-- a reader of this file gets the complete allowlist, not a diff.
-- ---------------------------------------------------------------------------

create or replace function public.guard_event_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text;
begin
  if new.name not in (
    -- 006 originals
    'app_open', 'directory_viewed', 'conversation_opened', 'message_sent',
    'send_rejected', 'refill_opened', 'refill_claimed', 'report_submitted',
    'user_blocked', 'user_unblocked', 'account_deleted', 'identity_linked',
    'signed_in', 'application_submitted', 'availability_changed',
    'review_submitted',
    -- 011 additions
    'reaction_added', 'reaction_removed', 'reply_sent',
    'voice_note_sent', 'voice_note_played',
    'call_started', 'call_answered', 'call_declined', 'call_ended',
    'call_rejected', 'presence_changed',
    -- 032 additions (policy gate + paid sessions)
    'policy_accepted', 'session_requested', 'session_ended',
    -- 033 additions (UCB / Cashfree billing)
    'recharge_sheet_opened',
    -- 039 additions (Cashfree WebCheckout sandbox, ADR-0022)
    'cashfree_checkout_verify', 'cashfree_checkout_error',
    -- 108 additions: call media failure + the perf events (already emitted by
    -- perfTelemetry.ts and in the TS union; were being rejected here)
    'call_media_failed',
    'screen_opened', 'sheet_closed', 'query_slow', 'frame_jank'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'prop key "%" looks like PII or message content', v_key
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.guard_event_shape() is
  'Allowlist guard for telemetry event names and prop keys. (migrations 006, 011, 032, 033, 039, 108)';
