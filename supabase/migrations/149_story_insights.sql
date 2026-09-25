-- ===========================================================================
-- 149  What the provider sees about their own stories
-- ===========================================================================
-- Owner's rule: the provider sees the viewer list, the reactions and the
-- comments for each of their stories. Comments are already public and the
-- provider reads them from story_comment_feed like everyone else (148), so
-- this file adds the two things only the provider may see:
--
--   * story_viewers: who watched one story, when, and what each reacted.
--     This is the ONLY place a reactor's identity is readable, which is what
--     makes "only the provider sees who reacted" true;
--   * my_story_insights: one row per live story with its counts, for the
--     provider's own tray.
--
-- Both refuse anyone but the provider, and both drop blocked pairs, so a
-- provider is never shown the name of someone either of them has blocked.
--
-- Identity fields follow story_comment_feed's rules (148): a chosen name or
-- the handle, and an avatar_url only when it is a clay pick, never a URL a
-- viewer could have pointed at their own server. And no account id: the list
-- used to return each viewer's profiles.id, and every commenter is a viewer
-- (post_story_comment records the view, 147), so it handed the provider the
-- member ids 148 and 152 withhold on purpose ("a stranger does not need a
-- member's account id"), ready for any RPC that takes one. The provider
-- reads a viewer by name, as the audience reads a commenter; the client has
-- no use for the id, and a list of names needs no row key beyond its order. Viewers are members, as
-- commenters are: only a member can see somebody else's story (143), and
-- mark_story_viewed records nobody else. So a member's rules are the only
-- ones needed, and there is no branch for a provider's photo. (The draft had
-- one, when any account could watch; a competitor in the viewer list was the
-- case it served, and the owner's "any member" removed that case.)

create or replace function public.story_viewers(p_story_id uuid)
returns table (
  display_name text,
  avatar_url   text,
  viewed_at    timestamptz,
  reaction     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Raised rather than returned empty: an empty list is a real answer ("no one
  -- has watched yet") and must not also mean "you may not ask".
  if v_uid is null or not exists (
    select 1 from public.stories s
    where s.id = p_story_id
      and s.provider_id = v_uid
      and s.expires_at > now()
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select
    -- The feed's name rule (148), so the provider reads no name the audience
    -- could not.
    public.public_display_name(p),
    case when p.avatar_url like 'clay:%' then p.avatar_url end,
    v.viewed_at,
    r.emoji
  from public.story_views v
  join public.profiles p on p.id = v.viewer_id
  left join public.story_reactions r
    on r.story_id = v.story_id and r.member_id = v.viewer_id
  where v.story_id = p_story_id
    and not public.is_blocked_pair(v_uid, v.viewer_id)
  order by v.viewed_at desc, v.viewer_id;
end;
$$;

comment on function public.story_viewers(uuid) is
  'The provider''s viewer list for one of their live stories, with each '
  'viewer''s reaction. The only read of reactor identity. avatar_url is a clay '
  'pick or null, never a URL. FORBIDDEN (42501) for anyone but the story''s '
  'provider.';

revoke all on function public.story_viewers(uuid) from public, anon;
grant execute on function public.story_viewers(uuid) to authenticated;

-- Counts use the same filters as the lists they summarise, so a number on the
-- provider's tray always equals the length of the list it opens.
create or replace function public.my_story_insights()
returns table (
  story_id       uuid,
  media_type     text,
  created_at     timestamptz,
  expires_at     timestamptz,
  view_count     integer,
  reaction_count integer,
  comment_count  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.media_type,
    s.created_at,
    s.expires_at,
    (select count(*)::int from public.story_views v
      where v.story_id = s.id
        and not public.is_blocked_pair(s.provider_id, v.viewer_id)),
    (select count(*)::int from public.story_reactions r
      where r.story_id = s.id
        and not public.is_blocked_pair(s.provider_id, r.member_id)),
    -- story_comment_is_visible's filters (147), a suspended or banned
    -- author's comments included, since the feed hides those too.
    (select count(*)::int from public.story_comments c
      join public.profiles a on a.id = c.author_id
      where c.story_id = s.id
        and c.deleted_at is null
        and (a.suspended_until is null or a.suspended_until <= now())
        and not public.is_blocked_pair(s.provider_id, c.author_id))
  from public.stories s
  where s.provider_id = auth.uid()
    and s.expires_at > now()
  order by s.created_at;
$$;

comment on function public.my_story_insights() is
  'One row per live story of the caller''s, with view, reaction and comment '
  'counts filtered exactly as story_viewers and story_comment_feed filter.';

revoke all on function public.my_story_insights() from public, anon;
grant execute on function public.my_story_insights() to authenticated;
