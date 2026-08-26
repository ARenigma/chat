-- 013 — provider avatars.
--
-- A provider may publish a photo. v13 shows faces on the directory, the rail,
-- the featured card, the profile hero and the call screen; until now the data
-- model had no place for one, so every avatar fell back to an initial. This adds
-- `profiles.avatar_url` and threads it through the two member-facing projections.
--
-- Same discipline as 012: the views are recreated verbatim apart from the
-- appended column, because `create or replace view` can append a trailing column
-- but cannot remove or reorder one, and `pending_pushes` depends on
-- `provider_directory` while `conversation_summaries` depends on
-- `conversation_peers`. The 050/060/070/090 suites read these views and fail on a
-- dropped column or a changed predicate, which is what proves the reproduction.
--
-- Why `avatar_url` is safe to publish in `provider_directory`: it is a photo the
-- provider chose to show to members, the same class of consented, member-facing
-- field as `display_name` and `headline`. It is NOT wallet-class data. The
-- column list is still the privacy boundary; this column is decided public.

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'A member-facing profile photo URL (Supabase storage, public bucket). Null '
  'until the provider sets one; the client falls back to an initial. Members are '
  'anonymised, so a member row never publishes this off the directory.';

-- provider_directory: 012 verbatim, plus avatar_url appended last.
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
    -- Appended last, as create-or-replace requires. Public to every member by
    -- decision: it is the provider's own directory photo.
    p.avatar_url
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

-- conversation_peers: 012 verbatim, plus peer_avatar_url appended last. Gated to
-- providers — a member peer resolves to a handle and never publishes a photo.
create or replace view public.conversation_peers
with (security_invoker = false) as
  select
    c.id as conversation_id,
    peer.id as peer_id,
    case
      when peer.role = 'provider' then peer.display_name
      else public.member_handle(peer.id)
    end as peer_display_name,
    case when peer.role = 'provider' then peer.is_available else false end
      as peer_available,
    case when peer.presence_visible then peer.last_active_at end
      as peer_last_active_at,
    (peer.role = 'provider') as peer_is_provider,
    peer.presence as peer_presence,
    case when peer.role = 'provider' then peer.avatar_url end as peer_avatar_url
  from public.conversations c
  join public.profiles peer
    on peer.id = case
      when c.member_id = auth.uid() then c.provider_id else c.member_id
    end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

-- conversation_summaries: dropped and recreated (nothing selects from it), with
-- peer_avatar_url added and grants re-stated. Column order is otherwise the 012
-- shape.
drop view if exists public.conversation_summaries;

create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    pe.peer_display_name,
    coalesce(pe.peer_presence, 'hidden'::public.presence_choice) as peer_presence,
    pe.peer_last_active_at,
    pe.peer_avatar_url,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    (select case when m.voice_path is null then 'text' else 'voice' end
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_kind,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count,
    exists (select 1 from public.reviews r where r.conversation_id = c.id)
      as reviewed,
    (c.member_id = auth.uid()) as i_am_member
  from public.conversations c
  left join public.conversation_peers pe on pe.conversation_id = c.id
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;
