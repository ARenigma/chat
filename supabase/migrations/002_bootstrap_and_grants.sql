-- 002_bootstrap_and_grants.sql
--
-- Everything 001 needs to actually work in production:
--   1. a profile row for every new (including anonymous) user
--   2. least-privilege EXECUTE grants on the wallet primitives
--   3. the two client-callable RPCs (open a chat, claim a refill)
--   4. the indexes the two hot queries depend on
--
-- SECURITY (why part 2 is not optional): `deduct_user_token(p_user_id, p_cost)`
-- is SECURITY DEFINER and Postgres grants EXECUTE to PUBLIC by default. Left as
-- is, any signed-in client could call it with another user's id, or with a
-- negative p_cost, `50 - (-100) = 150`, and mint tokens for free. The revokes
-- below are the fix; only service_role (the Edge Function) may move the wallet.

-- ---------------------------------------------------------------------------
-- 1. Profile bootstrap
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists last_refill_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Wallet primitives: least privilege
-- ---------------------------------------------------------------------------

-- Refund path for a generation that failed after the debit landed.
create or replace function public.credit_user_token(p_user_id uuid, p_amount integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
begin
  if p_amount is null or p_amount <= 0 then
    return json_build_object('success', false, 'error', 'INVALID_AMOUNT');
  end if;

  update public.profiles
  set token_balance = token_balance + p_amount
  where id = p_user_id
  returning token_balance into v_new;

  if v_new is null then
    return json_build_object('success', false, 'error', 'NO_PROFILE');
  end if;

  return json_build_object('success', true, 'new_balance', v_new);
end;
$$;

revoke all on function public.deduct_user_token(uuid, integer) from public;
revoke all on function public.credit_user_token(uuid, integer) from public;
grant execute on function public.deduct_user_token(uuid, integer) to service_role;
grant execute on function public.credit_user_token(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Client-callable RPCs
-- ---------------------------------------------------------------------------

-- One round trip instead of select-then-insert, and no duplicate-chat race.
create or replace function public.get_or_create_chat(p_persona_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_chat uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select id into v_chat
  from public.chats
  where user_id = v_uid and persona_id = p_persona_id
  order by updated_at desc
  limit 1;

  if v_chat is null then
    insert into public.chats (user_id, persona_id)
    values (v_uid, p_persona_id)
    returning id into v_chat;
  end if;

  return v_chat;
end;
$$;

-- The refill trigger behind the low-balance sheet. Idempotent per 24h window.
-- Keep the grant amount in sync with DAILY_REFILL_TOKENS in
-- supabase/functions/_shared/ledger.ts (asserted by the parity test).
create or replace function public.claim_daily_tokens()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_last timestamptz;
  v_new integer;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select last_refill_at into v_last
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'NO_PROFILE');
  end if;

  if v_last is not null and v_last > now() - interval '24 hours' then
    return json_build_object(
      'success', false,
      'error', 'TOO_SOON',
      'retry_after', v_last + interval '24 hours'
    );
  end if;

  update public.profiles
  set token_balance = token_balance + 25,
      last_refill_at = now()
  where id = v_uid
  returning token_balance into v_new;

  return json_build_object('success', true, 'new_balance', v_new);
end;
$$;

revoke all on function public.get_or_create_chat(text) from public;
revoke all on function public.claim_daily_tokens() from public;
revoke all on function public.delete_user_account() from public;
grant execute on function public.get_or_create_chat(text) to authenticated;
grant execute on function public.claim_daily_tokens() to authenticated;
grant execute on function public.delete_user_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Freshness + indexes
-- ---------------------------------------------------------------------------

create or replace function public.touch_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists on_message_inserted on public.messages;
create trigger on_message_inserted
  after insert on public.messages
  for each row execute function public.touch_chat();

-- Transcript pagination (inverted list reads newest-first).
create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at desc);

-- get_or_create_chat lookup.
create index if not exists chats_user_persona_idx
  on public.chats (user_id, persona_id, updated_at desc);
