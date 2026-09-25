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
--      go. claim_story_objects_to_purge records a page of those names as
--      claimed and hands them to the purge-story-media Edge Function, which
--      removes each page with the Storage API, deleting row and bytes
--      together. dispatch_story_media_purge calls that function from pg_cron.
--
-- An object goes when no LIVE story names it, no report names it (evidence,
-- 150), and either its story row was deleted (story_media_released, section
-- 1) or it is older than 24 hours, which an expired story's always is. The first case is a story the provider
-- deleted or the hourly job expired: its media goes within minutes rather
-- than waiting out the object's own 24 hours. The second is an upload whose
-- create_story never came; the 24 hour floor is 011/014's, and spares an
-- upload still in flight, which has no row yet either.
--
-- Nothing here is correctness for readers (reads already filter, and no
-- client can sign in the bucket, 144). It is the promise that the provider's
-- photo is not kept, and the other half of it: that a LIVE story's photo is
-- never removed. Listing and removing are two steps, in two systems, with no
-- transaction around them, so what makes the second safe is that a name, once
-- listed, can no longer be posted (section 3, and create_story in 143).

-- ---------------------------------------------------------------------------
-- 1. Which objects lost their story
-- ---------------------------------------------------------------------------
-- A story's media_path, recorded in story_media_released (143) as its row is
-- deleted, for any reason: the provider's delete, the hourly expiry, or a
-- cascade from account deletion. Without it the purge could not tell "this
-- object's story is gone" from "this object's story has not been created
-- yet", and would have to wait out the 24 hour floor for both. And from the
-- moment it is recorded, create_story refuses the name and the story id, so
-- a retry of the create that made it cannot bring the row back while the
-- purge is removing the object.
--
-- Statement-level with a transition table, so the hourly expiry of many rows
-- is one insert, not one per row. A name already there (claimed by the purge,
-- section 3) keeps its row and has its clock restarted, for section 2.
-- https://www.postgresql.org/docs/16/sql-createtrigger.html
create or replace function public.stories_release_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.story_media_released (name)
  select g.media_path from gone g
  on conflict (name) do update set released_at = now();
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
--
-- Not the moment the object is gone, though: a day after the name was last
-- released or claimed. Forgetting is what lets create_story accept the name
-- again, and a purge run that claimed it can still be on its way to remove():
-- two runs can overlap (the cron tick does not wait for the last one), so
-- run A can remove the object and this job forget the name while run B,
-- holding the same claim, has yet to call remove(). A new upload under the
-- name in that gap would be removed as a live story's media. A run is bounded
-- by the Edge Function wall clock, 150s on the free plan and 400s on paid, so
-- a day is far past any claim still in flight, and the table stays at about a
-- day of deletes.
-- https://supabase.com/docs/guides/functions/limits
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
      where m.released_at < now() - interval '24 hours'
        and not exists (
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
  'comments) and forgets released media names a day after their last claim, '
  'once the object is gone. Never touches storage.objects: the bytes go '
  'through purge-story-media (151).';

revoke all on function public.purge_expired_stories() from public, anon, authenticated;
grant execute on function public.purge_expired_stories() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Which objects to remove
-- ---------------------------------------------------------------------------
-- Read-only, and at most 1000 names a call, which is what one Storage API
-- remove() accepts. Oldest first, so a backlog drains in order. This is the
-- question; claim_story_objects_to_purge, below, is what the Edge Function
-- calls, and asks it under a lock.
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
    -- A LIVE story's row, not any row: an expired story nobody may read any
    -- more (143's read-time filter) used to shield its object until the
    -- hourly row sweep reached it, so the bytes stayed up to about 70 minutes
    -- past the 24 hours. That matters beyond tidiness: deleting the object is
    -- the only thing that stops a CDN-cached signed URL (story-media-url),
    -- so the ten-minute tick now takes it at the first run after expiry.
    and not exists (
      select 1 from public.stories s
      where s.media_path = o.name and s.expires_at > now()
    )
    and not exists (
      select 1 from public.reports r where r.evidence_story_media_path = o.name
    )
  order by o.created_at, o.name
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end;
$$;

comment on function public.story_objects_to_purge(integer) is
  'Stories-bucket objects no live story and no report names, whose story was '
  'deleted or which are over 24 hours old. At most 1000. Read-only: the '
  'purge-story-media Edge Function takes its names through '
  'claim_story_objects_to_purge; service role only.';

revoke all on function public.story_objects_to_purge(integer) from public, anon, authenticated;
grant execute on function public.story_objects_to_purge(integer) to service_role;

/*
 * The list, claimed: what the Edge Function removes, and nothing else.
 *
 * Listing and removing are two calls in two systems. Unclaimed, a name listed
 * here could gain a story row before the Storage API removed it, and the live
 * story lost its media (Greptile P1 on bb32af4): a create_story retried with
 * the id of a story the provider had deleted, or one finishing a day-old
 * upload. So every name handed out is first written to story_media_released,
 * which create_story refuses from then on, and the decision and the record
 * happen under the lock create_story takes shared (143): a create that
 * committed first is seen here as a story row and its object is not named; a
 * create that comes after finds the name claimed and is refused. Between this
 * call and remove(), nothing can point a story at a name it returned.
 *
 * A name claimed again (a remove() that failed, or overlapping runs) has its
 * clock restarted, so it is not forgotten while a run holding it may still be
 * removing it (section 2).
 */
create or replace function public.claim_story_objects_to_purge(p_limit integer default 1000)
returns table (object_name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_names text[];
begin
  perform pg_advisory_xact_lock(hashtextextended('story_media_purge', 0));

  -- A statement after the lock, so its snapshot sees every create_story that
  -- held the lock before this one got it.
  select coalesce(array_agg(p.object_name order by p.n), '{}')
    into v_names
  from public.story_objects_to_purge(p_limit) with ordinality as p(object_name, n);

  insert into public.story_media_released (name)
  select unnest(v_names)
  on conflict (name) do update set released_at = now();

  return query select unnest(v_names);
end;
$$;

comment on function public.claim_story_objects_to_purge(integer) is
  'story_objects_to_purge, recorded in story_media_released under the lock '
  'create_story takes shared, so no story can be created on a name returned '
  'here before it is removed. For the purge-story-media Edge Function; service '
  'role only.';

revoke all on function public.claim_story_objects_to_purge(integer) from public, anon, authenticated;
grant execute on function public.claim_story_objects_to_purge(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Calling the Edge Function
-- ---------------------------------------------------------------------------
-- 009's dispatch, for 009's reasons. The key is the service-role secret every
-- cron-to-function call already uses. The URL needs no step of its own: it is
-- derived from push_sender_url (story_media_purge_endpoint, below), and the
-- secret created EMPTY here only overrides it for a project whose functions
-- live elsewhere. Nothing to remove is the common case, and it costs one query
-- rather than an HTTP request and a cold start.
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

/*
 * Where the purge function lives, without a second secret to set by hand.
 *
 * A fresh deploy used to create story_media_purge_url empty and schedule the
 * job anyway, so every run was a quiet no-op until somebody filled the secret
 * in: expired rows went, their files stayed in Storage forever (Greptile P1 on
 * 7a9de76). Every project already has push_sender_url set to one of its own
 * Edge Functions (009), so the purge function's URL is that URL with the
 * function name swapped. An explicit story_media_purge_url still wins, for a
 * project whose functions live elsewhere. NULL only when neither is usable,
 * and the dispatcher then says so in the database log instead of staying
 * silent.
 */
create or replace function public.story_media_purge_endpoint(
  p_explicit        text,
  p_push_sender_url text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when nullif(btrim(p_explicit), '') is not null then btrim(p_explicit)
    when p_push_sender_url ~ '^https://[^/]+/functions/v1/[A-Za-z0-9_-]+([?#].*)?$'
      then regexp_replace(
        p_push_sender_url,
        '/functions/v1/[A-Za-z0-9_-]+([?#].*)?$',
        '/functions/v1/purge-story-media'
      )
    else null
  end
$$;

revoke all on function public.story_media_purge_endpoint(text, text) from public, anon, authenticated;
grant execute on function public.story_media_purge_endpoint(text, text) to service_role;

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

  v_url := public.story_media_purge_endpoint(
    (select decrypted_secret from vault.decrypted_secrets where name = 'story_media_purge_url'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_sender_url')
  );
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';

  if v_url is null or v_key is null or v_key = '' then
    -- Files are waiting and nothing can remove them: loud, not a quiet no-op.
    raise warning 'story media purge: % file(s) waiting but no purge endpoint or key is configured (set push_sender_url and push_sender_key, or story_media_purge_url)',
      (select count(*) from public.story_objects_to_purge(1000));
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
-- And reports daily. purge_expired_reports (005, 150) was only ever run by
-- hand (`moderate purge`), which was a retention policy for the report rows
-- alone. It is now also the only thing that frees a reported story's media:
-- the media purge keeps every object a report names for as long as the
-- report exists (story_objects_to_purge), so an unscheduled report purge
-- kept a dismissed report's photo in the bucket indefinitely, past the 24
-- hours the story promised. Daily, since its unit is 90 days.
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

  if exists (select 1 from cron.job where jobname = 'purge-expired-reports') then
    perform cron.unschedule('purge-expired-reports');
  end if;
  perform cron.schedule(
    'purge-expired-reports',
    '41 3 * * *',
    $cron$select public.purge_expired_reports()$cron$
  );
end
$$;
