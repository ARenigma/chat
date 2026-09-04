-- 055  Keep profiles.phone_e164 in step with auth.users.phone
--
-- WHY THIS EXISTS
--
-- `profiles.phone_e164` has existed since the phone-auth work and was NULL on
-- EVERY row in the table (checked against production, 2026-09-04) — including
-- the seeded providers. Nothing ever wrote it.
--
-- That went unnoticed because `cashfree-onboarding-start` reads the column and
-- then falls back to `auth.users.phone`, so the flow appeared to work for anyone
-- who signed up by phone. The column was dead weight pretending to be a mirror,
-- and every reader of it was silently getting NULL and relying on a fallback
-- that only the Edge Function has — a client-side reader cannot see
-- `auth.users`, so any UI that wanted the number got nothing.
--
-- The fix is the one the codebase already uses for this shape: a trigger on
-- `auth.users`, exactly like `handle_new_user` in migration 002.

-- ---------------------------------------------------------------------------
-- The mirror
-- ---------------------------------------------------------------------------
create or replace function public.mirror_user_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- E.164 with the leading '+', which is the shape the rest of the app assumes
  -- (`toTenDigits` in the Cashfree functions strips non-digits either way, but a
  -- half-normalised column is how two callers end up disagreeing).
  update public.profiles
  set phone_e164 = case
        when new.phone is null or btrim(new.phone) = '' then null
        when left(btrim(new.phone), 1) = '+' then btrim(new.phone)
        else '+' || btrim(new.phone)
      end
  where id = new.id;
  return new;
end;
$$;

-- INSERT as well as UPDATE. A phone signup writes the number on the insert, so
-- an update-only trigger would miss every new provider — which is precisely the
-- population this column exists for.
drop trigger if exists on_auth_user_phone_changed on auth.users;
create trigger on_auth_user_phone_changed
  after insert or update of phone on auth.users
  for each row execute function public.mirror_user_phone();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every row that already had a number keeps it; rows with none stay NULL rather
-- than being given a placeholder, because "no phone" is a real and valid state
-- for an email or Google signup and inventing one would break the Cashfree
-- precondition in the worst possible way — silently, at verification time.
update public.profiles p
set phone_e164 = case
      when u.phone is null or btrim(u.phone) = '' then null
      when left(btrim(u.phone), 1) = '+' then btrim(u.phone)
      else '+' || btrim(u.phone)
    end
from auth.users u
where u.id = p.id
  and p.phone_e164 is distinct from case
      when u.phone is null or btrim(u.phone) = '' then null
      when left(btrim(u.phone), 1) = '+' then btrim(u.phone)
      else '+' || btrim(u.phone)
    end;

comment on column public.profiles.phone_e164 is
  'Mirror of auth.users.phone in E.164, maintained by the on_auth_user_phone_changed '
  'trigger (migration 055). NULL is valid and means this account has no phone — an '
  'email or Google signup. Provider onboarding requires one because Cashfree 1-Click '
  'fetches identity BY mobile number.';
