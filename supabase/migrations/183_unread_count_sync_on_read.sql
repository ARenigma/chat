-- 183_unread_count_sync_on_read.sql
--
-- Bug: conversation_thread_meta.unread_count_member (and _provider) is
-- incremented by send_message (public.send_message, migration 077) each time
-- the peer sends a message, but it is NEVER decremented when the recipient
-- marks messages read — because the client writes read_at via a direct UPDATE
-- on the messages table and no trigger existed to propagate that change to the
-- counter.
--
-- Result: any message sent outside an active session (session_id null) whose
-- read_at is subsequently set by the client leaves the counter stuck at ≥ 1,
-- showing a permanent unread badge. The same defect affects in-session reads
-- whenever the member reads without replying (the counter only reset to 0
-- when the member sent their next message via send_message, which set
-- unread_count_member = 0 as a side-effect of the sender being the member).
--
-- Fix: an AFTER UPDATE trigger on messages recomputes both counters from the
-- true message state whenever read_at transitions NULL → non-NULL for a row.
-- It uses SECURITY DEFINER because conversation_thread_meta grants only
-- SELECT to authenticated; all writes go through definer-owned code.
--
-- Backfill: a single UPDATE at the end repairs the 8 threads currently drifted
-- in production (verified 2026-10-03 via SELECT-only linked query).

-- ── Trigger function ──────────────────────────────────────────────────────────
create or replace function public.sync_unread_on_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id   uuid;
  v_provider_id uuid;
begin
  -- Guard: only act when read_at transitions NULL → non-NULL.
  -- Covers both single-row and batched client UPDATEs; each row fires once.
  if old.read_at is not null or new.read_at is null then
    return new;
  end if;

  -- Resolve conversation participants. An orphaned message (no matching
  -- conversation row) is a data-integrity problem we do not mask — just skip.
  select member_id, provider_id
  into   v_member_id, v_provider_id
  from   public.conversations
  where  id = new.conversation_id;

  if not found then
    return new;
  end if;

  -- Recompute both sides from the live message rows.
  --
  -- hidden_at IS NULL: messages hidden by session purge are gone from both
  --   participants' view and must not inflate the counter.
  -- deleted_at: a deleted message stays visible as a tombstone (both sides
  --   see it), so the read-receipt slot is still meaningful; we count it.
  -- Only messages FROM the peer are unread FROM the viewer's perspective.
  update public.conversation_thread_meta
  set
    unread_count_member = (
      select count(*)
      from   public.messages m
      where  m.conversation_id = new.conversation_id
        and  m.sender_id       = v_provider_id
        and  m.read_at         is null
        and  m.hidden_at       is null
    ),
    unread_count_provider = (
      select count(*)
      from   public.messages m
      where  m.conversation_id = new.conversation_id
        and  m.sender_id       = v_member_id
        and  m.read_at         is null
        and  m.hidden_at       is null
    )
  where conversation_id = new.conversation_id;

  return new;
end;
$$;

comment on function public.sync_unread_on_read() is
  'AFTER UPDATE trigger on messages: recomputes conversation_thread_meta '
  'unread counters whenever a message transitions read_at NULL → non-NULL. '
  'SECURITY DEFINER because conversation_thread_meta grants only SELECT to '
  'authenticated; all writes go through definer-owned code.';

-- New functions start closed (default grants exposed money RPCs once). A
-- trigger function is never called directly; the trigger still fires.
revoke all on function public.sync_unread_on_read() from public, anon, authenticated;

-- ── Attach trigger ────────────────────────────────────────────────────────────
-- OF read_at: fires only when that column is included in the SET clause,
-- avoiding unnecessary overhead from unrelated message updates.
drop trigger if exists sync_unread_count_on_read on public.messages;
create trigger sync_unread_count_on_read
  after update of read_at on public.messages
  for each row
  execute function public.sync_unread_on_read();

-- ── Backfill: repair existing drift ──────────────────────────────────────────
-- Recomputes every thread unconditionally; the predicate `where stored != real`
-- would read messages twice; this single pass is cheaper for the row count we
-- have.
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
where c.id = tm.conversation_id;
