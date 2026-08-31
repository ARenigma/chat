-- ---------------------------------------------------------------------------
-- Migration 039: extend telemetry allowlist with Cashfree WebCheckout events.
--
-- Adds 'cashfree_checkout_verify' and 'cashfree_checkout_error' so the client
-- can record Cashfree SDK callback outcomes for conversion analytics.
--
-- The guard_event_shape trigger is reproduced in full per the convention in
-- migration 032: readers of this file get the complete allowlist, not a diff.
-- ADR-0022
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
    'cashfree_checkout_verify', 'cashfree_checkout_error'
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
  'Allowlist guard for telemetry event names and prop keys. (migrations 006, 011, 032, 033, 039)';
