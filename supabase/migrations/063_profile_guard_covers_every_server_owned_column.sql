-- ===========================================================================
-- 063  The privileged-column guard covers every server-owned profiles column
-- ===========================================================================
-- Found 2026-09-06 by running the pgTAP harness: suites 040 and 050 had been
-- failing — "a member cannot lift or impose its own suspension", "a provider
-- cannot write their own rating" — and a probe on a scratch cluster showed why,
-- and something worse.
--
-- Migration 054 redefined guard_privileged_profile_columns() to add
-- identity_state and tighten date_of_birth, and in doing so dropped the guards
-- 005 and 006 had added for suspended_until, rating_avg, rating_count and
-- median_reply_seconds. Separately, since 028 introduced the balance buckets,
-- promo_balance and purchased_balance were never guarded at all: the owner RLS
-- policy plus the table-level UPDATE grant let any signed-in user set
-- promo_balance = 100000 on their own row, and sync_token_balance() — a BEFORE
-- trigger that sorts AFTER this guard alphabetically — then wrote token_balance
-- to match. The token_balance guard ran first and saw no change.
--
-- This restores every lost guard, adds the buckets and the remaining
-- server-owned columns, and pgTAP 250 pins each one. The client's legitimate
-- direct writes — is_available, presence, presence_visible, avatar_url
-- (src/api/provider.ts) — are untouched; every other write to this table comes
-- from a SECURITY DEFINER RPC or the service role, whose current_user is not
-- 'authenticated' or 'anon' and so is not checked here.
--
-- Guarding the buckets themselves makes the trigger order irrelevant: a client
-- cannot change the inputs sync_token_balance() derives from.

create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- Identity and standing
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
    -- Written only by the service role from the PAN check (054); a client that
    -- can set its own birth date can defeat the 18+ gate by typing a year.
    if new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'profiles.date_of_birth is not client-writable'
        using errcode = '42501';
    end if;
    if new.age_bracket is distinct from old.age_bracket then
      raise exception 'profiles.age_bracket is not client-writable'
        using errcode = '42501';
    end if;
    if new.suspended_until is distinct from old.suspended_until then
      raise exception 'profiles.suspended_until is not client-writable'
        using errcode = '42501';
    end if;
    if new.profile_completed_at is distinct from old.profile_completed_at then
      raise exception 'profiles.profile_completed_at is not client-writable'
        using errcode = '42501';
    end if;

    -- The wallet: the buckets and the derived total
    if new.promo_balance is distinct from old.promo_balance then
      raise exception 'profiles.promo_balance is not client-writable'
        using errcode = '42501';
    end if;
    if new.purchased_balance is distinct from old.purchased_balance then
      raise exception 'profiles.purchased_balance is not client-writable'
        using errcode = '42501';
    end if;
    if new.token_balance is distinct from old.token_balance then
      raise exception 'profiles.token_balance is not client-writable'
        using errcode = '42501';
    end if;
    if new.last_refill_at is distinct from old.last_refill_at then
      raise exception 'profiles.last_refill_at is not client-writable'
        using errcode = '42501';
    end if;

    -- Reputation is derived from reviews, never asserted by its subject.
    if new.rating_avg is distinct from old.rating_avg
      or new.rating_count is distinct from old.rating_count
      or new.median_reply_seconds is distinct from old.median_reply_seconds then
      raise exception 'reputation columns are not client-writable'
        using errcode = '42501';
    end if;

    -- Server bookkeeping
    if new.engagement_nudged_at is distinct from old.engagement_nudged_at then
      raise exception 'profiles.engagement_nudged_at is not client-writable'
        using errcode = '42501';
    end if;
    if new.created_at is distinct from old.created_at or new.id is distinct from old.id then
      raise exception 'profiles identity columns are not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_privileged_profile_columns() is
  'BEFORE UPDATE guard on public.profiles for the authenticated/anon roles: '
  'every server-owned column raises 42501 if a client changes it. Migration '
  '063 restored the guards 054 dropped (suspension, reputation) and added the '
  'wallet buckets, which sync_token_balance() derives token_balance from. '
  'Client-writable by design: is_available, presence, presence_visible, '
  'avatar_url, and the profile text columns.';
