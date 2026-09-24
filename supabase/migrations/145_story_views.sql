-- ===========================================================================
-- 145  Who has seen a story
-- ===========================================================================
-- One row per viewer per story, written by mark_story_viewed. Two readers, and
-- they see different things:
--
--   * the viewer reads their OWN rows, which is how the tray knows which rings
--     are already seen;
--   * the provider reads the viewer list through story_viewers (149), which
--     joins public names and drops blocked pairs. There is no base-table path
--     for the provider, so the block rule is applied in one place.
--
-- Not published to realtime: a live viewer count is not a feature anyone asked
-- for, and DELETE events (cascades from a purged story) skip RLS (104).

create table if not exists public.story_views (
  story_id  uuid        not null references public.stories(id) on delete cascade,
  viewer_id uuid        not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  -- One per pair, so marking twice is a no-op rather than a second row, and a
  -- view count is a row count.
  primary key (story_id, viewer_id)
);

comment on table public.story_views is
  'First view of a story by a person (145). Written only by mark_story_viewed '
  '(and implicitly by reacting or commenting). Viewers read their own rows; '
  'the provider reads the list through story_viewers.';

-- The seen-ring lookup is "my rows"; the PK already serves the provider's list.
create index if not exists story_views_viewer
  on public.story_views (viewer_id, story_id);

alter table public.story_views enable row level security;

drop policy if exists story_views_select_own on public.story_views;
create policy story_views_select_own
  on public.story_views
  for select to authenticated
  using (viewer_id = auth.uid());

revoke all on public.story_views from anon, authenticated;
grant select on public.story_views to authenticated;

-- ---------------------------------------------------------------------------
-- Marking a story seen
-- ---------------------------------------------------------------------------
-- Idempotent by construction (the PK), and silent about stories the caller
-- cannot see: NOT_FOUND for a missing, expired or blocked story alike, so the
-- answer cannot be used to probe for any of the three.
--
-- The provider's own views are not recorded. A creator checking their own
-- story is not an audience, and counting it would put them in their own list.
create or replace function public.mark_story_viewed(p_story_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_provider uuid;
  v_inserted integer;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if not public.story_is_visible(p_story_id) then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  select provider_id into v_provider from public.stories where id = p_story_id;
  if v_provider = v_uid then
    return json_build_object('success', true, 'first_view', false);
  end if;

  insert into public.story_views (story_id, viewer_id)
  values (p_story_id, v_uid)
  on conflict (story_id, viewer_id) do nothing;
  get diagnostics v_inserted = row_count;

  return json_build_object('success', true, 'first_view', v_inserted = 1);
end;
$$;

comment on function public.mark_story_viewed(uuid) is
  'Record that the caller has seen a visible story. Idempotent; the provider''s '
  'own views are not recorded; NOT_FOUND for anything the caller cannot see.';

revoke all on function public.mark_story_viewed(uuid) from public, anon;
grant execute on function public.mark_story_viewed(uuid) to authenticated;
