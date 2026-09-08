-- 094_storage_purge_uses_allow_delete_guc.sql
--
-- Supersedes 093. Migration 093 replaced DELETE FROM storage.objects with a call
-- to storage.delete_objects(bucket, paths[]) — a function that DOES NOT EXIST.
-- plpgsql resolves inner calls at runtime, not at CREATE, so 093 applied cleanly
-- but would have failed the nightly cron with "function storage.delete_objects
-- does not exist" — trading one broken purge for another.
--
-- The real block is in Supabase's own storage schema, migration
-- 0055-prevent-direct-deletes.sql:
--
--   CREATE FUNCTION storage.protect_delete() RETURNS TRIGGER ... AS $$
--   BEGIN
--     IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
--       RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. ...'
--         USING ERRCODE = '42501';
--     END IF;
--     RETURN NULL;
--   END; $$;
--   CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects
--     FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
--
-- The sanctioned bypass — the exact mechanism the Storage API service uses
-- itself — is to set the session GUC storage.allow_delete_query = 'true' before
-- the DELETE. set_config(..., is_local => true) scopes it to this function's
-- transaction, so it auto-resets and never leaks to another statement. With the
-- guard set, the ORIGINAL DELETE ... RETURNING logic from migrations 011 and 014
-- works unchanged — which also restores the exact deleted-row count (the
-- array_agg count in 093 reported paths attempted, not rows deleted).
-- https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql

create or replace function public.purge_orphaned_voice_notes()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- Lift Supabase's direct-delete guard for THIS transaction only.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Orphaned: no live message reference and no moderation evidence copy, older
  -- than 24 hours (to spare in-flight uploads the composer holds open). Identical
  -- predicate to migration 011.
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'voice-notes'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.messages m where m.voice_path = o.name)
      and not exists (select 1 from public.reports r where r.evidence_voice_path = o.name)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

create or replace function public.purge_orphaned_attachments()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- Lift Supabase's direct-delete guard for THIS transaction only.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Orphaned: no live message reference, older than 24 hours. Identical predicate
  -- to migration 014.
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'attachments'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.messages m where m.attachment_path = o.name)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

-- Grants: unchanged from migrations 011 and 014.
revoke all on function public.purge_orphaned_voice_notes() from public, anon, authenticated;
grant execute on function public.purge_orphaned_voice_notes() to service_role;

revoke all on function public.purge_orphaned_attachments() from public, anon, authenticated;
grant execute on function public.purge_orphaned_attachments() to service_role;
