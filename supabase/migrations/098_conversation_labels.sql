-- 098_conversation_labels.sql
--
-- A private, per-user custom name for a conversation ("rename chat"). A provider
-- organising many member threads — or a member — can label a conversation, and
-- that label is visible ONLY to the person who set it. It overrides the peer's
-- display name in that person's own inbox and chat header; the other party never
-- sees it.
--
-- Deliberately a separate table rather than a column on conversations (which
-- would be shared) or a change to the conversation_summaries view (recreated
-- eight times already and fragile). The client fetches its own labels and
-- COALESCEs them over peer_display_name, so this view is left untouched.

create table if not exists public.conversation_labels (
  user_id         uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  custom_name     text not null check (char_length(btrim(custom_name)) between 1 and 40),
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

alter table public.conversation_labels enable row level security;

-- A user reads only their own labels. There is deliberately NO insert/update/
-- delete policy: writes go through set_conversation_name, which also enforces
-- that the caller is a participant of the conversation.
create policy "Owner reads own conversation labels"
  on public.conversation_labels for select
  using (auth.uid() = user_id);

comment on table public.conversation_labels is
  'Private per-user custom name for a conversation. Visible only to user_id; '
  'overrides peer_display_name in that user''s own inbox and chat header.';

-- Set, change, or clear a conversation's private label. A blank/whitespace name
-- clears it. SECURITY DEFINER so it can write the RLS-guarded table after
-- checking participation; the label is always the CALLER's (auth.uid()).
create or replace function public.set_conversation_name(
  p_conversation_id uuid,
  p_name            text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  -- Only a participant of the conversation may label it.
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.member_id = v_uid or c.provider_id = v_uid)
  ) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  -- Blank clears the label (revert to the peer's display name).
  if v_name is null then
    delete from public.conversation_labels
    where user_id = v_uid and conversation_id = p_conversation_id;
    return;
  end if;

  -- The column CHECK caps length at 40; trim defensively so the RPC never
  -- raises a constraint error on a caller who sent something longer.
  if char_length(v_name) > 40 then
    v_name := left(v_name, 40);
  end if;

  insert into public.conversation_labels (user_id, conversation_id, custom_name)
  values (v_uid, p_conversation_id, v_name)
  on conflict (user_id, conversation_id)
  do update set custom_name = excluded.custom_name, updated_at = now();
end;
$$;

revoke all on function public.set_conversation_name(uuid, text) from public, anon;
grant execute on function public.set_conversation_name(uuid, text) to authenticated;
