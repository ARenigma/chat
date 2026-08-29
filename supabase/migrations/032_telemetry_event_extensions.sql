-- ===========================================================================
-- 032  Telemetry event allowlist extension
-- ===========================================================================
-- Adds three new event names to the guard_event_shape trigger:
--   • policy_accepted   — user accepted one or more policy versions (027)
--   • session_requested — member or provider initiated a paid session (030)
--   • session_ended     — a paid session ended for any reason (030)
--
-- Rule carried forward from 011 (section header comment there):
--   A new guarded column means a NEW guard trigger, never an edit to an
--   existing one. Redefining guard_event_shape from 011 silently deletes
--   nothing because CREATE OR REPLACE preserves the trigger binding, but
--   the full name list must still be reproduced here so a reader of this
--   file alone gets the complete picture.
--
-- All 26 names from 011 are reproduced verbatim below, plus the three new
-- ones. The allowlist pattern (case-sensitive `in` check) is unchanged.

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
    'policy_accepted', 'session_requested', 'session_ended'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'event props may not carry "%"', v_key using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;
