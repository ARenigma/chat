-- 054  One named signal for identity verification
--
-- WHY THIS EXISTS
--
-- Two columns were being read as "is this person verified" and they could
-- disagree:
--
--   * the app read `identity_verified_at is not null`
--   * `complete_provider_onboarding` (051) gated on `date_of_birth is not null`
--
-- Nothing kept them in step. `cashfree-onboarding-complete` writes the DOB only
-- `if (dob)` — Cashfree does not always return one — while other paths set
-- `identity_verified_at` on their own. Found in production data on 2026-09-04: a
-- real account had `identity_verified_at` SET and `date_of_birth` NULL, which is
-- unreachable through any intended path and left that person permanently stuck.
-- The app told them identity was done; the RPC answered "verify your identity
-- first" every time, with no route forward in the UI.
--
-- So this adds the thing that was missing: an explicit state that both sides
-- read, with the DOB demoted to what it actually is — data, and the input to the
-- legal age check, not a proxy for "verified".
--
-- The 18+ gate is NOT weakened. `identity_state = 'verified'` is what proves the
-- identity step ran; the age check still reads `date_of_birth` and still refuses
-- a provider whose age is unknown. Both must pass.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
-- Text with a CHECK rather than a Postgres enum, deliberately. Adding a value to
-- an enum cannot run inside a transaction with other DDL on older servers, and
-- this state machine is likely to grow a 'failed' or 'expired' member; a CHECK
-- is altered in one statement with no such constraint.
alter table public.profiles
  add column if not exists identity_state text not null default 'none';

alter table public.profiles
  drop constraint if exists profiles_identity_state_check;

alter table public.profiles
  add constraint profiles_identity_state_check
  check (identity_state in ('none', 'pending', 'verified'));

comment on column public.profiles.identity_state is
  'Identity verification state. none = never attempted or abandoned; pending = a '
  '1-Click session was opened and not yet exchanged; verified = Cashfree returned '
  'verified data and it was persisted. THE single signal both the app and '
  'complete_provider_onboarding read. date_of_birth is data, not a flag: it '
  'exists to answer the 18+ question and may legitimately be absent on a member.';

-- ---------------------------------------------------------------------------
-- Backfill, from evidence rather than from optimism
-- ---------------------------------------------------------------------------
-- 'verified' only where BOTH the DOB and the timestamp are present. A row with
-- one and not the other has not actually completed the step, whatever it was
-- previously told: that is the exact corruption this migration exists to end,
-- and carrying it forward as 'verified' would preserve the bug under a new name.
update public.profiles
set identity_state = 'verified'
where date_of_birth is not null
  and identity_verified_at is not null;

-- The half-written rows are reset to 'none' so the person can run the flow
-- again. `identity_verified_at` is cleared with them: leaving a timestamp that
-- claims a verification that never produced a DOB is how the next reader gets
-- misled the same way.
update public.profiles
set identity_state = 'none',
    identity_verified_at = null
where identity_state <> 'verified'
  and identity_verified_at is not null
  and date_of_birth is null;

-- ---------------------------------------------------------------------------
-- They can never diverge again
-- ---------------------------------------------------------------------------
-- A constraint rather than a convention. Every writer now has to set the pair
-- together or the write fails, which is what "single source of truth" has to
-- mean if it is to survive the next edit to an Edge Function.
alter table public.profiles
  drop constraint if exists profiles_identity_verified_consistent;

alter table public.profiles
  add constraint profiles_identity_verified_consistent
  check (
    identity_state <> 'verified'
    or (date_of_birth is not null and identity_verified_at is not null)
  );

-- ---------------------------------------------------------------------------
-- Not client-writable
-- ---------------------------------------------------------------------------
-- Same reasoning as `role` and `identity_verified_at` in migration 003: a client
-- that can write its own verification state can self-promote. The guard is
-- rewritten rather than extended because `create or replace` needs the whole
-- body, and the three existing checks are reproduced verbatim.
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
    if new.identity_state is distinct from old.identity_state then
      raise exception 'profiles.identity_state is not client-writable'
        using errcode = '42501';
    end if;
    if new.token_balance is distinct from old.token_balance then
      raise exception 'profiles.token_balance is not client-writable'
        using errcode = '42501';
    end if;
    -- The DOB is now the age input rather than the verification flag, and it is
    -- written only by the service role from Cashfree's response. A client that
    -- can set its own birth date can defeat the 18+ gate by typing a year.
    if new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'profiles.date_of_birth is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
  before update on public.profiles
  for each row
  execute function public.guard_privileged_profile_columns();

-- ---------------------------------------------------------------------------
-- The onboarding RPC reads the new signal
-- ---------------------------------------------------------------------------
-- Signature unchanged, so no client change is required to deploy this.
create or replace function public.complete_provider_onboarding(
  p_display_name text,
  p_headline text,
  p_languages text[],
  p_about text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_state text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    raise exception 'a display name is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_headline, '')) = '' then
    raise exception 'a headline is required' using errcode = '22023';
  end if;
  if p_languages is null or array_length(p_languages, 1) is null then
    raise exception 'at least one language is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_about, '')) = '' then
    raise exception 'an about is required' using errcode = '22023';
  end if;

  select identity_state, date_of_birth
    into v_state, v_dob
    from public.profiles
   where id = v_uid;

  -- The identity step, read from the one signal that now records it.
  if v_state is distinct from 'verified' then
    raise exception 'verify your identity first' using errcode = '22023';
  end if;

  -- The age gate (legal, non-negotiable) reads the DOB itself. The consistency
  -- constraint above means a 'verified' row always has one, so this cannot be
  -- the confusing failure it used to be — but it is checked rather than assumed,
  -- because "cannot happen" is not a thing to bet an age gate on.
  if v_dob is null then
    raise exception 'date of birth missing from your verification' using errcode = '22023';
  end if;
  if v_dob > (current_date - interval '18 years') then
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;

  update public.profiles
  set role = 'provider',
      display_name = btrim(p_display_name),
      headline = btrim(p_headline),
      languages = p_languages,
      about = btrim(p_about),
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = v_uid;
end;
$$;

revoke all on function public.complete_provider_onboarding(text, text, text[], text) from public;
grant execute on function public.complete_provider_onboarding(text, text, text[], text) to authenticated;

comment on function public.complete_provider_onboarding(text, text, text[], text) is
  'Completes provider onboarding for the calling user. Requires identity_state = '
  'verified (set by cashfree-onboarding-complete) AND a date_of_birth 18 years '
  'or older. Sets role=provider and stamps identity_verified_at.';
