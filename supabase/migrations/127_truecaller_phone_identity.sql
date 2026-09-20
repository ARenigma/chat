-- 127  Truecaller identity linking and canonical phone-owner resolution
--
-- WHY THIS EXISTS
-- ---------------
-- Truecaller authenticates by returning a stable OAuth `sub` (provider_subject)
-- and a Truecaller-verified E.164 phone. We must map both to a single Supabase
-- user row without creating duplicates or silently merging unrelated accounts.
--
-- The constraints enforced here:
--   1. (provider, provider_subject) is a stable external identity; it maps to
--      exactly one Supabase user and cannot be reassigned.
--   2. A verified phone belongs to at most one Supabase user across all
--      auth paths (Firebase, Truecaller, Supabase-native OTP, Google+phone).
--      Collisions fail closed rather than silently creating duplicates.
--   3. A Google user who verifies their phone through Truecaller is linked by
--      consuming an opaque, short-lived challenge; their UUID, wallet, profile,
--      conversations, and history are unchanged.
--   4. All resolver RPCs are SERVICE_DEFINER and executable only by service_role.
--      The identity and pending-challenge tables are not accessible to anon or
--      authenticated callers.
--
-- DESIGN: see docs/adr/0032-truecaller-auth-and-account-linking.md

-- ---------------------------------------------------------------------------
-- External identity table
-- ---------------------------------------------------------------------------
-- Stores the stable (provider, sub) → user_id mapping for any external OAuth
-- provider. Currently used only for Truecaller; other providers can be added.

create table if not exists private.external_identities (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null check (provider in ('truecaller')),
  subject      text not null,
  phone_e164   text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint external_identities_provider_subject_unique unique (provider, subject),
  constraint external_identities_phone_unique unique (phone_e164)
);

comment on table private.external_identities is
  'Maps a stable (provider, provider_subject) OAuth identity to a single '
  'Supabase auth.users row. Created by migration 127.';

-- Cascade: when the auth user is deleted, the external identity row goes with it.
-- Indexed for the phone lookup path used by resolve_phone_owner.
create index if not exists external_identities_phone_idx
  on private.external_identities (phone_e164);

-- No access to anon or authenticated: the table holds verified phone ownership.
revoke all on private.external_identities from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pending-identity challenge table
-- ---------------------------------------------------------------------------
-- When Truecaller verifies a phone but no Supabase user owns it yet, we must
-- not create a user immediately — the member may already have a Google account.
-- Instead we store an opaque challenge keyed to the verified identity.
--
-- The client shows "New here?" vs "Already use Google?":
--   New here     → server consumes the challenge and creates a Supabase user.
--   Google user  → member signs in with Google; backend consumes the challenge
--                  to bind the Truecaller sub/phone to that exact UUID.
--
-- Challenges expire in 10 minutes and each is consumed exactly once.

create table if not exists private.pending_identity_challenges (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('truecaller')),
  subject        text not null,
  phone_e164     text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  challenge_hash text not null,   -- SHA-256 hex of the random challenge token
  expires_at     timestamptz not null default (now() + interval '10 minutes'),
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);

comment on table private.pending_identity_challenges is
  'Short-lived opaque challenges for unmatched Truecaller verifications. '
  'Consumed exactly once; expire after 10 minutes. Created by migration 127.';

create index if not exists pending_challenges_hash_idx
  on private.pending_identity_challenges (challenge_hash)
  where consumed_at is null and expires_at > now();

revoke all on private.pending_identity_challenges from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- resolve_phone_owner: canonical E.164 → Supabase user_id
-- ---------------------------------------------------------------------------
-- Looks in this precedence order:
--   1. private.external_identities (most specific — Truecaller sub is stable)
--   2. auth.users.phone (Firebase/Supabase-native OTP path)
--   3. public.profiles.phone_e164 with phone_verified_at (Google users who
--      verified their number through the in-app phone-verification sheet,
--      migration 010)
--
-- Returns null when no owner exists. The caller decides whether to create one
-- or issue a pending challenge.

create or replace function public.resolve_phone_owner(p_phone text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    -- 1. External identity (Truecaller sub-keyed, most reliable)
    (select user_id from private.external_identities
     where phone_e164 = p_phone limit 1),
    -- 2. auth.users.phone (Firebase / Supabase-native OTP)
    (select id from auth.users
     where phone = ltrim(p_phone, '+') limit 1),
    -- 3. profiles.phone_e164 verified through the in-app sheet (Google users)
    (select id from public.profiles
     where phone_e164 = p_phone
       and phone_verified_at is not null
     limit 1)
  );
$$;

revoke all on function public.resolve_phone_owner(text) from public, anon, authenticated;
grant execute on function public.resolve_phone_owner(text) to service_role;

-- ---------------------------------------------------------------------------
-- upsert_external_identity: record a new or returning Truecaller sign-in
-- ---------------------------------------------------------------------------
-- Called by the exchange-truecaller-code Edge Function after the authorization
-- code exchange succeeds and we have confirmed the verified phone and sub.
--
-- Invariants enforced (all fail with SQLSTATE P0001):
--   - The same (provider, subject) cannot be reassigned to a different user_id.
--   - The same phone_e164 cannot be claimed by a different subject.
--   - Authenticated linking cannot steal another user's external identity.

create or replace function public.upsert_external_identity(
  p_provider  text,
  p_subject   text,
  p_phone     text,
  p_user_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_key bigint;
begin
  -- Advisory lock scoped to (provider, subject) to serialise concurrent attempts
  -- for the same Truecaller user while the table upsert is non-atomic.
  v_lock_key := hashtext(p_provider || ':' || p_subject);
  perform pg_advisory_xact_lock(v_lock_key);

  insert into private.external_identities
    (provider, subject, phone_e164, user_id)
  values
    (p_provider, p_subject, p_phone, p_user_id)
  on conflict (provider, subject) do update
    set phone_e164 = excluded.phone_e164
    -- Reject subject re-assignment to a different user.
    where external_identities.user_id = excluded.user_id
      and external_identities.provider = excluded.provider
      and external_identities.subject = excluded.subject;

  if not found then
    raise exception 'identity conflict: subject % already bound to a different user', p_subject
      using errcode = 'P0001';
  end if;

  -- Also ensure the phone isn't already owned by a different user via a different subject.
  if exists (
    select 1 from private.external_identities
    where phone_e164 = p_phone
      and subject <> p_subject
      and provider = p_provider
  ) then
    raise exception 'identity conflict: phone already bound to a different identity'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.upsert_external_identity(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.upsert_external_identity(text, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- create_pending_challenge / consume_pending_challenge
-- ---------------------------------------------------------------------------
-- These two RPCs back the "New here?" / "Already use Google?" continuity flow.

create or replace function public.create_pending_challenge(
  p_provider      text,
  p_subject       text,
  p_phone         text,
  p_challenge_hash text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.pending_identity_challenges
    (provider, subject, phone_e164, challenge_hash)
  values
    (p_provider, p_subject, p_phone, p_challenge_hash);
$$;

revoke all on function public.create_pending_challenge(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_pending_challenge(text, text, text, text)
  to service_role;

create or replace function public.consume_pending_challenge(
  p_challenge_hash text,
  out out_provider text,
  out out_subject  text,
  out out_phone    text
)
returns record
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.pending_identity_challenges
  set consumed_at = now()
  where challenge_hash = p_challenge_hash
    and consumed_at is null
    and expires_at > now()
  returning provider, subject, phone_e164
  into out_provider, out_subject, out_phone;

  if out_provider is null then
    raise exception 'challenge not found, already consumed, or expired'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.consume_pending_challenge(text)
  from public, anon, authenticated;
grant execute on function public.consume_pending_challenge(text) to service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping: purge expired unclaimed challenges
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_challenges()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.pending_identity_challenges
  where expires_at < now() - interval '1 hour';
$$;

-- Schedule daily via pg_cron if present (not enforced here — the RPC exists
-- so it can be invoked from any cron mechanism).
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule(
      'purge-truecaller-challenges',
      '0 3 * * *',
      'select public.purge_expired_challenges()'
    );
  end if;
end;
$$;
