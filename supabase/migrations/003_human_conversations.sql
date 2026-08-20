-- 003_human_conversations.sql
--
-- ADR-0001: the chat is between two real people, not a person and a model.
-- ADR-0002: one app, two roles, the role held server-side.
--
-- This replaces the persona chat model. It is DESTRUCTIVE and only safe because
-- the product has no users yet: `chats` and `messages` are dropped and rebuilt
-- around two participants. Post-launch this would have to be a backfill.
--
-- The important structural change is that `messages` no longer has a `sender`
-- string. It has a `sender_id` pointing at a real profile, which is what makes
-- authorship provable and makes moderation possible at all.

-- ---------------------------------------------------------------------------
-- 1. Roles. A member never becomes a provider by editing a client flag.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('member', 'provider');
  end if;
end
$$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'member',
  add column if not exists display_name text,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists is_available boolean not null default false;

comment on column public.profiles.role is
  'Set only by approve_provider_application. The client cannot write it: the '
  'RLS policy below forbids a self-update that changes it, so the provider '
  'surface is unreachable without server-side admission.';

comment on column public.profiles.identity_verified_at is
  'Non-null implies a completed age and identity check. A provider row without '
  'this is a bug — see the constraint trigger below.';

-- A member may edit their own profile, but not promote themselves.
drop policy if exists "User owns profile" on public.profiles;

create policy "Profile readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Profile insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Profile updatable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column immutability is a trigger, not a policy.
--
-- The obvious approach — comparing NEW against a subquery on profiles inside the
-- policy's WITH CHECK — does not work: that subquery is itself subject to this
-- table's RLS, so it resolves to NULL, the check is never TRUE, and every update
-- is rejected including harmless ones. A BEFORE UPDATE trigger sees OLD directly
-- and has no such problem.
--
-- The role test is `current_user`, which is the client role for a normal session
-- but the function owner inside a SECURITY DEFINER function — so
-- approve_provider_application and send_message pass through, and nothing a
-- client can call does.
-- Deliberately SECURITY INVOKER (the default). A SECURITY DEFINER trigger sees
-- `current_user` as its own owner, so the guard would never recognise a client
-- session and would silently permit self-promotion — which is exactly what it
-- did before this was corrected.
create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'profiles.role is not client-writable' using errcode = '42501';
    end if;
    if new.identity_verified_at is distinct from old.identity_verified_at then
      raise exception 'profiles.identity_verified_at is not client-writable'
        using errcode = '42501';
    end if;
    if new.token_balance is distinct from old.token_balance then
      raise exception 'profiles.token_balance is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_privileged_profile_columns();

create policy "Profile deletable by owner"
  on public.profiles for delete
  using (auth.uid() = id);

-- Members need to discover providers, which the owner-only policy above forbids.
-- Exposed as a view with an explicit column list rather than by loosening RLS,
-- so a future column cannot leak by default.
create or replace view public.provider_directory
with (security_invoker = true) as
  select
    p.id,
    p.display_name,
    p.is_available,
    p.created_at
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null;

create policy "Providers are discoverable"
  on public.profiles for select
  using (role = 'provider' and identity_verified_at is not null);

-- ---------------------------------------------------------------------------
-- 2. Admission. Becoming a provider is a reviewed event with an audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_note text,
  unique (user_id)
);

alter table public.provider_applications enable row level security;

create policy "Applicant reads own application"
  on public.provider_applications for select
  using (auth.uid() = user_id);

create policy "Applicant submits own application"
  on public.provider_applications for insert
  with check (auth.uid() = user_id and status = 'pending');

-- Approval is deliberately not exposed to any client role. It runs from the ops
-- surface with the service role, which is the only path that can set a role.
create or replace function public.approve_provider_application(
  p_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_applications
  set status = 'approved', reviewed_at = now(), reviewer_note = p_note
  where user_id = p_user_id;

  if not found then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;

  update public.profiles
  set role = 'provider',
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = p_user_id;
end;
$$;

revoke all on function public.approve_provider_application(uuid, text) from public;
grant execute on function public.approve_provider_application(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Conversations. Exactly two participants, one of each role.
-- ---------------------------------------------------------------------------
drop table if exists public.messages;
drop table if exists public.chats;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint participants_distinct check (member_id <> provider_id),
  -- One thread per pair. Prevents duplicate-conversation races entirely.
  unique (member_id, provider_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Either participant, and nobody else. This is what stops one member reading
-- another member's conversation with the same provider.
create policy "Participants read their conversation"
  on public.conversations for select
  using (auth.uid() = member_id or auth.uid() = provider_id);

create policy "Participants read messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

-- Reading a message is the only field a recipient may write, and only on
-- messages they did not send.
create policy "Recipient marks messages read"
  on public.messages for update
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());

-- No direct INSERT policy on messages: sending goes through send_message so the
-- debit and the insert cannot come apart.

-- ---------------------------------------------------------------------------
-- 4. The send path. One transaction, no service role, no second network hop.
-- ---------------------------------------------------------------------------
-- With no model to stream from, the Edge Function's two-step "debit then insert"
-- is both unnecessary and weaker: this is a single atomic statement pair inside
-- one transaction, so a failure cannot leave a debit without a message.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_balance integer;
  v_message public.messages;
  v_trimmed text := btrim(p_body);
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;
  if v_trimmed = '' or length(v_trimmed) > 4000 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations
  where id = p_conversation_id;

  if v_member is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  -- Only the member pays. A provider replying costs nothing.
  if v_uid = v_member then
    select token_balance into v_balance
    from public.profiles where id = v_uid
    for update;

    if v_balance is null or v_balance < 1 then
      return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    end if;

    update public.profiles
    set token_balance = token_balance - 1
    where id = v_uid;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_uid, v_trimmed)
  returning * into v_message;

  update public.conversations
  set last_message_at = v_message.created_at
  where id = p_conversation_id;

  return json_build_object(
    'success', true,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'new_balance', case when v_uid = v_member then v_balance - 1 else null end
  );
end;
$$;

revoke all on function public.send_message(uuid, text) from public;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Opening a thread with a provider. Idempotent per pair.
create or replace function public.open_conversation(p_provider_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if v_uid = p_provider_id then
    raise exception 'cannot open a conversation with yourself' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_provider_id
      and role = 'provider'
      and identity_verified_at is not null
  ) then
    raise exception 'not an admitted provider' using errcode = '22023';
  end if;

  insert into public.conversations (member_id, provider_id)
  values (v_uid, p_provider_id)
  on conflict (member_id, provider_id) do nothing;

  select id into v_id from public.conversations
  where member_id = v_uid and provider_id = p_provider_id;

  return v_id;
end;
$$;

revoke all on function public.open_conversation(uuid) from public;
grant execute on function public.open_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime + indexes
-- ---------------------------------------------------------------------------
-- Realtime respects RLS, so a client only receives rows it could have selected.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

-- Needed for the changed-row payload to include enough to render a message.
alter table public.messages replica identity full;

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists conversations_member_idx
  on public.conversations (member_id, last_message_at desc);
create index if not exists conversations_provider_idx
  on public.conversations (provider_id, last_message_at desc);
create index if not exists profiles_directory_idx
  on public.profiles (role, is_available)
  where role = 'provider';

-- The persona-era chat helper is meaningless now.
drop function if exists public.get_or_create_chat(text);
