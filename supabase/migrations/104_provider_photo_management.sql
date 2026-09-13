-- 104_provider_photo_management.sql
--
-- A provider changes their face; a member looking at them sees it change.
--
-- Migration 070 built the whole write side and got the invariants right: one
-- primary per gallery (partial unique index + the BEFORE trigger that demotes),
-- a promoted survivor when the primary is deleted, `profiles.avatar_url`
-- mirrored by trigger, RLS reusing `provider_directory` as the visibility
-- boundary. None of that is touched here and none of it needs to be.
--
-- What 070 did NOT do is tell anyone. `provider_photos` is not in the
-- `supabase_realtime` publication, which was verified against the live project
-- on 2026-09-13:
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'public';
--   -- calls, conversations, message_reactions, messages,
--   -- paid_sessions, session_requests
--
-- A publication is not a default a client can work around: the WAL decoder
-- never emits a row for an unpublished table, so `on('postgres_changes', {table:
-- 'provider_photos'})` is a subscription that can only ever be silent. The whole
-- of the realtime half of this feature is that one line, plus the reading below
-- of what the socket will and will not carry.
-- https://supabase.com/docs/guides/realtime/postgres-changes
--
-- ---------------------------------------------------------------------------
-- What a member's socket actually receives, and why the client is written the
-- way it is
-- ---------------------------------------------------------------------------
-- INSERT and UPDATE are RLS-filtered per subscriber: "Realtime enforces RLS on
-- postgres_changes, so a client is only ever sent rows it could have selected"
-- is already the standing note in src/api/realtime.ts, and here that predicate
-- is `provider_photos_select` — `provider_id = auth.uid() or
-- provider_is_listed(provider_id)`. A member watching a listed provider is sent
-- the promotion; a member watching an unlisted one is sent nothing, which is the
-- same answer the table read gives them. No second copy of the rule.
--
-- DELETE is the exception, and the docs say so plainly: "RLS policies are not
-- applied to DELETE statements, because there is no way for Postgres to verify
-- that a user has access to a deleted record." The other half of the same page:
-- "You can only filter Delete events when tracking Postgres Changes if the table
-- has the `replica identity` set to `full`."
--
-- So there is a choice, and it is made here rather than left to whoever writes
-- the client next.
--
-- REPLICA IDENTITY IS DELIBERATELY LEFT AT `default` (the primary key), unlike
-- `messages` (003) and `calls` (011), which are `full`. Setting it to full is
-- the only way to filter deletes server-side — and because deletes skip RLS,
-- it is also a way to hand every authenticated subscriber the full deleted row
-- of EVERY provider's gallery, including a provider the directory does not show
-- them: id, provider_id, url, created_at. That is a standing broadcast of
-- "provider X removed this photo at time T" to anyone who opens a socket, in
-- exchange for a delete event the client can get another way.
--
-- The other way, which is what src/api/provider.ts does: bind DELETE with no
-- filter, receive the primary key alone, and match it against the gallery the
-- client is already holding in its React Query cache. A uuid that is not in the
-- cache is ignored, so the unfiltered binding leaks nothing it did not already
-- have, and a uuid that IS in the cache is proof the row mattered to this
-- viewer. The cost is one uuid per photo deletion platform-wide crossing a
-- socket that is only open while somebody is looking at a gallery.
--
-- And the case that matters most does not depend on the DELETE event at all.
-- Deleting the primary fires 070's AFTER trigger, which promotes the oldest
-- survivor — an UPDATE on a row that is still there, carrying a full new
-- record, RLS-filtered, on the filtered binding. The face never changes
-- silently; only an emptied gallery or a removed non-primary relies on the
-- uuid match.

-- ---------------------------------------------------------------------------
-- The one change
-- ---------------------------------------------------------------------------
-- Guarded so re-running on the hosted project is not an error, the same shape
-- 011 and 037 use. `alter publication ... add table` has no `if not exists`.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'provider_photos'
  ) then
    alter publication supabase_realtime add table public.provider_photos;
  end if;
end;
$$;

comment on table public.provider_photos is
  'A provider''s published gallery (070). Rows are the provider''s own to '
  'insert and delete; the only column a client may UPDATE is is_primary, and '
  'only upwards. Exactly one row per provider is primary while any row exists, '
  'and profiles.avatar_url mirrors it by trigger — the photos are '
  'authoritative and the scalar is the projection every other surface already '
  'reads. Published to supabase_realtime since 104 so a member watching a '
  'provider sees the face change without restarting; replica identity stays at '
  'the primary key on purpose, because DELETE events skip RLS and a full old '
  'row would broadcast every gallery''s deletions to every subscriber.';

-- ---------------------------------------------------------------------------
-- Nothing else. Two things that look like they belong here and do not.
-- ---------------------------------------------------------------------------
-- NO GRANT TO `anon`. 070 revoked it, and the reason is the boundary itself:
-- `provider_directory` grants SELECT to `authenticated` only — checked live on
-- 2026-09-13 — so a signed-out viewer is not shown the provider either, and a
-- gallery readable by anon would be strictly wider than the directory it is
-- supposed to mirror. The IMAGES are already public: 038's "Public read
-- avatars" policy is `for select to public` on a public bucket, so once a
-- surface does show a provider to a signed-out viewer, the objects render with
-- no change here. The row is the part that follows the directory, and it
-- already does.
--
-- NO CHANGE TO `profiles`. The mirrored scalar every other surface reads is not
-- published and must not be: `profiles` RLS is owner-only (001), so a member
-- could never be sent another person's row anyway, and the gallery event is the
-- same fact arriving through the boundary that is meant to carry it. The client
-- invalidates the directory query off the photo event instead.
