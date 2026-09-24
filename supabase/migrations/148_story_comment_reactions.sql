-- ===========================================================================
-- 148  The provider reacts to a comment, and the public comment feed
-- ===========================================================================
-- Owner's rule: the provider can react to a comment on their own story, for
-- example with a heart; one per comment, replaceable or removable; public,
-- like Instagram's "liked by creator". Nobody else can react to a comment.
--
-- This is the provider's one way of acknowledging a comment. It is a glyph
-- from 011's closed set, never text, so it cannot become the reply path 147
-- refuses to build.
--
-- One reaction per comment, and only one person can ever hold it, so the
-- comment id alone is the key. The provider_id column is not needed for
-- uniqueness; it is there so the row says who reacted without a join, and so
-- account deletion cascades from the person as well as from the comment.

create table if not exists public.story_comment_reactions (
  comment_id  uuid        primary key references public.story_comments(id) on delete cascade,
  provider_id uuid        not null references public.profiles(id) on delete cascade,
  emoji       text        not null check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏')),
  created_at  timestamptz not null default now()
);

comment on table public.story_comment_reactions is
  'The story provider''s single reaction to a comment on their own story '
  '(148). Written only by react_to_story_comment; readable by anyone who can '
  'see the comment.';

create index if not exists story_comment_reactions_provider
  on public.story_comment_reactions (provider_id);

alter table public.story_comment_reactions enable row level security;

-- Public exactly as far as the comment is.
drop policy if exists story_comment_reactions_select_visible on public.story_comment_reactions;
create policy story_comment_reactions_select_visible
  on public.story_comment_reactions
  for select to authenticated
  using (public.story_comment_is_visible(comment_id));

revoke all on public.story_comment_reactions from anon, authenticated;
grant select on public.story_comment_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Reacting
-- ---------------------------------------------------------------------------
-- NOT_FOUND for any comment the caller cannot see (deleted, expired story,
-- blocked author), before FORBIDDEN, so a non-provider cannot use this to
-- learn anything about a comment they have not been shown.
create or replace function public.react_to_story_comment(
  p_comment_id uuid,
  p_emoji      text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_provider  uuid;
  v_suspended timestamptz;
  v_existing  text;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if not public.story_comment_is_visible(p_comment_id) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  select s.provider_id into v_provider
  from public.story_comments c
  join public.stories s on s.id = c.story_id
  where c.id = p_comment_id;

  -- Only the story's own provider. A member stops here; any other provider
  -- cannot see the story (143) and already got NOT_FOUND.
  if v_provider is distinct from v_uid then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  select emoji into v_existing
  from public.story_comment_reactions
  where comment_id = p_comment_id;

  -- Same emoji again is removal, which the kill switch never blocks.
  if v_existing = p_emoji then
    delete from public.story_comment_reactions where comment_id = p_comment_id;
    return json_build_object('success', true, 'emoji', null);
  end if;

  if not public.stories_enabled() then
    return json_build_object('success', false, 'error', 'STORIES_DISABLED');
  end if;

  insert into public.story_comment_reactions (comment_id, provider_id, emoji)
  values (p_comment_id, v_uid, p_emoji)
  on conflict (comment_id) do update
    set emoji = excluded.emoji, created_at = now();

  return json_build_object('success', true, 'emoji', p_emoji);
exception
  when check_violation or not_null_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

comment on function public.react_to_story_comment(uuid, text) is
  'The story''s provider adds, replaces or (same emoji again) removes their one '
  'reaction on a comment on their own story. Nobody else.';

revoke all on function public.react_to_story_comment(uuid, text) from public, anon;
grant execute on function public.react_to_story_comment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A deleted comment takes its reaction with it
-- ---------------------------------------------------------------------------
-- The tombstone is an UPDATE, so the FK cascade never fires. Without this the
-- reaction would outlive the words it was a reaction to until the purge.
-- A trigger rather than a line in delete_story_comment, so it holds for the
-- service role and any future writer too.
create or replace function public.story_comment_tombstone_clears_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.story_comment_reactions where comment_id = new.id;
  return null;
end;
$$;

revoke all on function public.story_comment_tombstone_clears_reaction() from public, anon, authenticated;

drop trigger if exists story_comment_tombstone_clears_reaction on public.story_comments;
create trigger story_comment_tombstone_clears_reaction
  after update of deleted_at on public.story_comments
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.story_comment_tombstone_clears_reaction();

-- ---------------------------------------------------------------------------
-- 3. The public comment feed
-- ---------------------------------------------------------------------------
-- What a viewer's comment sheet reads: each visible comment, the commenter's
-- PUBLIC identity, and the provider's reaction if any.
--
-- Definer, like conversation_peers (103) and provider_directory (004), because
-- profiles RLS is owner-only; so the column list below IS the privacy boundary.
-- It widens 103's audience: 103 showed a member's username and avatar to the
-- one provider they talk to, and a public comment shows them to the story's
-- whole audience. That is the owner's rule for comments, and it moves no new
-- FIELD: the same two, display name and avatar, and nothing a member gave us
-- for identity, billing or safety (phone, email, birth date, age band, gender,
-- balance). No author_id either: `is_own` is all a client needs to offer
-- delete, and a stranger does not need a member's account id.
--
-- The two fields are narrowed further than 103 narrows them, because the
-- audience is strangers:
--   * the name is shown only once chosen: a member's display_name counts after
--     first-run setup (profile_completed_at, 040/122), a provider's always.
--     Anyone else is member_handle(), the same fallback every surface uses;
--   * the avatar is shown only if it is one of the bundled `clay:` avatars,
--     and never as a URL. avatar_url is client-writable (070's header), and a
--     URL check cannot tell our Storage host from a lookalike: the shape
--     `https://<any host>/storage/v1/object/public/avatars/...` is free to
--     anyone who owns a domain, so a commenter could make the phone of every
--     viewer who opens the comment sheet fetch a URL they control (IPs and
--     times), or show an image nobody moderated, since 038 lets any account
--     upload to `avatars`. Commenters are always members (147), and a
--     member's avatar is always a clay pick (useSetClayAvatar), so clay-only
--     costs nothing real. Anything else is null and the client draws the
--     initial.
--
-- security_barrier, because the view runs with its owner's rights and its
-- WHERE is the access control. Without the barrier the planner may evaluate
-- a caller's cheaper filter first, and a filter that raises, such as
-- `body::int = 0`, puts the body of a comment the caller may not see into the
-- error message. With it, the caller's filters only see rows that passed the
-- WHERE; leakproof ones like `story_id = X` are still pushed into the index.
-- https://www.postgresql.org/docs/16/rules-privileges.html
create or replace view public.story_comment_feed
with (security_invoker = false, security_barrier = true) as
  select
    c.id,
    c.story_id,
    c.body,
    c.created_at,
    coalesce(
      case when a.role = 'provider' or a.profile_completed_at is not null
           then nullif(btrim(a.display_name), '') end,
      public.member_handle(a.id)
    ) as author_display_name,
    case when a.avatar_url like 'clay:%' then a.avatar_url end as author_avatar_url,
    (c.author_id = auth.uid()) as is_own,
    cr.emoji as creator_reaction
  from public.story_comments c
  join public.profiles a on a.id = c.author_id
  left join public.story_comment_reactions cr on cr.comment_id = c.id
  where public.story_comment_is_visible(c.id);

comment on view public.story_comment_feed is
  'Public comments on stories the caller can see, with the commenter''s public '
  'name and clay avatar only (148). Definer with security_barrier: the WHERE is '
  'the access control and the column list is the privacy boundary. No author '
  'id, no phone, no email, no avatar URL.';

-- Read-only. The join makes the view non-updatable anyway, but the default
-- grants would still hand authenticated INSERT/UPDATE/DELETE on it, and 005's
-- rule is to state privileges rather than rely on a side effect.
revoke all on public.story_comment_feed from anon, authenticated;
grant select on public.story_comment_feed to authenticated;
