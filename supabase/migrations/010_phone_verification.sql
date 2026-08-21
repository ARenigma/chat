-- ---------------------------------------------------------------------------
-- 010 — phone verification, on top of Google rather than instead of it
-- ---------------------------------------------------------------------------
-- ADR-0009 revised: MSG91's no-DLT default template is only available through
-- the OTP widget, and the widget generates and verifies its own code — so it can
-- never deliver a code Supabase issued. Rather than take Supabase Auth out of the
-- login path (which would mean minting sessions ourselves and putting every RLS
-- policy behind our own signing), phone becomes a *verification attached to an
-- existing account*.
--
-- Google remains the only way to get a session. This records that the person
-- holding that session also demonstrated control of a phone number, which is the
-- accountability ADR-0006 actually wanted: a number costs money to replace and a
-- Google account does not.
--
-- The number is stored, not just a flag, for one reason: re-registration. If a
-- banned account's number can be recognised, a ban means something. A boolean
-- would let the same person return with the same SIM.

alter table public.profiles
  add column if not exists phone_e164 text,
  add column if not exists phone_verified_at timestamptz;

comment on column public.profiles.phone_e164 is
  'E.164 with the leading +. Written only by verify_phone(), never by a client, '
  'and never exposed to another user — the directory view does not select it.';
comment on column public.profiles.phone_verified_at is
  'When MSG91 confirmed control of phone_e164. Null means unverified.';

-- One account per number. Without this, one phone could vouch for any number of
-- accounts and the accountability is decorative.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone_e164)
  where phone_e164 is not null;

-- ---------------------------------------------------------------------------
-- The write path
-- ---------------------------------------------------------------------------
-- A function rather than an UPDATE policy, and service_role only, because the
-- claim being recorded is "MSG91 says this person controls this number". A client
-- must not be able to assert that about itself — with a policy, the client would
-- still be *sending* the phone number, which is the one field that cannot be
-- client-supplied when it is also the thing being proven.
create or replace function public.verify_phone(
  p_user_id uuid,
  p_phone_e164 text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  -- E.164: a leading + and 8 to 15 digits. Rejecting here as well as in the Edge
  -- Function is deliberate — this is the last line before it becomes a unique
  -- identity, and the format is what the uniqueness index depends on.
  if p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'not an e164 number' using errcode = '22023';
  end if;

  -- Claimed by someone else already: refuse rather than steal it. A SIM that
  -- moves to a new owner is a support case, not something to resolve silently in
  -- favour of whoever verified most recently — that would be the reassignment
  -- path a banned user would look for.
  if exists (
    select 1 from public.profiles
    where phone_e164 = p_phone_e164 and id <> p_user_id
  ) then
    raise exception 'PHONE_ALREADY_VERIFIED' using errcode = '23505';
  end if;

  update public.profiles
  set phone_e164 = p_phone_e164,
      phone_verified_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'no such profile' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.verify_phone(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_phone(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- What a client may read about itself
-- ---------------------------------------------------------------------------
-- The app needs to know whether to show the "verify your number" prompt, and it
-- must not need the number to answer that. A view of the caller's own row keeps
-- the number out of the client entirely.
create or replace view public.my_verification
with (security_invoker = true) as
  select
    id,
    phone_verified_at is not null as phone_verified,
    phone_verified_at
  from public.profiles
  where id = auth.uid();

revoke all on public.my_verification from anon;
grant select on public.my_verification to authenticated;

comment on view public.my_verification is
  'Whether the caller has a verified phone. Deliberately omits phone_e164: the '
  'client already knows the number it just verified and never needs it back.';

-- ---------------------------------------------------------------------------
-- The guard from 003 has to learn about the two new columns
-- ---------------------------------------------------------------------------
-- Without this a client could UPDATE its own profile row and set
-- phone_verified_at directly, which would make the entire verification
-- decorative — the point is that only MSG91's confirmation can set it.
--
-- A SEPARATE trigger, not an extension of guard_privileged_profile_columns, and
-- the reason is a mistake this migration made first.
--
-- That function has been redefined three times — 003 guarded role,
-- identity_verified_at and token_balance; 005 added suspended_until; 006 added
-- date_of_birth, rating_avg, rating_count and median_reply_seconds. Reproducing
-- "the original" from 003 and adding two columns silently dropped the five that
-- 005 and 006 had added, which is a `create or replace` deleting security
-- controls with no diff to show for it. The pgTAP suite caught it — three
-- assertions about suspensions, ratings and birth dates failed immediately.
--
-- So this stops touching that function at all. Postgres runs BEFORE UPDATE
-- triggers in name order and each can raise independently, so an additive guard
-- composes cleanly and cannot regress the existing one. The next person to guard
-- a column should add another of these rather than grow a list they have to
-- reconstruct.
create or replace function public.guard_phone_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SECURITY INVOKER (the default), which is the subtle part: `current_user`
  -- has to be the caller for this branch to be reached at all. 003 records that
  -- the sibling guard was once SECURITY DEFINER, and that silently disabled
  -- every check inside it.
  if current_user in ('authenticated', 'anon') then
    if new.phone_e164 is distinct from old.phone_e164 then
      raise exception 'profiles.phone_e164 is not client-writable'
        using errcode = '42501';
    end if;
    if new.phone_verified_at is distinct from old.phone_verified_at then
      raise exception 'profiles.phone_verified_at is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_phone_columns on public.profiles;
create trigger guard_profile_phone_columns
  before update on public.profiles
  for each row execute function public.guard_phone_columns();
