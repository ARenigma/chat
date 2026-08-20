-- 001_initial_schema.sql
-- Core schema, row level security, and the atomic wallet primitives.

-- Profiles table
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text default 'Friend',
  token_balance integer default 50 not null check (token_balance >= 0),
  created_at timestamptz default now() not null
);

-- Chat sessions
create table public.chats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  persona_id text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Messages
create table public.messages (
  id uuid default gen_random_uuid() primary key,
  chat_id uuid references public.chats(id) on delete cascade not null,
  sender text check (sender in ('user', 'assistant')) not null,
  content text not null,
  created_at timestamptz default now() not null
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;

create policy "User owns profile" on public.profiles for all using (auth.uid() = id);
create policy "User owns chats" on public.chats for all using (auth.uid() = user_id);
create policy "User owns messages" on public.messages for all
  using (exists (select 1 from public.chats where id = messages.chat_id and user_id = auth.uid()));

-- Atomic Token Deduction Function
-- Server-only: `002` revokes execute from anon/authenticated. It takes an
-- arbitrary p_user_id and an arbitrary p_cost, so it must never be reachable
-- from a client JWT.
create or replace function public.deduct_user_token(p_user_id uuid, p_cost integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
begin
  select token_balance into v_current
  from public.profiles
  where id = p_user_id
  for update;

  if v_current is null or v_current < p_cost then
    return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  update public.profiles
  set token_balance = token_balance - p_cost
  where id = p_user_id;

  return json_build_object('success', true, 'new_balance', v_current - p_cost);
end;
$$;

-- Complete Account Deletion Function
-- One statement, one transaction: the auth.users row cascades to profiles,
-- which cascades to chats, which cascades to messages.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;
