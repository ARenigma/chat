-- ===========================================================================
-- 147  Public comments on a story, and no way to reply
-- ===========================================================================
-- Owner's rules: members comment for free; comments are PUBLIC to everyone who
-- can see the story, Instagram-style, under the commenter's public name; the
-- provider CANNOT reply, because paid chat is the only conversation channel
-- and a free reply thread under every story would be a free chat.
--
-- So there is no provider branch in the writer, and no second writer. The
-- provider's tools on a comment are delete (here), report (150), a single
-- reaction (148) and blocking its author (152). That is the whole surface.
--
-- ---------------------------------------------------------------------------
-- Why a comment is a TOMBSTONE when deleted, not a DELETE
-- ---------------------------------------------------------------------------
-- The rate limits below count rows. If deleting removed the row, post-five,
-- delete-five, post-five would walk straight through a per-story limit, and
-- public comments are exactly where that kind of flooding lands. So a deleted
-- comment keeps its id, author and time, loses its body, and stops being
-- visible to anyone. The rows go when the story is purged (151).
-- 103 made the same choice for messages, for a different reason.
--
-- Because the body is gone the moment it is deleted, a provider who wants the
-- comment reported must report it BEFORE it is erased; 150 gives
-- delete_story_comment an optional report reason that does both in one
-- transaction.
--
-- ---------------------------------------------------------------------------
-- Who sees which comment
-- ---------------------------------------------------------------------------
-- A comment is visible when its story is visible to the caller AND neither
-- blocked pair is involved:
--   * caller vs author: the owner's rule, blocked pairs neither see nor post;
--   * provider vs author: a member the provider has blocked (or who blocked
--     the provider) cannot keep a public comment standing on that provider's
--     story. It disappears for everyone, including the provider, which also
--     means the provider is never shown the words of someone they blocked.
-- A caller cannot tell a comment hidden by a block from a deleted one; both
-- simply are not there.
--
-- ---------------------------------------------------------------------------
-- The base table is not readable by clients at all
-- ---------------------------------------------------------------------------
-- Its rows carry author_id, and the public read deliberately does not: a
-- stranger has no use for a member's account id, and story_comment_feed (148)
-- exposes `is_own` instead. So there is exactly one read surface, the feed,
-- and its column list is the privacy boundary. Nothing that runs as the
-- caller needs the table: story_comment_is_visible and every writer are
-- DEFINER.
--
-- ---------------------------------------------------------------------------
-- Realtime: not published, and cannot be as it stands
-- ---------------------------------------------------------------------------
-- postgres_changes delivers whole rows to subscribers who can SELECT the
-- table, so publishing it would need a client grant and would hand out
-- author_id, which is the thing the paragraph above withholds. If live
-- comments are wanted, send a Broadcast signal from a trigger (story id only)
-- and have the client re-read the feed. Replica identity FULL would be worse
-- still: DELETE events skip RLS (104's note), so every purged comment's body
-- would reach every subscriber.
-- https://supabase.com/docs/guides/realtime/postgres-changes

create table if not exists public.story_comments (
  id         uuid        primary key default gen_random_uuid(),
  story_id   uuid        not null references public.stories(id) on delete cascade,
  author_id  uuid        not null references public.profiles(id) on delete cascade,
  body       text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Live: 1-500 characters with at least one visible one, and at most 5 line
  -- breaks (6 lines). 500 is room for a real sentence or three and not for a
  -- pasted wall; Instagram's 2,200 is sized for a caption box, not for a
  -- public reply under somebody's photo. The line cap is what stops 500
  -- characters being spent on height instead. "Visible" is 143's
  -- story_text_trim, the same rule the caption uses, and so is the refusal of
  -- control characters (143, section 0), which matters most here: a comment
  -- is what a stranger writes and a report copies into the operator's queue.
  -- Tombstone: no body at all, so a deleted comment is really gone.
  constraint story_comment_body_or_tombstone check (
    (deleted_at is null and body is not null
      and public.story_text_trim(body) is not null
      and length(body) <= 500
      and public.story_text_line_breaks(body) <= 5
      and not public.story_text_has_control(body))
    or (deleted_at is not null and body is null)
  )
);

comment on table public.story_comments is
  'A member''s public comment on a story (147). Written only by '
  'post_story_comment; deleted (tombstoned) only by delete_story_comment, by '
  'its author or the story''s provider. Not readable by clients: the public '
  'read, with names and without author ids, is story_comment_feed (148).';

-- The feed reads a story's comments in order; the rate limits read one
-- author's recent comments.
create index if not exists story_comments_story_created
  on public.story_comments (story_id, created_at);
create index if not exists story_comments_author_created
  on public.story_comments (author_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 1. The visibility predicate
-- ---------------------------------------------------------------------------
-- Takes a COMMENT id, never an (author, provider) pair: with a pair it would
-- answer "are these two blocked" for anyone, which is 005's disclosure.
--
-- And never a suspended or banned author's. A provider is hidden from the
-- audience the moment they are suspended (provider_is_listed carries 004's
-- boundary), and a commenter used to have no such line: the operator banned a
-- member over a minor_safety comment and every viewer still read it until the
-- story expired. A ban is a suspension with no end (moderate.mjs), so the one
-- test covers both, and lifting the suspension brings the comments back,
-- which is what an appeal that succeeds should do. The same clause is in
-- my_story_insights' count (149), so the number on the tray matches the sheet.
create or replace function public.story_comment_is_visible(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.story_comments c
    join public.stories s on s.id = c.story_id
    join public.profiles a on a.id = c.author_id
    where c.id = p_comment_id
      and c.deleted_at is null
      and (a.suspended_until is null or a.suspended_until <= now())
      and public.story_is_visible(s.id)
      and not public.is_blocked_pair(auth.uid(), c.author_id)
      and not public.is_blocked_pair(s.provider_id, c.author_id)
  );
$$;

comment on function public.story_comment_is_visible(uuid) is
  'Whether the caller may see this comment: not deleted, its author not '
  'suspended or banned, its story visible to the caller, and the author '
  'blocked with neither the caller nor the provider.';

revoke all on function public.story_comment_is_visible(uuid) from public, anon;
grant execute on function public.story_comment_is_visible(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS and grants
-- ---------------------------------------------------------------------------
-- Comments are public to the story's audience, as the owner asked, but through
-- story_comment_feed (148) and not through this table (see the header). RLS
-- stays on with no policy, so even a grant added by mistake reads nothing.
--
-- No INSERT, UPDATE or DELETE grant either: both writers are RPCs, because
-- posting needs the block check (not callable from a policy) and a lock for
-- the rate limit, and deleting has to be a tombstone.
alter table public.story_comments enable row level security;

revoke all on public.story_comments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Posting
-- ---------------------------------------------------------------------------
-- Two limits, both counting tombstones (see the header):
--   * 5 per member per story, over the story's whole day, so one person
--     cannot bury one story. Not per hour: an hourly window refills, which is
--     5 an hour and 120 over the story's life from one account;
--   * 20 per member per hour across all stories, so one person cannot carpet
--     the whole tray.
-- Generous for a person, since there is no reply to answer, and useless for a
-- script. Taken under a per-author lock so two parallel posts cannot both
-- read 4.
--
-- The client names the comment, as it names a story (create_story, 143) and
-- a message (081's nonce): p_comment_id is a v4 uuid minted once per comment
-- and resent on every retry. Without it, a post whose response was lost was
-- posted again by the retry, a second identical public comment under the
-- story that also spent a second unit of the 5 and the 20 below. Checked
-- under the author's lock and before the count, so a retry of a comment that
-- landed is the original success, even with the budget now spent, and never
-- a second row; the same id from another account is BAD_REQUEST, which tells
-- that account nothing about whose it is.
create or replace function public.post_story_comment(
  p_comment_id uuid,
  p_story_id   uuid,
  p_body       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text;
  v_suspended timestamptz;
  -- NULL for blank and blank-looking alike (143, section 0).
  v_trimmed   text := public.story_text_trim(p_body);
  v_on_story  integer;
  v_in_hour   integer;
  v_comment   public.story_comments%rowtype;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if p_comment_id is null then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  -- Blank is refused up front; length and line breaks by the CHECK, caught
  -- below, so the numbers are stated once.
  if v_trimmed is null then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  -- The caller's own profile first, FOR KEY SHARE, the lock the insert's
  -- foreign key check would take anyway, but before anything takes the story.
  -- The insert used to lock the story (its foreign key) and then this
  -- profile, the reverse of an account deletion (150), whose prologue holds
  -- the peer's profile FOR UPDATE and whose cascade then reaches the story:
  -- each held what the other waited on. Taken first, this waits for that
  -- deletion to commit and then finds the story gone (566's 24).
  -- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS
  perform 1 from public.profiles where id = v_uid for key share;

  -- A blocked member lands here too: the story is not visible to them, and
  -- NOT_FOUND does not say why.
  if not public.story_is_visible(p_story_id) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  select role::text, suspended_until into v_role, v_suspended
  from public.profiles where id = v_uid;

  -- THE no-reply rule. The story's own provider can see the story, so this is
  -- the line that stops them; every other provider cannot see it (143) and
  -- got NOT_FOUND above.
  if v_role is distinct from 'member' then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  if not public.user_has_accepted_current_policies(v_uid) then
    return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
  end if;

  if not public.stories_enabled() then
    return json_build_object('success', false, 'error', 'STORIES_DISABLED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('story_comment:' || v_uid::text, 0));

  -- A retry after a lost response is the comment already posted (above).
  select * into v_comment from public.story_comments where id = p_comment_id;
  if found then
    if v_comment.author_id <> v_uid then
      return json_build_object('success', false, 'error', 'BAD_REQUEST');
    end if;
    return json_build_object(
      'success', true,
      'comment_id', v_comment.id,
      'created_at', v_comment.created_at
    );
  end if;

  select
    count(*) filter (where story_id = p_story_id)::int,
    count(*) filter (where created_at > now() - interval '1 hour')::int
  into v_on_story, v_in_hour
  from public.story_comments
  where author_id = v_uid
    and (story_id = p_story_id or created_at > now() - interval '1 hour');

  if v_on_story >= 5 or v_in_hour >= 20 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  insert into public.story_comments (id, story_id, author_id, body)
  values (p_comment_id, p_story_id, v_uid, v_trimmed)
  returning * into v_comment;

  -- Commenting is seeing, as reacting is (146).
  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, v_uid)
  on conflict (story_id, viewer_id) do nothing;

  return json_build_object(
    'success', true,
    'comment_id', v_comment.id,
    'created_at', v_comment.created_at
  );
exception
  -- Over 500 characters, over 5 line breaks, or a control character:
  -- story_comment_body_or_tombstone.
  when check_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  -- The same id posted at the same moment by another account, under its own
  -- author lock: the id check above cannot see an uncommitted row, the
  -- primary key can.
  when unique_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

comment on function public.post_story_comment(uuid, uuid, text) is
  'The only writer of story_comments. Members only (so never the story''s '
  'provider: there is no reply path); 1-500 visible characters, at most 5 '
  'line breaks; 5 per member per story and 20 per member per hour; refused '
  'while stories are switched off. Idempotent on the client-minted comment '
  'id: a retry returns the original, another account''s id is BAD_REQUEST.';

revoke all on function public.post_story_comment(uuid, uuid, text) from public, anon;
grant execute on function public.post_story_comment(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deleting
-- ---------------------------------------------------------------------------
-- The author deletes their own; the story's provider deletes any on their
-- story. Nobody else. Not gated on the kill switch, on blocks, or on expiry:
-- removal must always work, and a provider must be able to take down a
-- comment from someone they are about to block.
--
-- 150 replaces this with a version that can file a report first, once the
-- reports table has its story columns; the rules here carry over unchanged.
create or replace function public.delete_story_comment(p_comment_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_author   uuid;
  v_provider uuid;
  v_deleted  timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select c.author_id, s.provider_id, c.deleted_at
    into v_author, v_provider, v_deleted
  from public.story_comments c
  join public.stories s on s.id = c.story_id
  where c.id = p_comment_id
  for update of c;

  if v_author is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_author and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  -- Already gone is success: the client's intent is satisfied.
  if v_deleted is null then
    update public.story_comments
    set body = null, deleted_at = now()
    where id = p_comment_id;
  end if;

  return json_build_object('success', true);
end;
$$;

comment on function public.delete_story_comment(uuid) is
  'Tombstone a story comment: its author or the story''s provider only. '
  'Idempotent; never gated on the kill switch, blocks or expiry.';

revoke all on function public.delete_story_comment(uuid) from public, anon;
grant execute on function public.delete_story_comment(uuid) to authenticated;
