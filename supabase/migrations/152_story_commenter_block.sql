-- ===========================================================================
-- 152  A provider blocks a stranger who comments on their story
-- ===========================================================================
-- The block rules in 147 (a comment by someone blocked with the provider is
-- hidden from everyone, and a blocked member cannot post) only help if the
-- provider can create the block. 096 lets a block be inserted only between two
-- people who already share a conversation, so a stranger who found the
-- provider through discovery could post up to 20 comments an hour across
-- stories, and the provider's only tools were one-at-a-time deletes and
-- reports.
--
-- This is the narrow second path. It does NOT relax 096's policy, whose rule
-- is about a MEMBER blocking a provider they merely browsed (Amit,
-- 2026-09-10); it adds one DEFINER function by which the story's PROVIDER
-- blocks the AUTHOR of a comment on their own story. The comment is the
-- interaction 096 asks for, and it was started by the member.
--
-- It takes a COMMENT id and never a user id, for 005's reason: with a user id
-- it would block, and so confirm, any account at all. It returns nothing about
-- the author either, and answers the same way whether or not a block already
-- existed in either direction, so it cannot be used to learn who has blocked
-- whom.
--
-- Not gated on the kill switch, expiry, or whether the comment is still live:
-- a safety action has to keep working during an incident, and a provider who
-- deleted a comment first must still be able to block its author. Report
-- before blocking: once blocked, the author's comments are hidden from the
-- provider too (147), so report_story_comment will not find them.
--
-- "Returns nothing about the author" is about the answer. The block itself is
-- an ordinary `blocks` row, and 005 lets its owner read their own rows, so the
-- provider's block list now holds the commenter's account id, as every chat
-- block holds the peer's. That id is the handle an unblock deletes by; there
-- is no block list without it.
--
-- ---------------------------------------------------------------------------
-- Undoing it: how a provider unblocks someone they never chatted with
-- ---------------------------------------------------------------------------
-- The DELETE already works. 096 tightened only the INSERT policy; 005's
-- "Owner removes own blocks" is `auth.uid() = blocker_id` and nothing else,
-- so the client's existing unblock (useUnblockUser in src/api/safety.ts,
-- `delete from blocks where blocked_id = <id>`) lifts this block unchanged.
-- Suite 564 asserts it.
--
-- FINDING the person to unblock did not work, and that is what the view below
-- fixes. The app has two unblock surfaces. The chat's SafetySheet needs a
-- conversation, and there is none here. BlockedUsersScreen resolves names by
-- filtering the PROVIDER DIRECTORY (useProviders) by the block set, and a
-- commenter is always a member (147), never in the directory. So a block made
-- here was listed nowhere: the screen said "You haven't blocked anyone" and
-- the block could not be undone in the app, which Play's UGC policy requires
-- (the screen's own header comment). A provider who blocked a member from a
-- chat was already in the same place: ChatsListScreen and HomeScreen filter a
-- blocked peer's thread out, so its SafetySheet is out of reach too, and this
-- screen never listed a member. The view fixes both.
--
-- The name cannot come from anywhere the client can read today: profiles RLS
-- is owner-only for members, conversation_peers needs a conversation, and
-- story_comment_feed hides a blocked author's comments from the provider
-- (147) and never carries an author id (148). So `blocked_people` below lists
-- the caller's own blocks with the blocked person's public identity.
--
-- What the client must change, and nothing in this file changes it:
--   * src/api/safety.ts: a `useBlockedPeople()` query reading
--     `blocked_people` (blocked_id, display_name, avatar_url, blocked_at),
--     ordered by blocked_at desc, under a key that useBlockUser,
--     useUnblockUser and the story comment sheet's block_story_commenter call
--     all invalidate. block_story_commenter writes the row server-side, so
--     nothing refreshes the block list after it unless that caller does.
--   * src/screens/BlockedUsersScreen.tsx: render that query instead of the
--     `list` memo, which filters `useProviders()` by `useBlockedPeerIds()`,
--     key rows by blocked_id, pass blocked_id to `unblock.mutate`, and drop
--     the header note that a block with no directory entry "is not shown here
--     yet", which stops being true.
--   * src/lib/database.types.ts: the view's Row type (hand-maintained mirror).

create or replace function public.block_story_commenter(p_comment_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_author   uuid;
  v_provider uuid;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select c.author_id, s.provider_id into v_author, v_provider
  from public.story_comments c
  join public.stories s on s.id = c.story_id
  where c.id = p_comment_id;

  if v_author is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  -- Only the story's own provider: this is their tool for their audience.
  if v_provider is distinct from v_uid then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (v_uid, v_author)
  on conflict (blocker_id, blocked_id) do nothing;

  return json_build_object('success', true);
end;
$$;

comment on function public.block_story_commenter(uuid) is
  'The story''s provider blocks the author of a comment on their own story, '
  'without the prior conversation 096 requires. Takes a comment id, returns '
  'nothing about the author (152).';

revoke all on function public.block_story_commenter(uuid) from public, anon;
grant execute on function public.block_story_commenter(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's own block list, with names
-- ---------------------------------------------------------------------------
-- Definer, like story_comment_feed (148) and conversation_peers (103),
-- because profiles RLS is owner-only. So `where b.blocker_id = auth.uid()` is
-- the ENTIRE access control, and the column list is the privacy boundary.
--
-- The audience is one person, and every row is somebody they already saw:
-- blocking a member needs a shared conversation (096), where conversation_peers
-- showed the member's name, or a comment on the caller's own story (above),
-- where story_comment_feed did. Blocking a provider needs nothing beyond the
-- public directory. So the view shows no one new to anyone. It uses 148's
-- narrower rule rather than 103's, because a comment author is exactly the
-- stranger 148 was written for: a member's name only once chosen in first-run
-- setup, otherwise member_handle(); an avatar only if it is a bundled `clay:`
-- pick, never a URL. A provider's photo is the directory's to show; this list
-- draws an initial for them, as BlockedUsersScreen already does for everyone.
--
-- The blocked side never appears: a row where the caller is `blocked_id` is
-- not on this list, so it cannot tell anyone who has blocked them (005).
--
-- security_barrier for 148's reason: the WHERE is the access control, and
-- without the barrier a caller's own filter that raises could be evaluated on
-- rows the WHERE would have excluded, and put another user's block into an
-- error message.
-- https://www.postgresql.org/docs/16/rules-privileges.html
create or replace view public.blocked_people
with (security_invoker = false, security_barrier = true) as
  select
    b.blocked_id,
    coalesce(
      case when p.role = 'provider' or p.profile_completed_at is not null
           then nullif(btrim(p.display_name), '') end,
      public.member_handle(p.id)
    ) as display_name,
    case when p.avatar_url like 'clay:%' then p.avatar_url end as avatar_url,
    b.created_at as blocked_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid();

comment on view public.blocked_people is
  'Everyone the caller has blocked, with public name and clay avatar only '
  '(152), whichever path created the block: a chat (096) or a story comment '
  '(block_story_commenter). Definer with security_barrier: the blocker_id = '
  'auth.uid() WHERE is the access control. What BlockedUsersScreen lists, so '
  'a block with no directory entry can still be undone.';

-- Read-only, stated rather than left to the join (148's reasoning). Unblocking
-- stays a DELETE on public.blocks under 005's owner policy.
revoke all on public.blocked_people from anon, authenticated;
grant select on public.blocked_people to authenticated;
