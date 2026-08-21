-- ---------------------------------------------------------------------------
-- 008 — push tokens
-- ---------------------------------------------------------------------------
-- The one thing a chat SDK would have given us that we did not have: a message
-- sent to a sleeping app currently arrives nowhere. Realtime only delivers to a
-- client with a live socket, so the product's core loop — someone replies, you
-- find out — silently does not work once the app is backgrounded.
--
-- A device token is not a secret in the sense a password is, but it *is* a
-- capability: whoever holds it can push a notification onto that lock screen.
-- So it gets the same treatment as everything else here — a client can register
-- and delete its own tokens and cannot read anybody's, and the sender reads them
-- with the service role only.

create table if not exists public.push_tokens (
  -- The token is the identity. The same device re-registering must update rather
  -- than accumulate rows, and FCM reissues tokens on reinstall, so a
  -- (user, device) key would leak a row per reinstall forever.
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'android' check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  -- Refreshed on every app open, so the sender can prune tokens that have not
  -- been seen for months without waiting for FCM to report them unregistered.
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Deliberately no SELECT policy. A member has no reason to read even their own
-- token list — the client already knows its token — and "no policy" is a
-- stronger statement than a policy that happens to match nothing.
create policy "Own tokens are removable" on public.push_tokens
  for delete using (user_id = auth.uid());

comment on table public.push_tokens is
  'FCM registration tokens. No SELECT policy by design: a device knows its own '
  'token and nobody needs to enumerate them. The sender reads with service_role.';

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
-- A function rather than an INSERT policy, because the client must not be able
-- to choose the user_id. With a policy the check would be `user_id = auth.uid()`
-- and the client would still be *sending* a user id, which is a field that
-- should never be client-supplied when it is also the authorisation subject.
create or replace function public.register_push_token(
  p_token text,
  p_platform text default 'android'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_token is null or length(btrim(p_token)) < 32 then
    raise exception 'not a token' using errcode = '22023';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (btrim(p_token), v_uid, p_platform)
  on conflict (token) do update
    -- Reassigning the row on conflict is the important case: a shared or resold
    -- device re-registers the same token under a new account, and leaving it
    -- pointed at the previous user would push somebody else's messages to it.
    set user_id = v_uid,
        platform = p_platform,
        last_seen_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the sender reads
-- ---------------------------------------------------------------------------
-- The column comes first: the view below selects it, and a view cannot be
-- created against a column that does not exist yet. Same ordering trap as the
-- directory/summary views in 006.
alter table public.messages
  add column if not exists notified_at timestamptz;

comment on column public.messages.notified_at is
  'Set by the push sender once a notification has been dispatched. Separate from '
  'read_at so a delivered-but-unread message is not notified twice.';


-- One row per undelivered message with everything a push needs and nothing it
-- does not. In particular it does NOT expose the message body: a notification
-- that quotes the message onto a lock screen is a privacy decision, not a
-- delivery detail, and for this product the answer is no — the whole point is
-- that nobody looking over your shoulder learns what you talked about.
create or replace view public.pending_pushes
with (security_invoker = true) as
  select
    m.id as message_id,
    m.conversation_id,
    t.token,
    t.platform,
    d.display_name as sender_display_name,
    m.created_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  -- The recipient is whichever side did not send it.
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
  left join public.provider_directory d on d.id = m.sender_id
  where m.read_at is null
    and m.notified_at is null
    and m.created_at > now() - interval '24 hours';

revoke all on public.pending_pushes from anon, authenticated;

-- Marking a message notified is the sender''s job and nobody else''s.
create or replace function public.mark_notified(p_message_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with touched as (
    update public.messages
    set notified_at = now()
    where id = any(p_message_ids) and notified_at is null
    returning 1
  )
  select count(*)::int from touched;
$$;

revoke all on function public.mark_notified(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_notified(uuid[]) to service_role;

-- Tokens FCM reports as unregistered, so the sender can stop retrying them.
create or replace function public.forget_push_tokens(p_tokens text[])
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.push_tokens where token = any(p_tokens) returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.forget_push_tokens(text[]) to service_role;
