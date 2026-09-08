-- 093_repair_storage_purge_functions.sql
--
-- Both nightly purge crons have been failing since 2026-09-05 with:
--   "Direct deletion from storage tables is not allowed. Use the Storage API instead."
-- Supabase added a block on DELETE FROM storage.objects. The fix is
-- storage.delete_objects(bucket_id, paths[]), which is the authorised path.
--
-- The query logic is unchanged from migrations 011 and 014; only the deletion
-- mechanism changes.

create or replace function public.purge_orphaned_voice_notes()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_paths text[];
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- Orphaned: no live message reference and no moderation evidence copy,
  -- older than 24 hours (to spare in-flight uploads the composer holds open).
  select array_agg(o.name)
    into v_paths
  from storage.objects o
  where o.bucket_id = 'voice-notes'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.messages m where m.voice_path = o.name)
    and not exists (select 1 from public.reports r where r.evidence_voice_path = o.name);

  if v_paths is null or array_length(v_paths, 1) = 0 then
    return 0;
  end if;

  -- storage.delete_objects() is Supabase's authorised deletion path; calling it
  -- instead of DELETE FROM storage.objects is what the error message requires.
  perform storage.delete_objects('voice-notes', v_paths);
  v_count := array_length(v_paths, 1);
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
  v_paths text[];
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- Orphaned: no live message reference, older than 24 hours.
  select array_agg(o.name)
    into v_paths
  from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at < now() - interval '24 hours'
    and not exists (select 1 from public.messages m where m.attachment_path = o.name);

  if v_paths is null or array_length(v_paths, 1) = 0 then
    return 0;
  end if;

  perform storage.delete_objects('attachments', v_paths);
  v_count := array_length(v_paths, 1);
  return v_count;
end;
$$;

-- Grants: unchanged from originals in migrations 011 and 014.
revoke all on function public.purge_orphaned_voice_notes() from public, anon, authenticated;
grant execute on function public.purge_orphaned_voice_notes() to service_role;

revoke all on function public.purge_orphaned_attachments() from public, anon, authenticated;
grant execute on function public.purge_orphaned_attachments() to service_role;
