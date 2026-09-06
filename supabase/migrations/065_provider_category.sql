-- ===========================================================================
-- 065  Provider category: Listeners and Astrologers, one directory
-- ===========================================================================
-- The directory groups providers into two tabs (Amit, 2026-09-05, goal item 9).
-- Decided 2026-09-06: a TAG on the same provider, not a second product — same
-- onboarding, same per-minute rates (ADR-0021 keeps rates uniform and
-- admin-set; a category-level rate would be an amendment to it, not a column
-- here), same payout. What changes is which tab a member finds them under and
-- what the search filters by.
--
-- text + CHECK rather than a Postgres enum, for the reason 054:30-33 gives:
-- ALTER TYPE ADD VALUE cannot share a transaction with other DDL, and this set
-- will grow (tarot, numerology, and whatever else supply turns up with).
--
-- Age is NOT a column here. `provider_directory` has published `age` as an
-- integer since 042, so the age filter of goal item 12 is client-side
-- bracketing of a number the member can already see — no schema, and no second
-- place where the band boundaries could drift from the UI's.

alter table public.profiles
  add column if not exists provider_category text not null default 'listener';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname  = 'profiles_provider_category_values'
  ) then
    alter table public.profiles
      add constraint profiles_provider_category_values
      check (provider_category in ('listener', 'astrologer'));
  end if;
end
$$;

comment on column public.profiles.provider_category is
  'What this provider offers, as the directory groups it: listener (the '
  'default, and what every provider was before 065) or astrologer. A tag, not '
  'a second product — rates and onboarding are identical. Set at onboarding by '
  'complete_provider_onboarding; not client-writable afterwards (063 guard), '
  'because there is no edit screen for it and a silent category change would '
  'move a provider between tabs under the member''s feet.';

-- ---------------------------------------------------------------------------
-- The guard covers it: set once at onboarding, by the definer RPC only
-- ---------------------------------------------------------------------------
-- Re-stated from 063 with provider_category added. Every column 063 named is
-- still here; the contract test pins the whole list against the newest
-- definition, which is what makes a wholesale re-statement safe to do at all.
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
    -- Set once, by complete_provider_onboarding (065).
    if new.provider_category is distinct from old.provider_category then
      raise exception 'profiles.provider_category is not client-writable'
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
  'every server-owned column raises 42501 if a client changes it. 063 restored '
  'the guards 054 dropped (suspension, reputation) and added the wallet '
  'buckets; 065 added provider_category. Client-writable by design: '
  'is_available, presence, presence_visible, avatar_url, the three channel '
  'switches (064), and the profile text columns.';

-- ---------------------------------------------------------------------------
-- The directory publishes it, appended after 064's three
-- ---------------------------------------------------------------------------
create or replace view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    case when p.presence_visible then p.last_active_at end as last_active_at,
    p.created_at,
    p.presence,
    p.avatar_url,
    p.about,
    p.chat_enabled,
    p.audio_enabled,
    p.video_enabled,
    p.provider_category
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'Explicit-column privacy boundary over profiles: what a member may see about '
  'a provider. 064 added the three channel switches; 065 added '
  'provider_category, which the Listeners / Astrologers tabs group by. `age` '
  'is an integer here and has been since 042, which is why the age filter '
  'needs no column of its own.';

-- ---------------------------------------------------------------------------
-- Onboarding takes the category, re-stated from 056 with three additions
-- ---------------------------------------------------------------------------
-- Dropped first, not overloaded: a 5th parameter WITH A DEFAULT would leave
-- both signatures resolvable and every existing 4-arg call would fail as
-- "function is not unique".
drop function if exists public.complete_provider_onboarding(text, text, text[], text);

create or replace function public.complete_provider_onboarding(
  p_display_name text,
  p_headline text,
  p_languages text[],
  p_about text,
  -- Appended with a default, so the 4-arg call sites keep working while the
  -- client rolls out. 'listener' is what every existing provider is.
  p_provider_category text default 'listener'
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
  if p_provider_category not in ('listener', 'astrologer') then
    raise exception 'unknown provider category: %', p_provider_category
      using errcode = '22023';
  end if;

  select identity_state into v_state from public.profiles where id = v_uid;
  if v_state is distinct from 'verified' then
    raise exception 'verify your identity first' using errcode = '22023';
  end if;

  -- The DOB comes from the identity record, not from the caller and not from
  -- the profile (where a member is forbidden to have one).
  select verified_dob into v_dob
    from public.provider_tax_profile
   where provider_id = v_uid;

  if v_dob is null then
    raise exception 'date of birth missing from your verification' using errcode = '22023';
  end if;
  if v_dob > (current_date - interval '18 years') then
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;

  -- ONE statement. `role` and `date_of_birth` change together, so
  -- `member_is_pseudonymous` sees a provider row and is satisfied — the pattern
  -- migration 011 describes for the reviewed path.
  update public.profiles
  set role = 'provider',
      date_of_birth = v_dob,
      display_name = btrim(p_display_name),
      headline = btrim(p_headline),
      languages = p_languages,
      about = btrim(p_about),
      provider_category = p_provider_category,
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = v_uid;
end;
$$;

revoke all on function
  public.complete_provider_onboarding(text, text, text[], text, text) from public;
grant execute on function
  public.complete_provider_onboarding(text, text, text[], text, text) to authenticated;

comment on function
  public.complete_provider_onboarding(text, text, text[], text, text) is
  'Promotes the caller to provider once identity is verified, writing role and '
  'the DOB from provider_tax_profile in ONE statement so '
  'member_is_pseudonymous is never violated. 065 added p_provider_category '
  '(listener | astrologer, defaulted) and dropped the 4-arg signature so the '
  'call can never be ambiguous.';
