-- ===========================================================================
-- 189  Provider agreement + gender on provider onboarding
-- ===========================================================================
-- C3: Providers must accept a Provider Agreement before going live.
--     The agreement is a new policy kind in the same policy_versions /
--     policy_acceptances tables that member terms/privacy already use.
--     complete_provider_onboarding refuses (22023) if the current version has
--     not been accepted. The client records acceptance via
--     accept_current_provider_agreement() before pressing Go live.
--
-- C4: Self-serve providers never set gender, so provider cards show nothing.
--     A required gender field is added to the profile step; the new p_gender
--     param is validated and written inside complete_provider_onboarding (which
--     is SECURITY DEFINER and therefore not subject to guard_pii_columns, the
--     trigger that blocks client writes to profiles.gender).
--
-- This migration:
--   1. Extends both check constraints to allow 'provider_agreement'.
--   2. Adds is_provider_only to policy_versions so the member boot-gate never
--      shows providers-only documents to ordinary members.
--   3. Updates pending_policy_acceptances() and user_has_accepted_current_policies()
--      to skip provider-only versions.
--   4. Adds accept_current_provider_agreement() — idempotent, looks up the
--      current version so the client does not need to.
--   5. Drops the old 5-arg complete_provider_onboarding (so exactly one
--      overload exists, as pgTAP 270 asserts), recreates it with p_gender.
--   6. Seeds the provider agreement as version 1 (is_provider_only = true).
--
-- Agreement text: docs/legal/provider-agreement.md in the repo.
-- Public URL: https://chat-arenigmas-projects.vercel.app/provider-agreement
-- (same base as terms and privacy; page to be deployed before launch).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the kind / policy_kind check constraints
-- ---------------------------------------------------------------------------

alter table public.policy_versions
  drop constraint policy_versions_kind_check;
alter table public.policy_versions
  add constraint policy_versions_kind_check
    check (kind in ('terms', 'privacy', 'provider_agreement'));

alter table public.policy_acceptances
  drop constraint policy_acceptances_policy_kind_check;
alter table public.policy_acceptances
  add constraint policy_acceptances_policy_kind_check
    check (policy_kind in ('terms', 'privacy', 'provider_agreement'));

-- ---------------------------------------------------------------------------
-- 2. is_provider_only — excludes documents from the member boot-gate
-- ---------------------------------------------------------------------------
-- The member gate (pending_policy_acceptances / user_has_accepted_current_policies)
-- must not show provider-only documents to all users at app boot. This column
-- lets those queries filter cleanly without a hard-coded kind list.

alter table public.policy_versions
  add column if not exists is_provider_only boolean not null default false;

comment on column public.policy_versions.is_provider_only is
  'True for documents that only apply to providers (e.g. Provider Agreement). '
  'The member boot-gate and UGC RPC guard skip rows where this is true.';

-- ---------------------------------------------------------------------------
-- 3. pending_policy_acceptances — exclude provider-only versions
-- ---------------------------------------------------------------------------
-- The previous body is reproduced exactly (migration 027) except for the added
-- is_provider_only filter in the `latest` CTE.

create or replace function public.pending_policy_acceptances()
returns table (
  version_id  uuid,
  kind        text,
  url         text,
  summary     text,
  is_material boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (kind)
      id, kind, url, summary, is_material, effective_at
    from public.policy_versions
    where effective_at <= now()
      -- Provider-only documents (e.g. Provider Agreement) are checked
      -- separately in complete_provider_onboarding, not at member boot time.
      and not is_provider_only
    order by kind, version desc
  ),
  accepted as (
    select policy_kind, version_id
    from public.policy_acceptances
    where user_id = auth.uid()
  )
  select l.id, l.kind, l.url, l.summary, l.is_material
  from latest l
  where not exists (
    select 1 from accepted a
    where a.policy_kind = l.kind
      and a.version_id  = l.id
  )
  and (
    l.is_material = true
    or not exists (
      select 1 from accepted a
      where a.policy_kind = l.kind
    )
  );
$$;

revoke all on function public.pending_policy_acceptances() from public, anon, service_role;
grant execute on function public.pending_policy_acceptances() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. user_has_accepted_current_policies — same is_provider_only filter
-- ---------------------------------------------------------------------------

create or replace function public.user_has_accepted_current_policies(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (kind)
      id, kind, is_material
    from public.policy_versions
    where effective_at <= now()
      and not is_provider_only
    order by kind, version desc
  ),
  accepted as (
    select policy_kind, version_id
    from public.policy_acceptances
    where user_id = p_user_id
  )
  select not exists (
    select 1
    from latest l
    where not exists (
      select 1 from accepted a
      where a.policy_kind = l.kind
        and a.version_id  = l.id
    )
    and (
      l.is_material = true
      or not exists (
        select 1 from accepted a
        where a.policy_kind = l.kind
      )
    )
  );
$$;

-- Closed to clients, as 153 left it: it is read by definer functions, never
-- called by the app.
revoke all on function public.user_has_accepted_current_policies(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. accept_current_provider_agreement — idempotent RPC for the client
-- ---------------------------------------------------------------------------
-- Called from the provider application screen's Go live flow. Finds the
-- current provider agreement version and inserts an acceptance row; the
-- ON CONFLICT DO NOTHING makes it safe to call again on retry.
-- complete_provider_onboarding validates server-side that acceptance exists.

create or replace function public.accept_current_provider_agreement()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
begin
  select id into v_version_id
  from public.policy_versions
  where kind = 'provider_agreement'
    and effective_at <= now()
  order by version desc
  limit 1;

  if v_version_id is null then
    raise exception 'No provider agreement is published' using errcode = 'P0001';
  end if;

  insert into public.policy_acceptances
    (user_id, policy_kind, version_id)
  values
    (auth.uid(), 'provider_agreement', v_version_id)
  on conflict (user_id, policy_kind, version_id) do nothing;
end;
$$;

revoke all on function public.accept_current_provider_agreement() from public, anon, service_role;
grant execute on function public.accept_current_provider_agreement() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. complete_provider_onboarding — drop old 5-arg, create 6-arg
-- ---------------------------------------------------------------------------
-- The old signature (text, text, text[], text, text) is dropped first so
-- exactly one overload exists after this migration (pgTAP 270 asserts count=1).
-- p_provider_category loses its default because the default was only there for
-- backwards compatibility with callers that predated 065; all callers now pass
-- it, and the drop removes the old call target anyway.
--
-- Two additions to the body relative to migration 185:
--   • p_gender: validated against profiles.gender's CHECK (006: female/male/other);
--     written in the final UPDATE, which succeeds because SECURITY DEFINER runs
--     as the owner and guard_pii_columns (012) only raises for 'authenticated'
--     and 'anon' roles.
--   • provider agreement check: server-authoritative gate so an old build or a
--     direct RPC call cannot bypass the client checkbox.

drop function if exists public.complete_provider_onboarding(text, text, text[], text, text);

create or replace function public.complete_provider_onboarding(
  p_display_name text,
  p_headline text,
  p_languages text[],
  p_about text,
  p_provider_category text,
  p_gender text
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

  -- C4 (189): gender is required so member cards never show a blank.
  -- The three values mirror the CHECK on profiles.gender (migration 006).
  if p_gender is null or p_gender not in ('female', 'male', 'other') then
    raise exception 'choose a gender from: female, male, or other'
      using errcode = '22023';
  end if;

  -- C3 (189): the caller must have accepted the current provider agreement.
  -- Checked here as a server-authoritative gate so an old build or a direct
  -- RPC call cannot bypass the client checkbox.
  if not exists (
    select 1
    from (
      select distinct on (kind) id
      from public.policy_versions
      where kind = 'provider_agreement' and effective_at <= now()
      order by kind, version desc
    ) latest
    join public.policy_acceptances pa
      on pa.version_id = latest.id and pa.user_id = v_uid
  ) then
    raise exception 'accept the provider agreement' using errcode = '22023';
  end if;

  -- A provider is chosen by face, so the flow cannot end without them (Amit,
  -- 2026-10-03: "3 photos mandatory with one primary ... at least 3"). The
  -- gallery's own trigger (070) guarantees one of them is primary once any
  -- exists, so the count is the whole check. Photos are the caller's own rows
  -- (provider_photos_insert_own is provider_id = auth.uid(), with no role
  -- condition), which is how a member can add them before being promoted.
  if (select count(*) from public.provider_photos where provider_id = v_uid) < 3 then
    raise exception 'add at least 3 photos of yourself' using errcode = '22023';
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
  -- `gender` is written here rather than via a client PATCH because
  -- guard_pii_columns (012) raises 42501 for authenticated/anon role writes;
  -- this function is SECURITY DEFINER and runs as the owner, so the trigger's
  -- current_user check passes through.
  update public.profiles
  set role = 'provider',
      date_of_birth = v_dob,
      display_name = btrim(p_display_name),
      headline = btrim(p_headline),
      languages = p_languages,
      about = btrim(p_about),
      provider_category = p_provider_category,
      gender = p_gender,
      -- The face: the main photo, set here because the mirror trigger skips
      -- members. 112's guard has nothing to null (it is a URL, not clay).
      avatar_url = (
        select url from public.provider_photos
         where provider_id = v_uid and is_primary
         limit 1
      ),
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = v_uid;
end;
$$;

revoke all on function
  public.complete_provider_onboarding(text, text, text[], text, text, text) from public;
grant execute on function
  public.complete_provider_onboarding(text, text, text[], text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Seed provider agreement version 1
-- ---------------------------------------------------------------------------
-- The agreement text lives in docs/legal/provider-agreement.md in the repo.
-- The URL below must be deployed before providers can read it in-app.
-- Update the URL row rather than inserting a new version if only the path
-- changes; publish version 2 (is_material=true) when the terms change.

insert into public.policy_versions
  (kind, version, is_material, is_provider_only, url, summary, effective_at)
values
  ('provider_agreement', 1, true, true,
   'https://chat-arenigmas-projects.vercel.app/provider-agreement',
   'Provider Agreement for Pappal — earnings split, payouts, conduct and privacy rules for providers.',
   now());
