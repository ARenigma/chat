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
-- "Returns nothing about the author" has to hold for the ROW as well as for
-- the answer, and at first it did not. The block is an ordinary `blocks` row,
-- 005 let its owner read the whole row, and blocked_people (below) listed
-- blocked_id; so a provider could block through any comment, read the
-- commenter's account id, and delete the block again, leaving nothing behind
-- and the comment back on screen. That is the id 147 and 148 withhold from
-- every stranger on purpose (149's header says so), handed over on demand, and
-- an account id is the argument every id-taking RPC wants.
--
-- So a block carries an opaque HANDLE of its own, and the handle is what the
-- block list shows and what an unblock deletes by. And a client reads only the
-- block rows whose blocked account it already knows: a chat peer, whose id the
-- caller holds from the conversation (conversation_peers), or a provider,
-- whose id is public in provider_directory. useBlockedPeerIds hides a blocked
-- peer's thread and directory card by that id. A commenter blocked from a
-- story is neither, so that row is not the caller's to read at all, and the
-- block list shows it by handle with a null id.
--
-- Rows, not a column. This first revoked SELECT on blocked_id and granted the
-- other columns, and every installed build broke with it: their block set is
-- `from('blocks').select('*')` and their unblock `.delete().eq('blocked_id',
-- peer)`, and both answered "permission denied for table blocks", so a
-- blocked provider or thread came back on every phone that had not updated,
-- and could not be unblocked there (client_support has no floor to force the
-- update, 080). With the table grant kept and the rows filtered by the SELECT
-- policy, those two statements work as before for every block they could
-- ever have made, and find nothing of a commenter block, which no build
-- before this one can make.
-- https://www.postgresql.org/docs/16/sql-createpolicy.html
--
-- ---------------------------------------------------------------------------
-- Undoing it: how a provider unblocks someone they never chatted with
-- ---------------------------------------------------------------------------
-- By the handle, through unblock_by_handle below. Not a DELETE on the table:
-- a DELETE whose WHERE reads a column applies the SELECT policy too, which is
-- the point for a delete by account id (a commenter row is invisible to it,
-- so it removes nothing and confirms no guess) and would equally hide the
-- commenter row from a delete by handle. The function deletes the caller's
-- own row with that handle and nothing else, and answers the same whether or
-- not there was one. Suites 564 and 565 assert it.
--
-- FINDING the person to unblock did not work, and that is what the view below
-- fixes. The app has two unblock surfaces. The chat's SafetySheet needs a
-- conversation, and there is none here. BlockedUsersScreen resolved names by
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
-- The client (src/api/safety.ts, BlockedUsersScreen, SafetySheet) reads the
-- block set and the list from `blocked_people`, and unblocks by handle.
--
-- ---------------------------------------------------------------------------
-- And a viewer blocks a commenter
-- ---------------------------------------------------------------------------
-- Comments are public UGC, and Play's policy for it asks for in-app
-- functionality "to report users and content, and to block users" (answer
-- 9876937). A member could only report another member's comment: 096's
-- policy wants a shared conversation, and two members never have one
-- (conversations are member-provider). block_story_comment_author is the
-- viewer's path, the provider's own function's twin: any caller who can see
-- the comment blocks its author, by the comment, learning nothing about who
-- that is. story_comment_is_visible then hides every comment of theirs from
-- the caller (147).
-- https://support.google.com/googleplay/android-developer/answer/9876937
--
-- ---------------------------------------------------------------------------
-- share_conversation, closed
-- ---------------------------------------------------------------------------
-- 096 granted share_conversation(a, b) to authenticated for its INSERT
-- policy, and it answers for ANY two accounts: a provider holding a member's
-- id could ask it about every directory provider in turn and map who that
-- member talks to. 143's sweep (section 7) closed has_ever_recharged and
-- is_blocked_pair for the same reason and missed it. The policy and the view
-- now ask shares_conversation_with_me(other), which answers only about the
-- caller, and the two-argument function is the server's alone.

-- The handle. A volatile default, so every existing row gets its own value
-- when the column is added (the table is rewritten, as for any volatile
-- default).
-- https://www.postgresql.org/docs/16/sql-altertable.html#SQL-ALTERTABLE-NOTES
alter table public.blocks
  add column if not exists handle uuid not null default gen_random_uuid();

create unique index if not exists blocks_handle on public.blocks (handle);

comment on column public.blocks.handle is
  'Opaque id of one block (152), what the block list shows and an unblock '
  'deletes by, so the list never has to name a stranger''s account.';

-- Whether the caller shares a conversation with p_other, in either role:
-- 096's question, asked only about the caller. DEFINER so conversations RLS
-- does not filter it, as share_conversation is.
create or replace function public.shares_conversation_with_me(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.share_conversation(auth.uid(), p_other);
$$;

revoke all on function public.shares_conversation_with_me(uuid) from public, anon;
grant execute on function public.shares_conversation_with_me(uuid) to authenticated;

-- Whether the caller has blocked p_blocked AND already knows that account's
-- id: a chat peer, or a provider (the directory publishes provider ids). For
-- anyone the caller has not blocked it is false, so it is no oracle for
-- whether an arbitrary id is a provider.
create or replace function public.block_target_known_to_me(p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocks b
    join public.profiles p on p.id = b.blocked_id
    where b.blocker_id = auth.uid()
      and b.blocked_id = p_blocked
      and (p.role = 'provider' or public.shares_conversation_with_me(p_blocked))
  );
$$;

revoke all on function public.block_target_known_to_me(uuid) from public, anon;
grant execute on function public.block_target_known_to_me(uuid) to authenticated;

-- The owner's rows, less the ones naming an account the owner does not know
-- (the header). The table grant stays (005), so an installed build's
-- `select('*')` and delete by blocked_id keep working.
drop policy if exists "Owner reads own blocks" on public.blocks;
create policy "Owner reads own blocks"
  on public.blocks for select
  using (auth.uid() = blocker_id and public.block_target_known_to_me(blocked_id));

-- 096's rule, unchanged, through the caller-scoped question.
drop policy if exists "Owner creates own blocks" on public.blocks;
create policy "Owner creates own blocks"
  on public.blocks for insert
  with check (
    auth.uid() = blocker_id
    and public.shares_conversation_with_me(blocked_id)
  );

revoke execute on function public.share_conversation(uuid, uuid) from anon, authenticated;

-- An unblock, by the handle the list shows (the header says why it is not a
-- DELETE on the table). The caller's own row only; the same answer whether
-- or not there was one.
create or replace function public.unblock_by_handle(p_handle uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  delete from public.blocks where handle = p_handle and blocker_id = v_uid;

  return json_build_object('success', true);
end;
$$;

comment on function public.unblock_by_handle(uuid) is
  'Lift the caller''s own block with this handle (152), whichever path made '
  'it. Answers the same whether or not there was one.';

revoke all on function public.unblock_by_handle(uuid) from public, anon;
grant execute on function public.unblock_by_handle(uuid) to authenticated;

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

  -- Both profiles, in id order, before the insert's foreign key takes them
  -- blocker first: an account deletion's prologue takes profiles in id order
  -- (150), and the reverse of it could hold the one it waits on.
  perform 1 from public.profiles where id in (v_uid, v_author) order by id for key share;

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

-- The viewer's twin (the header). Visible is the whole test: a comment the
-- caller can read is one whose author the caller may block, and the answer
-- for any other is NOT_FOUND, the same as for a comment that does not exist.
-- Not the story's provider's path, which also works on deleted comments and
-- past expiry; the provider may use either.
create or replace function public.block_story_comment_author(p_comment_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if not public.story_comment_is_visible(p_comment_id) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  select c.author_id into v_author from public.story_comments c where c.id = p_comment_id;

  -- Your own comment: there is nobody to block, and you know whose it is.
  if v_author = v_uid then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  -- block_story_commenter's lock order.
  perform 1 from public.profiles where id in (v_uid, v_author) order by id for key share;

  insert into public.blocks (blocker_id, blocked_id)
  values (v_uid, v_author)
  on conflict (blocker_id, blocked_id) do nothing;

  return json_build_object('success', true);
end;
$$;

comment on function public.block_story_comment_author(uuid) is
  'Any caller who can see a story comment blocks its author, without the '
  'prior conversation 096 requires (two members never have one). Takes a '
  'comment id, returns nothing about the author (152).';

revoke all on function public.block_story_comment_author(uuid) from public, anon;
grant execute on function public.block_story_comment_author(uuid) to authenticated;

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
-- stranger 148 was written for: a name only once chosen, and only in a
-- name's shape (public_display_name), otherwise member_handle(); an avatar
-- only if it is a bundled `clay:` pick, never a URL. A provider's photo is the directory's to show; this list
-- draws an initial for them, as BlockedUsersScreen already does for everyone.
--
-- And no account id the caller did not already have. `handle` identifies the
-- row; `blocked_id` is there only for a provider, whose id the directory
-- publishes, or a person the caller shares a conversation with
-- (shares_conversation_with_me), and null for a commenter blocked from a
-- story (the header says why). The provider half is not optional: a member
-- who blocked a provider from the discovery card before 096 has no
-- conversation with them, and without the id useBlockedPeerIds could not
-- hide the provider's card, which came back on Home.
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
    b.handle,
    case when p.role = 'provider' or public.shares_conversation_with_me(b.blocked_id)
         then b.blocked_id end as blocked_id,
    -- The story surfaces' one name rule (148).
    public.public_display_name(p) as display_name,
    case when p.avatar_url like 'clay:%' then p.avatar_url end as avatar_url,
    b.created_at as blocked_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid();

comment on view public.blocked_people is
  'Everyone the caller has blocked, with public name and clay avatar only '
  '(152), whichever path created the block: a chat (096) or a story comment '
  '(block_story_commenter). Keyed by the block''s handle; blocked_id only for '
  'a provider or a conversation peer. Definer with security_barrier: the blocker_id = '
  'auth.uid() WHERE is the access control. What BlockedUsersScreen lists, so '
  'a block with no directory entry can still be undone.';

-- Read-only, stated rather than left to the join (148's reasoning). Unblocking
-- is unblock_by_handle, by the handle this lists.
revoke all on public.blocked_people from anon, authenticated;
grant select on public.blocked_people to authenticated;
