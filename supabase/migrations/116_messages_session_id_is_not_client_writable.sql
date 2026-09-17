-- `messages.session_id` was client-writable. Telegram-CTO audit, 2026-09-17,
-- confirmed HIGH.
--
-- The recipient's own UPDATE policy ("Recipient marks messages read", 045)
-- is a ROW-level check -- not the sender, in a conversation they belong to --
-- with no column restriction at all. Column-level restriction on `messages`
-- has always been the guard triggers' job, not RLS's (004's own comment:
-- "PostgreSQL checks column privileges separately from RLS, so the invariant
-- is stated as a trigger where it can be exact"). Five guards have
-- accumulated since (004, 011/014/023's guard_message_reply_and_voice, 045's
-- guard_message_retention_columns, 103's guard_message_edit_columns), each
-- ADDED rather than editing an earlier one -- the file's own convention
-- (012:35-41) -- and `session_id` was never named by any of them.
--
-- What that means in practice: ADR-0020 sells ephemeral bilateral paid
-- sessions, and `end_session`'s hiding sweep marks a session's messages
-- `hidden_at` by matching `session_id`. A member could set their own
-- message's `session_id` to null or to an unrelated session's id and it
-- would survive a sweep meant to hide it -- keeping a provider's words
-- visible and live on the server past the point the product promises they
-- are gone. Migration 030:256-258 calls this boundary "architectural, not a
-- UI choice the next engineer could accidentally revert"; this is that
-- boundary having a hole in it.
--
-- `client_nonce` (081) and `notified_at` (008) are the other two columns no
-- guard names, closed in the same trigger since all three share the same
-- shape: server-assigned bookkeeping a recipient's UPDATE policy currently
-- has no reason to ever touch.
create or replace function public.guard_message_session_and_dedup_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.session_id is distinct from old.session_id
      or new.client_nonce is distinct from old.client_nonce
      or new.notified_at is distinct from old.notified_at then
      raise exception
        'messages.session_id/client_nonce/notified_at are not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_message_session_and_dedup_columns on public.messages;
create trigger guard_message_session_and_dedup_columns
  before update on public.messages
  for each row execute function public.guard_message_session_and_dedup_columns();
