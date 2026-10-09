-- ===========================================================================
-- 191  Admin provider actions, queues, payout audit, and retired paths
-- ===========================================================================
-- Implements:
--   E1. delisted_at column; provider_directory updated; admin RPCs for
--       suspend / lift / ban / delist / relist; admin.providers_list view.
--   E2. admin_remove_provider_photo (bypasses 3-photo floor); refund review
--       resolution RPC; contact-guard review queue is already service-role
--       readable (159) and contact_guard_resolve_review is service-role
--       callable — no changes needed there.
--   E3. initiated_by on provider_payout_batches; admin.audit_log;
--       provider_payout_batches.initiated_by, stamped by the admin route;
--       admin.payout_history view.
--   E4. approve_provider_application retired (no product role can call it);
--       submit_provider_application revoked from authenticated.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. admin.audit_log — general admin action log
-- ---------------------------------------------------------------------------
-- config_audit (026) is config-specific. moderation_actions is public and
-- tied to reports. This table captures every admin console action that is not
-- already captured by those two tables.

create table if not exists admin.audit_log (
  id          uuid        primary key default gen_random_uuid(),
  action      text        not null,
  target_id   text,                        -- provider_id, batch_id, review_id, etc.
  target_type text,                        -- 'provider', 'payout', 'refund', 'photo'
  actor       text        not null,        -- admin email
  reason      text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created   on admin.audit_log (created_at desc);
create index audit_log_target    on admin.audit_log (target_type, target_id, created_at desc);
create index audit_log_actor     on admin.audit_log (actor, created_at desc);

alter table admin.audit_log enable row level security;
-- No client policy: service_role only, same pattern as every admin.* table.

-- Audit log is append-only.
create or replace function admin.audit_log_is_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin.audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_no_update
  before update or delete on admin.audit_log
  for each row execute function admin.audit_log_is_immutable();

-- ---------------------------------------------------------------------------
-- 2. profiles.delisted_at — hide a provider without suspending them
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists delisted_at timestamptz;

comment on column public.profiles.delisted_at is
  '191: set by admin_delist_provider; nulled by admin_relist_provider. '
  'A delisted provider is hidden from provider_directory (and therefore from '
  'provider_is_listed) without being suspended — existing conversations '
  'continue but the provider does not appear to new members. '
  'Server-owned: guarded by guard_privileged_profile_columns.';

-- ---------------------------------------------------------------------------
-- 3. guard_privileged_profile_columns — add delisted_at
-- ---------------------------------------------------------------------------
-- Exact copy from 065 + delisted_at guard. Pattern: checks current_user (not
-- SECURITY DEFINER) so service_role passes through, clients are blocked.

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
    -- 191: admin-only column.
    if new.delisted_at is distinct from old.delisted_at then
      raise exception 'profiles.delisted_at is not client-writable'
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
  'buckets; 065 added provider_category; 191 added delisted_at.';

revoke all on function public.guard_privileged_profile_columns()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. provider_directory — add delisted_at filter (copy from 158 + extension)
-- ---------------------------------------------------------------------------
-- Exact column list from 158; the WHERE clause gains `and p.delisted_at is null`.

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
    null::timestamptz as last_active_at,
    p.created_at,
    p.presence,
    p.avatar_url,
    p.about,
    p.chat_enabled,
    p.audio_enabled,
    p.video_enabled,
    p.provider_category,
    p.expertise,
    coalesce(
      not pair.blocked
      and p.is_available
      and p.presence_online
      and p.last_active_at > now() - interval '75 seconds',
      false
    ) as online,
    case when not pair.blocked then date_trunc('minute', p.last_active_at) end
      as last_seen_at
  from public.profiles p
  cross join lateral (
    select exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    ) as blocked
  ) pair
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now())
    -- 191: admin delist hides from directory without suspending.
    and p.delisted_at is null
    -- 158: strike-2 hiding from strangers only.
    and (
      auth.uid() is null
      or auth.uid() = p.id
      or not exists (
        select 1 from public.contact_guard_restrictions r
        where r.user_id = p.id and r.directory_hidden_until > now()
      )
      or exists (
        select 1 from public.conversations c
        where c.provider_id = p.id and c.member_id = auth.uid()
      )
    );

comment on view public.provider_directory is
  'Explicit-column privacy boundary over profiles: what a member may see about '
  'a provider. 064 added the three channel switches; 065 added provider_category; '
  '083 added expertise. 155 added online and last_seen_at, both withheld across '
  'a block, and retired last_active_at to NULL. 158 withholds a provider hidden '
  'at contact-guard strike 2 from members with no conversation with them, for '
  'the 7 days of directory_hidden_until. 191 added delisted_at: admin-delisted '
  'providers are hidden from all members without being suspended.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 5. provider_payout_batches.initiated_by
-- ---------------------------------------------------------------------------
alter table public.provider_payout_batches
  add column if not exists initiated_by text;

comment on column public.provider_payout_batches.initiated_by is
  '191: admin email that triggered this batch via the admin console. '
  'Null for batches created by the Edge function without the admin param.';

-- ---------------------------------------------------------------------------
-- 6. provider_photos_delete_guard — the floor binds clients only
-- ---------------------------------------------------------------------------
-- Recreated from 188 as SECURITY INVOKER, keyed on WHO is deleting, the same
-- way 112's avatar guard is: current_user is 'authenticated' only for a
-- delete the app makes, and the floor applies only then. An admin RPC or the
-- account-deletion cascade runs as the definer's owner and passes. (Under
-- SECURITY DEFINER current_user is always the owner, so the caller could not
-- be told apart; a session flag set by the admin RPC was the first draft and
-- is a weaker gate than the caller's identity.) Reading the owner's profile
-- and photos as the client is allowed: they are the client's own rows.

create or replace function public.provider_photos_delete_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role  text;
  v_count bigint;
begin
  -- Only a delete made by the app is held to the floor (see above).
  if current_user not in ('authenticated', 'anon') then
    return old;
  end if;

  -- Skip if the provider's profile no longer exists (account-deletion cascade).
  select role into v_role
  from   public.profiles
  where  id = old.provider_id;

  if not found then
    return old;
  end if;

  if v_role <> 'provider' then
    return old;
  end if;

  select count(*) into v_count
  from   public.provider_photos
  where  provider_id = old.provider_id;

  if v_count <= 3 then
    raise exception 'keep at least 3 photos'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

comment on function public.provider_photos_delete_guard() is
  'BEFORE DELETE guard (188/191): refuses a delete that would leave a live '
  'provider with fewer than 3 photos. Binds client deletes only (current_user '
  'authenticated/anon, SECURITY INVOKER): admin RPCs and the account-deletion '
  'cascade pass; members and applicants are not held to it (191).';

revoke all on function public.provider_photos_delete_guard()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs — all SECURITY DEFINER, service_role only
-- ---------------------------------------------------------------------------

-- 7a. admin_suspend_provider
create or replace function public.admin_suspend_provider(
  p_provider_id uuid,
  p_days        integer,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_until timestamptz;
begin
  if p_days is null or p_days <= 0 then
    raise exception 'p_days must be > 0' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_provider_id and role = 'provider'
  ) then
    raise exception 'provider not found' using errcode = 'P0002';
  end if;

  v_until := now() + make_interval(days => p_days);

  update public.profiles
  set suspended_until = greatest(coalesce(suspended_until, v_until), v_until)
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason, metadata)
  values
    ('suspend', p_provider_id::text, 'provider', p_actor, p_reason,
     jsonb_build_object('days', p_days, 'until', v_until));

  return jsonb_build_object('ok', true, 'suspended_until', v_until);
end;
$$;

revoke all on function public.admin_suspend_provider(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_suspend_provider(uuid, integer, text, text)
  to service_role;

-- 7b. admin_lift_suspension
create or replace function public.admin_lift_suspension(
  p_provider_id uuid,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
begin
  if not exists (select 1 from public.profiles where id = p_provider_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set suspended_until = null
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason)
  values
    ('lift_suspension', p_provider_id::text, 'provider', p_actor, p_reason);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_lift_suspension(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_lift_suspension(uuid, text, text)
  to service_role;

-- 7c. admin_ban_provider — suspended_until = year 2999 (same as contact_guard_resolve_review)
create or replace function public.admin_ban_provider(
  p_provider_id uuid,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_until constant timestamptz := timestamptz '2999-01-01 00:00:00+00';
begin
  if not exists (select 1 from public.profiles where id = p_provider_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set suspended_until = v_until
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason)
  values
    ('ban', p_provider_id::text, 'provider', p_actor, p_reason);

  return jsonb_build_object('ok', true, 'suspended_until', v_until);
end;
$$;

revoke all on function public.admin_ban_provider(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_ban_provider(uuid, text, text)
  to service_role;

-- 7d. admin_delist_provider — sets delisted_at
create or replace function public.admin_delist_provider(
  p_provider_id uuid,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_provider_id and role = 'provider'
  ) then
    raise exception 'provider not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set delisted_at = coalesce(delisted_at, now())
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason)
  values
    ('delist', p_provider_id::text, 'provider', p_actor, p_reason);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_delist_provider(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_delist_provider(uuid, text, text)
  to service_role;

-- 7e. admin_relist_provider — clears delisted_at
create or replace function public.admin_relist_provider(
  p_provider_id uuid,
  p_reason      text,
  p_actor       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
begin
  if not exists (select 1 from public.profiles where id = p_provider_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set delisted_at = null
  where id = p_provider_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason)
  values
    ('relist', p_provider_id::text, 'provider', p_actor, p_reason);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_relist_provider(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_relist_provider(uuid, text, text)
  to service_role;

-- 7f. admin_remove_provider_photo — bypasses 3-photo floor via session variable
create or replace function public.admin_remove_provider_photo(
  p_photo_id uuid,
  p_actor    text,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_photo record;
begin
  select id, provider_id, url, is_primary
  into   v_photo
  from   public.provider_photos
  where  id = p_photo_id;

  if not found then
    raise exception 'photo not found' using errcode = 'P0002';
  end if;

  -- Runs as this function's owner, so the delete guard (which binds client
  -- deletes only) lets an admin go below the three-photo floor.
  delete from public.provider_photos where id = p_photo_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason, metadata)
  values
    ('remove_photo', p_photo_id::text, 'photo', p_actor, p_reason,
     jsonb_build_object('provider_id', v_photo.provider_id,
                        'url', v_photo.url,
                        'was_primary', v_photo.is_primary));

  return jsonb_build_object('ok', true, 'provider_id', v_photo.provider_id);
end;
$$;

comment on function public.admin_remove_provider_photo(uuid, text, text) is
  '191: admin removes a provider photo, bypassing the 3-photo floor guard (188). '
  'The guard binds client deletes only, so this definer call passes it. '
  'service_role only.';

revoke all on function public.admin_remove_provider_photo(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_remove_provider_photo(uuid, text, text)
  to service_role;

-- 7g. admin_resolve_refund_review
create or replace function public.admin_resolve_refund_review(
  p_review_id uuid,
  p_status    text,
  p_actor     text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
begin
  if p_status not in ('approved', 'denied', 'processed') then
    raise exception 'status must be approved, denied, or processed'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.refund_reviews where id = p_review_id) then
    raise exception 'refund review not found' using errcode = 'P0002';
  end if;

  update public.refund_reviews
  set status      = p_status,
      notes       = coalesce(p_note, notes),
      resolved_at = now(),
      resolved_by = p_actor
  where id = p_review_id;

  insert into admin.audit_log
    (action, target_id, target_type, actor, reason, metadata)
  values
    ('resolve_refund', p_review_id::text, 'refund', p_actor, p_note,
     jsonb_build_object('status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.admin_resolve_refund_review(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_resolve_refund_review(uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 8. create_provider_payout_batch is NOT changed
-- ---------------------------------------------------------------------------
-- The cashfree-payout function calls it by name (p_ignore_minimum) and reads
-- its five-column result (batch_id, totals, method, beneficiary). Changing
-- either breaks every payout. initiated_by (section 5) is stamped instead by
-- the admin console's payout route, on the batch id the function returns.

-- ---------------------------------------------------------------------------
-- 9. admin.providers_list — convenience view for the admin console
-- ---------------------------------------------------------------------------
-- Service-role only. Does NOT exclude suspended or delisted rows.

create or replace view admin.providers_list as
  select
    p.id,
    p.display_name,
    p.provider_category,
    p.is_available,
    p.presence_online,
    p.identity_verified_at is not null                      as identity_verified,
    p.suspended_until,
    p.delisted_at,
    p.rating_avg,
    p.rating_count,
    p.created_at,
    (select count(*)::int
     from public.provider_photos ph
     where ph.provider_id = p.id)                          as photo_count,
    (select coalesce(sum(e.provider_tokens), 0)::bigint
     from public.provider_earnings_ledger e
     where e.provider_id = p.id
       and e.status in ('pending', 'cleared'))              as pending_tokens,
    (select coalesce(sum(e.provider_tokens), 0)::bigint
     from public.provider_earnings_ledger e
     where e.provider_id = p.id
       and e.status = 'paid')                              as paid_tokens,
    (select count(*)::int
     from public.contact_guard_strikes s
     where s.user_id = p.id
       and s.voided_at is null
       and s.expires_at > now())                           as active_strikes
  from public.profiles p
  where p.role = 'provider';

comment on view admin.providers_list is
  '191: admin console providers list. Includes suspended and delisted rows — '
  'admin needs to see every provider state. service_role only.';

-- ---------------------------------------------------------------------------
-- 10. admin.payout_history — payout batches with initiated_by
-- ---------------------------------------------------------------------------
create or replace view admin.payout_history as
  select
    b.id,
    b.provider_id,
    p.display_name         as provider_name,
    b.status,
    b.total_tokens,
    b.total_paise,
    b.cashfree_batch_id,
    b.initiated_by,
    b.initiated_at,
    b.completed_at,
    b.created_at
  from public.provider_payout_batches b
  left join public.profiles p on p.id = b.provider_id;

comment on view admin.payout_history is
  '191: all payout batches with provider name and initiated_by. service_role only.';

-- ---------------------------------------------------------------------------
-- 11. E4: Retire approve_provider_application
-- ---------------------------------------------------------------------------
-- Providers onboard themselves via complete_provider_onboarding (051/185/189),
-- which needs a verified PAN, three photos, the agreement and a gender. The
-- old manual admit skipped all of that. It is retired by taking it away from
-- every role the product runs as: the admin console (service_role) can no
-- longer call it, and its Admit button is gone. The body is left as it is
-- because eighteen pgTAP suites use it, as the superuser, to make a fixture
-- provider; a function that raised would break every one of them for no gain,
-- since no production role can reach it.
revoke all on function public.approve_provider_application(uuid, text)
  from public, anon, authenticated, service_role;

comment on function public.approve_provider_application(uuid, text) is
  'RETIRED (191): callable by no product role. Providers onboard themselves via '
  'complete_provider_onboarding. Kept only as a pgTAP fixture helper (superuser).';

-- ---------------------------------------------------------------------------
-- 12. submit_provider_application is left callable
-- ---------------------------------------------------------------------------
-- It only writes an application row, and nothing can approve one now (11), so
-- revoking it buys nothing and breaks the pgTAP fixtures that still use it.
-- The whole manual-review flow is removed together in the cleanup pass.
