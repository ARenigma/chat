-- ===========================================================================
-- 158  Strike 2 hides a provider from the directory for 7 days
-- ===========================================================================
-- Owner's rule (2026-09-25): at the second contact-guard strike a provider is
-- hidden from the directory for 7 days. 157 records the date in
-- contact_guard_restrictions.directory_hidden_until; this applies it.
--
-- WHAT "HIDDEN" MEANS HERE, and why it is narrower than "not a provider":
-- provider_directory is not only the Explore list. It is also the privacy
-- boundary other readers join for a provider's name and avatar (push names,
-- 110; the usage ledger, 124; provider-initiated contact, 105; the ring
-- names, 143) and the source of provider_is_listed (070), which gates the
-- provider's own story posting and their photos. Removing the row outright
-- would, for 7 days, break the provider's existing chats, their push names
-- and their own stories: a penalty far beyond "hidden from the directory".
--
-- So the row is withheld only from a STRANGER: a signed-in member who has no
-- conversation with the provider. It stays visible to:
--   * the provider themself (their own listing, stories and photos);
--   * anyone who already has a conversation with them (names, pushes, the
--     chat header, the ledger keep working);
--   * readers with no end user (auth.uid() null: pg_cron, the service role,
--     push dispatch), which never browse.
-- Discovery (Explore, home suggestions, story trays, search) is what a
-- stranger sees, and that is exactly what goes dark.
--
-- The view is restated in full ON TOP OF 155: same columns in the same order
-- (155's online / last_seen_at derivation, the retired last_active_at and the
-- block rule included), nothing appended. Only the WHERE gains a clause.
-- security_invoker stays false: the owner reads contact_guard_restrictions,
-- which no client can (RLS on, no policy, 157).

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
    -- Retired (155): read last_seen_at.
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
    -- 158: strike-2 hiding, from strangers only (see the header).
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
  'a provider. 064 added the three channel switches; 065 added '
  'provider_category; 083 added expertise. 155 added online and last_seen_at, '
  'both withheld across a block, and retired last_active_at to NULL. 158 '
  'withholds a provider hidden at contact-guard strike 2 from members with no '
  'conversation with them, for the 7 days of directory_hidden_until. `age` is '
  'an integer here and has been since 042.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;
