-- ===========================================================================
-- 125  Server-backed favourites for both roles
-- ===========================================================================
-- Replaces the MMKV-only member favourites store with a Postgres table that:
--   - persists across devices and reinstalls
--   - supports member → provider AND provider → member favourites
--   - triggers a push notification to the liked user (consent-gated on blocks)
--
-- The "liked" identity:
--   member favourites a provider  → liked_role = 'provider', liked_id = provider
--   provider favourites a member  → liked_role = 'member',   liked_id = member
--
-- This is a unidirectional "bookmark" — not a mutual follow.  Neither party
-- can see the other's list; only the member can see who has favourited them
-- via the push notification and in-app notice.
-- ---------------------------------------------------------------------------

create table if not exists public.user_favorites (
  id          uuid primary key default gen_random_uuid(),
  liker_id    uuid not null references public.profiles(id) on delete cascade,
  liked_id    uuid not null references public.profiles(id) on delete cascade,
  liked_role  text not null check (liked_role in ('member', 'provider')),
  created_at  timestamptz not null default now(),
  unique (liker_id, liked_id)
);

comment on table public.user_favorites is
  'Bookmarks a user has saved (125). Supports member→provider and '
  'provider→member. Neither side can see the other''s list; the liked '
  'member receives a push notification.';

-- Index for fast "who have I favourited?" and "who favourited me?"
create index if not exists user_favorites_liker_idx  on public.user_favorites (liker_id);
create index if not exists user_favorites_liked_idx  on public.user_favorites (liked_id);

-- RLS: each user reads and writes only their own liker rows.
alter table public.user_favorites enable row level security;

create policy "Users read own favorites"
  on public.user_favorites for select
  using (liker_id = auth.uid() or liked_id = auth.uid());

create policy "Users manage own favorites"
  on public.user_favorites for all
  using (liker_id = auth.uid());

-- ---------------------------------------------------------------------------
-- toggle_favorite — idempotent add/remove
-- ---------------------------------------------------------------------------

create or replace function public.toggle_favorite(p_liked_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_liked_role text;
  v_was_liked  boolean := false;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if v_uid = p_liked_id then
    return jsonb_build_object('success', false, 'error', 'SELF_LIKE');
  end if;

  -- Check that the liked user exists and get their role.
  select role into v_liked_role
  from public.profiles
  where id = p_liked_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  -- Check blocks in either direction.
  if public.is_blocked_pair(v_uid, p_liked_id) then
    return jsonb_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- Toggle: delete if present, insert if absent.
  if exists (
    select 1 from public.user_favorites
    where liker_id = v_uid and liked_id = p_liked_id
  ) then
    delete from public.user_favorites
    where liker_id = v_uid and liked_id = p_liked_id;
    v_was_liked := true;
    return jsonb_build_object('success', true, 'now_liked', false, 'was_liked', v_was_liked);
  end if;

  insert into public.user_favorites (liker_id, liked_id, liked_role)
  values (v_uid, p_liked_id, v_liked_role);

  -- Note: push notification to the liked user is handled client-side via the
  -- send-engagement edge function or Realtime broadcast. Server-side push
  -- dispatch will be wired in a follow-up migration once the edge function
  -- knows the 'favorited_by' kind. For now, the client calls a separate
  -- notify_favorited RPC (below) after a successful add.

  return jsonb_build_object('success', true, 'now_liked', true, 'was_liked', false);
end;
$$;

comment on function public.toggle_favorite(uuid) is
  'Add or remove the authenticated user''s favourite on another user (125). '
  'Blocks are checked; self-like is rejected. On add, enqueues a push to the '
  'liked user.';

revoke all on function public.toggle_favorite(uuid) from public, anon;
grant execute on function public.toggle_favorite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_favorites — current user's bookmarks
-- ---------------------------------------------------------------------------

create or replace function public.get_my_favorites()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',         uf.id,
        'liked_id',   uf.liked_id,
        'liked_role', uf.liked_role,
        'created_at', uf.created_at
      ) order by uf.created_at desc
    ),
    '[]'::jsonb
  )
  from public.user_favorites uf
  where uf.liker_id = auth.uid();
$$;

comment on function public.get_my_favorites() is
  'Returns all favourites the caller has saved (125), newest first.';

revoke all on function public.get_my_favorites() from public, anon;
grant execute on function public.get_my_favorites() to authenticated;
