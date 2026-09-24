-- ===========================================================================
-- 151  Expired stories leave, and so does their media
-- ===========================================================================
-- Every read path already filters on expires_at (story_is_visible, 143), so an
-- expired story is gone for users the moment its 24 hours end. The two jobs
-- here are what make it gone from the DATABASE and the BUCKET too, which is
-- the part a "24 hours" promise is actually about.
--
-- ---------------------------------------------------------------------------
-- Why the bytes are not deleted here, in SQL
-- ---------------------------------------------------------------------------
-- The draft of this file deleted storage.objects rows itself, after lifting
-- Supabase's direct-delete guard with storage.allow_delete_query. That removes
-- the ROW and nothing else: "Deleting objects via a SQL query will not remove
-- the object from the bucket and will result in the object being orphaned."
-- The Storage API's own delete removes the row and then the object in the
-- backend store; no trigger does the second half for a SQL delete, which is
-- exactly what the guard's hint warns about. And once the row is gone the API
-- cannot find the object to remove it later. So every story photo and video
-- would have stayed in the object store for good, while this file said they
-- were gone.
-- https://supabase.com/docs/guides/storage/management/delete-objects
-- https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql
--
-- So the work is split where the capability is:
--
--   1. purge_expired_stories (SQL, hourly): deletes expired story ROWS. Views,
--      reactions, comments and comment reactions cascade with them; reports
--      keep their snapshot and have their references set null (150).
--   2. story_objects_to_purge (SQL, read-only): names the objects that should
--      go. The purge-story-media Edge Function pages through it and removes
--      each page with the Storage API, which deletes row and bytes together.
--      dispatch_story_media_purge calls that function from pg_cron.
--
-- An object goes when no story row names it, no report names it (evidence,
-- 150), and either its story row was deleted (story_media_released, below) or
-- it is older than 24 hours. The first case is a story the provider deleted
-- or the hourly job expired: its media goes within minutes rather than
-- waiting out the object's own 24 hours. The second is an upload whose
-- create_story never came; the 24 hour floor is 011/014's, and spares an
-- upload still in flight, which has no row yet either.
--
-- Nothing here is correctness for readers (reads already filter, and no
-- client can sign in the bucket, 144). It is the promise that the provider's
-- photo is not kept.

-- ---------------------------------------------------------------------------
-- 1. Which objects lost their story
-- ---------------------------------------------------------------------------
-- A story's media_path, recorded as its row is deleted, for any reason: the
-- provider's delete, the hourly expiry, or a cascade from account deletion.
-- Without it the purge could not tell "this object's story is gone" from
-- "this object's story has not been created yet", and would have to wait out
-- the 24 hour floor for both.
--
-- Statement-level with a transition table, so the hourly expiry of many rows
-- is one insert, not one per row.
-- https://www.postgresql.org/docs/16/sql-createtrigger.html
create table if not exists public.story_media_released (
  name        text        primary key,
  released_at timestamptz not null default now()
);

comment on table public.story_media_released is
  'Stories-bucket keys whose story row was deleted (151), for the media purge '
  'to remove promptly. Forgotten by purge_expired_stories once the object is '
  'gone. Server-only.';

alter table public.story_media_released enable row level security;
revoke all on public.story_media_released from anon, authenticated;

create or replace function public.stories_release_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.story_media_released (name)
  select g.media_path from gone g
  on conflict (name) do nothing;
  return null;
end;
$$;

revoke all on function public.stories_release_media() from public, anon, authenticated;

drop trigger if exists stories_release_media on public.stories;
create trigger stories_release_media
  after delete on public.stories
  referencing old table as gone
  for each statement
  execute function public.stories_release_media();

-- ---------------------------------------------------------------------------
-- 2. Expired rows
-- ---------------------------------------------------------------------------
-- Also forgets released names whose object is gone, which is how the media
-- purge's work shows up here: the Storage API has removed the object, so
-- there is nothing left for the name to point at. A name whose object a
-- report still holds stays until the report is purged and the object with it.
create or replace function public.purge_expired_stories()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stories   integer := 0;
  v_forgotten integer := 0;
begin
  with gone as (
    delete from public.stories
    where expires_at <= now()
    returning 1
  )
  select count(*)::int into v_stories from gone;

  -- Guarded like 094's purge: the pgTAP harness has no storage schema unless
  -- a suite builds one (563).
  if to_regclass('storage.objects') is not null then
    with forgotten as (
      delete from public.story_media_released m
      where not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'stories' and o.name = m.name
      )
      returning 1
    )
    select count(*)::int into v_forgotten from forgotten;
  end if;

  return json_build_object('stories', v_stories, 'forgotten', v_forgotten);
end;
$$;

comment on function public.purge_expired_stories() is
  'Hourly: deletes expired stories (cascading their views, reactions and '
  'comments) and forgets released media names whose object is gone. Never '
  'touches storage.objects: the bytes go through purge-story-media (151).';

revoke all on function public.purge_expired_stories() from public, anon, authenticated;
grant execute on function public.purge_expired_stories() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Which objects to remove
-- ---------------------------------------------------------------------------
-- Read-only, and at most 1000 names a call, which is what one Storage API
-- remove() accepts. Oldest first, so a backlog drains in order. The Edge
-- Function calls it again after each removal; what it removed no longer
-- exists, so the next call is the next page.
create or replace function public.story_objects_to_purge(p_limit integer default 1000)
returns table (object_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  return query
  select o.name::text
  from storage.objects o
  where o.bucket_id = 'stories'
    and (
      o.created_at < now() - interval '24 hours'
      or exists (select 1 from public.story_media_released m where m.name = o.name)
    )
    and not exists (select 1 from public.stories s where s.media_path = o.name)
    and not exists (
      select 1 from public.reports r where r.evidence_story_media_path = o.name
    )
  order by o.created_at, o.name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

comment on function public.story_objects_to_purge(integer) is
  'Stories-bucket objects no story row or report names, whose story was '
  'deleted or which are over 24 hours old. At most 1000. For the '
  'purge-story-media Edge Function, which removes them through the Storage '
  'API; service role only.';

revoke all on function public.story_objects_to_purge(integer) from public, anon, authenticated;
grant execute on function public.story_objects_to_purge(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Calling the Edge Function
-- ---------------------------------------------------------------------------
-- 009's dispatch, for 009's reasons. The function URL is configuration, so it
-- is a Vault secret created EMPTY here and filled out of band; the key is the
-- service-role secret every cron-to-function call already uses. Until both
-- are set the dispatch is a quiet no-op. Nothing to remove is the common
-- case, and it costs one query rather than an HTTP request and a cold start.
do $$
begin
  if to_regclass('vault.secrets') is null then
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'story_media_purge_url') then
    perform vault.create_secret('', 'story_media_purge_url',
      'Full https URL of the purge-story-media Edge Function');
  end if;
end
$$;

create or replace function public.dispatch_story_media_purge()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.story_objects_to_purge(1)) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'story_media_purge_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

comment on function public.dispatch_story_media_purge() is
  'pg_cron: calls purge-story-media when story_objects_to_purge has anything, '
  'with the Vault URL story_media_purge_url and push_sender_key. A no-op until '
  'both are set.';

revoke all on function public.dispatch_story_media_purge() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Schedules
-- ---------------------------------------------------------------------------
-- Rows hourly: housekeeping, not correctness, so there is no reason for 094's
-- nightly cadence to be tighter than this, nor for it to be the one-minute
-- tick billing needs. Media every ten minutes: a provider who deletes a story
-- should not have its photo kept for most of an hour, and a tick with nothing
-- to remove is one indexed query.
--
-- Guarded like 090's schedule, so the harness (no pg_cron) applies this file.
-- Unscheduled first so a replay does not stack jobs.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping the story purge schedules (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'purge-expired-stories') then
    perform cron.unschedule('purge-expired-stories');
  end if;
  perform cron.schedule(
    'purge-expired-stories',
    '17 * * * *',
    $cron$select public.purge_expired_stories()$cron$
  );

  if exists (select 1 from cron.job where jobname = 'purge-story-media') then
    perform cron.unschedule('purge-story-media');
  end if;
  perform cron.schedule(
    'purge-story-media',
    '*/10 * * * *',
    $cron$select public.dispatch_story_media_purge()$cron$
  );
end
$$;
