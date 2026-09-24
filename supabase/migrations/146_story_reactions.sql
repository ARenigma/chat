-- ===========================================================================
-- 146  Reacting to a story
-- ===========================================================================
-- Free, one per member per story, replaceable, and from a closed set.
--
-- The set is 011's message set, byte for byte, including the U+2764 U+FE0F
-- heart that database.types.ts warns about. One allowlist for every reaction in
-- the product means one picker and one TypeScript union; a second, slightly
-- different set is how the heart ends up BAD_REQUEST on one surface only.
-- The closed set is also the safety argument, as in 011: free text rendered on
-- somebody else's content is an unmoderatable channel.
--
-- Two audiences, deliberately unequal (owner's rule):
--   * every viewer sees the COUNTS per emoji (story_reaction_counts);
--   * only the provider sees WHO (story_viewers, 149).
-- The base table therefore shows a member their own row and nothing else.
--
-- Members only: "members may leave reactions". A provider does not react to
-- their own story, and cannot see a competitor's at all (143).
--
-- Not published to realtime, for the same reason as 145.

create table if not exists public.story_reactions (
  story_id   uuid        not null references public.stories(id) on delete cascade,
  member_id  uuid        not null references public.profiles(id) on delete cascade,
  emoji      text        not null check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  -- One per member per story: changing your mind is an upsert and taking it
  -- back is a delete, exactly as message_reactions (011).
  primary key (story_id, member_id)
);

comment on table public.story_reactions is
  'A member''s one reaction to a story (146), from the 011 emoji set. Members '
  'read their own row; viewers get counts from story_reaction_counts; only the '
  'provider sees identities, through story_viewers.';

alter table public.story_reactions enable row level security;

drop policy if exists story_reactions_select_own on public.story_reactions;
create policy story_reactions_select_own
  on public.story_reactions
  for select to authenticated
  using (member_id = auth.uid());

revoke all on public.story_reactions from anon, authenticated;
grant select on public.story_reactions to authenticated;

-- ---------------------------------------------------------------------------
-- Toggling a reaction
-- ---------------------------------------------------------------------------
-- 011's semantics: the same emoji again takes it back, a different one
-- replaces, and the result is returned so an optimistic client can settle.
--
-- No rate limit, for 011's reason: one row per story bounds it, and nothing
-- here pushes a notification, so churn costs nobody anything.
create or replace function public.toggle_story_reaction(
  p_story_id uuid,
  p_emoji    text
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
  v_existing  text;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if not public.story_is_visible(p_story_id) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  select role::text, suspended_until into v_role, v_suspended
  from public.profiles where id = v_uid;

  -- The story's own provider is the one non-member who can see it, so this is
  -- the line that stops them; any other provider already got NOT_FOUND (143).
  if v_role is distinct from 'member' then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  select emoji into v_existing
  from public.story_reactions
  where story_id = p_story_id and member_id = v_uid;

  -- Taking a reaction back is removal, and the kill switch never blocks removal.
  if v_existing = p_emoji then
    delete from public.story_reactions
    where story_id = p_story_id and member_id = v_uid;
    return json_build_object('success', true, 'emoji', null);
  end if;

  if not public.stories_enabled() then
    return json_build_object('success', false, 'error', 'STORIES_DISABLED');
  end if;

  insert into public.story_reactions (story_id, member_id, emoji)
  values (p_story_id, v_uid, p_emoji)
  on conflict (story_id, member_id) do update
    set emoji = excluded.emoji, created_at = now();

  -- Reacting is seeing. Recorded here so the provider's viewer list (149) is a
  -- superset of the people who reacted, whatever order the client calls in.
  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, v_uid)
  on conflict (story_id, viewer_id) do nothing;

  return json_build_object('success', true, 'emoji', p_emoji);
exception
  -- The emoji CHECK, caught rather than re-listed (011).
  when check_violation or not_null_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

comment on function public.toggle_story_reaction(uuid, text) is
  'Add, replace or (same emoji again) remove the caller''s reaction to a '
  'visible story. Members only; adding is refused while stories are switched '
  'off, removing never is.';

revoke all on function public.toggle_story_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_story_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The public aggregate
-- ---------------------------------------------------------------------------
-- Counts, never identities: the return type has no column that could carry a
-- member. Empty for a story the caller cannot see, the same answer as a story
-- nobody has reacted to.
--
-- A reactor who is now blocked with the provider is not counted. That keeps
-- the public number equal to what the provider's own list adds up to (149
-- drops blocked pairs too), so the two screens never disagree.
create or replace function public.story_reaction_counts(p_story_id uuid)
returns table (emoji text, reaction_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select r.emoji, count(*)::int as reaction_count
  from public.stories s
  join public.story_reactions r on r.story_id = s.id
  where s.id = p_story_id
    and public.story_is_visible(s.id)
    and not public.is_blocked_pair(s.provider_id, r.member_id)
  group by r.emoji
  order by count(*) desc, r.emoji;
$$;

comment on function public.story_reaction_counts(uuid) is
  'Public reaction counts per emoji for a visible story. No identities.';

revoke all on function public.story_reaction_counts(uuid) from public, anon;
grant execute on function public.story_reaction_counts(uuid) to authenticated;
