-- 004_message_guard_and_directory.sql
--
-- Three corrections to 003, all found while wiring the Realtime client against
-- it. Each one was reachable from an ordinary authenticated session.
--
-- ---------------------------------------------------------------------------
-- 1. A recipient could rewrite the message sent to them.
-- ---------------------------------------------------------------------------
-- 003 gave the recipient an UPDATE policy so read receipts could be written:
--
--   using       (sender_id <> auth.uid() and <is a participant>)
--   with check  (sender_id <> auth.uid())
--
-- The intent was "may set read_at". What it actually says is "may update this
-- row", and `body` is a column on that row. So the recipient of a message could
-- rewrite its text — and because `replica identity full` is on, ship the edit to
-- the other participant over Realtime as an authentic-looking row. In a product
-- whose whole safety story rests on "we can prove who said what", a recipient
-- being able to edit the other side's words destroys every transcript as
-- evidence, which is exactly what a moderation or abuse report depends on.
--
-- A column-scoped grant is not sufficient on its own here (the policy is what
-- authorises the row, and PostgreSQL checks column privileges separately from
-- RLS), so the invariant is stated as a trigger where it can be exact.
create or replace function public.guard_message_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SECURITY INVOKER, as with the profiles guard: under SECURITY DEFINER
  -- `current_user` would be the function owner, the branch would never be taken
  -- for a client session, and the guard would silently pass everything.
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
      or new.conversation_id is distinct from old.conversation_id
      or new.sender_id is distinct from old.sender_id
      or new.body is distinct from old.body
      or new.created_at is distinct from old.created_at then
      raise exception 'only messages.read_at is client-writable'
        using errcode = '42501';
    end if;

    -- A receipt is a one-way latch. Allowing it back to null would let a reader
    -- deny having read something the sender was already told they had read.
    if old.read_at is not null and new.read_at is distinct from old.read_at then
      raise exception 'messages.read_at cannot be changed once set'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_message_columns on public.messages;
create trigger guard_message_columns
  before update on public.messages
  for each row execute function public.guard_message_columns();

-- ---------------------------------------------------------------------------
-- 2. The provider directory leaked every provider's wallet.
-- ---------------------------------------------------------------------------
-- 003 added a second SELECT policy on `profiles` so members could discover
-- providers. RLS policies for the same command are OR'd together, so that
-- policy did not merely feed the view — it widened `profiles` itself. Any
-- authenticated member could run
--
--   select id, token_balance, identity_verified_at from profiles
--   where role = 'provider';
--
-- and read every provider's balance and verification timestamp. The
-- `provider_directory` view was written with an explicit column list precisely
-- to stop that, but with `security_invoker = true` the view ran as the caller
-- and therefore *needed* the permissive policy to return anything.
--
-- The fix inverts it: the view becomes the privileged boundary (definer), and
-- the policy on the base table goes away. The explicit column list is then
-- load-bearing rather than decorative, which is what the 003 comment claimed.
drop policy if exists "Providers are discoverable" on public.profiles;

drop view if exists public.provider_directory;

create view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.is_available,
    p.created_at
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null;

comment on view public.provider_directory is
  'The only member-facing projection of a provider. Runs as owner and therefore '
  'bypasses RLS on profiles by design: the column list here IS the privacy '
  'boundary. Never add a column without deciding it is public to every member.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 3. An admitted provider could have no name.
-- ---------------------------------------------------------------------------
-- `display_name` is nullable because members do not need one. A provider in the
-- directory without one renders as a blank row the member cannot identify, and
-- the client had to paper over it with a placeholder. Stated as a CHECK so it is
-- true of every row rather than only of rows that went through the approval
-- function.
alter table public.profiles
  drop constraint if exists provider_has_display_name;

alter table public.profiles
  add constraint provider_has_display_name
  check (role <> 'provider' or btrim(coalesce(display_name, '')) <> '');

-- Approval now fails loudly rather than tripping the constraint with a message
-- an operator cannot act on.
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
  -- Preconditions before writes, and in this order deliberately: "never applied"
  -- is the more fundamental objection and the more actionable message, so it must
  -- not be masked by the name check below.
  if not exists (
    select 1 from public.provider_applications where user_id = p_user_id
  ) then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_user_id and btrim(coalesce(display_name, '')) <> ''
  ) then
    raise exception 'applicant % has no display_name; cannot be admitted', p_user_id
      using errcode = '22023';
  end if;

  update public.provider_applications
  set status = 'approved', reviewed_at = now(), reviewer_note = p_note
  where user_id = p_user_id;

  update public.profiles
  set role = 'provider',
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = p_user_id;
end;
$$;

revoke all on function public.approve_provider_application(uuid, text) from public;
grant execute on function public.approve_provider_application(uuid, text) to service_role;
