-- 184_unread_recount_per_statement.sql
--
-- 183's trigger recounts a conversation's unread messages once PER ROW, so
-- one "mark these read" UPDATE of n messages ran 2n full count(*) recounts of
-- the same conversation (pre-push review, 2026-10-03). The client marks the
-- visible batch in one statement, so the same work can be done once per
-- conversation per statement.
--
-- A statement-level trigger with transition tables. A column list
-- (`UPDATE OF read_at`) cannot be combined with transition tables in
-- Postgres, so the trigger fires on every UPDATE of messages and the join on
-- old/new rows keeps only those that changed what counts as unread: read_at
-- going NULL -> set, OR hidden_at going NULL -> set. The second is end_session
-- hiding a session's content (181): an unread message hidden there used to
-- leave the counter above the true, hidden-excluded figure for good, the
-- stuck-badge bug 183 was written for, through a second door. An UPDATE that
-- changes neither recounts nothing.
-- https://www.postgresql.org/docs/current/sql-createtrigger.html

create or replace function public.sync_unread_on_read_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_thread_meta tm
  set
    unread_count_member = (
      select count(*)
      from   public.messages m
      where  m.conversation_id = tm.conversation_id
        and  m.sender_id       = c.provider_id
        and  m.read_at         is null
        and  m.hidden_at       is null
    ),
    unread_count_provider = (
      select count(*)
      from   public.messages m
      where  m.conversation_id = tm.conversation_id
        and  m.sender_id       = c.member_id
        and  m.read_at         is null
        and  m.hidden_at       is null
    )
  from public.conversations c
  where c.id = tm.conversation_id
    and tm.conversation_id in (
      select distinct n.conversation_id
      from   new_rows n
      join   old_rows o on o.id = n.id
      where  (o.read_at is null and n.read_at is not null)
         or  (o.hidden_at is null and n.hidden_at is not null)
    );
  return null;
end;
$$;

comment on function public.sync_unread_on_read_stmt() is
  'Statement-level AFTER UPDATE trigger on messages (184): recounts '
  'conversation_thread_meta unread counters once per conversation whose '
  'messages went read or hidden in the statement. Replaces 183''s per-row '
  'trigger.';

-- New functions start closed; the trigger still fires (privilege on a trigger
-- function is checked at CREATE TRIGGER time, not when it fires).
revoke all on function public.sync_unread_on_read_stmt() from public, anon, authenticated;

drop trigger if exists sync_unread_count_on_read on public.messages;
drop function if exists public.sync_unread_on_read();

create trigger sync_unread_count_on_read
  after update on public.messages
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.sync_unread_on_read_stmt();
