-- ===========================================================================
-- 144  Where story media lives, and who can fetch it
-- ===========================================================================
-- A private bucket, like `voice-notes` (011) and `attachments` (014), and NOT a
-- public one like `avatars` (038). A public object URL is readable by anyone
-- who has it, forever, which would make both the 24 hours and the block rule
-- true in the app and false on the wire.
--
-- A private bucket alone does not make them true either, and this file used to
-- say it did. The Storage API applies RLS when it SIGNS a URL and never when it
-- SERVES one: getSignedObject checks the token's signature, path and expiry and
-- then reads the object as the super user. And expiresIn has a floor of 1 and
-- no ceiling, so with a client SELECT policy any viewer could mint a URL good
-- for a year while the story was visible, and it would keep serving after the
-- story expired, after the provider deleted it, and after a block, for as long
-- as the object existed.
-- https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedURL.ts
-- https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedObject.ts
--
-- So there is NO client SELECT policy on this bucket, and no client can sign
-- anything in it. The one signer is the story-media-url Edge Function: it asks
-- for the story row with the caller's own JWT (stories RLS is story_is_visible,
-- 143), and only if the row comes back does it sign that row's media_path with
-- the service role, for 60 seconds at most and never past the story's expiry.
-- The client never chooses the lifetime.
--
-- The 60 seconds bound the MINTING of a link, not how long one already fetched
-- keeps serving, and this file used to say it bounded both. The Smart CDN (Pro
-- and above) keeps serving a cached response "for the same signed URL ...
-- even if the token in that URL has already expired", for as long as the
-- asset is cached, and drops it when the object is updated or deleted. So a
-- link a viewer already opened lasts until the OBJECT goes: the provider's
-- delete, or the first media purge tick after the 24 hours (151 no longer
-- lets an expired row shield its object); a block deletes nothing and does
-- not cut off a link already held. Every new link still needs the row.
-- https://supabase.com/docs/guides/storage/cdn/smart-cdn
--
-- The upload policy is a plain SQL function rather than an inline expression,
-- and the bucket and policy are installed by a function rather than a bare DO
-- block, for one reason: the pgTAP harness has no storage schema, so this
-- migration skips them there. Suite 563 builds a stand-in storage schema and
-- then calls install_stories_bucket(), so the bucket row and the policy it
-- asserts against are the ones this file creates, not a copy of them in a test.
--
-- Upload needs INSERT only; upsert would additionally need SELECT and UPDATE,
-- and there is deliberately no UPDATE policy, so an object cannot be swapped
-- after it has been seen or reported. No DELETE policy either, for 014's
-- evidence reason: removal is the purge's job (151), through the Storage API.
-- https://supabase.com/docs/guides/storage/security/access-control

-- ---------------------------------------------------------------------------
-- 1. The upload predicate
-- ---------------------------------------------------------------------------
-- The provider's own folder, a name create_story would accept, and only while
-- they could post. "Could post" is create_story's own test, story_post_refusal
-- (143), and not a copy of it: without it the bucket is 50 MB of free private
-- storage for any signed-in account, which is a hosting service nobody asked
-- to run. The copy this used to hold checked the listing and the kill switch
-- and forgot the policy gate, so a listed provider who had not accepted the
-- current terms could upload what they could never post (Greptile P1 on
-- bb32af4). With one function the two cannot disagree again.
create or replace function public.story_media_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and split_part(p_name, '/', 1) = auth.uid()::text
    and p_name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|mp4)$'
    and public.story_post_refusal() is null;
$$;

comment on function public.story_media_upload_allowed(text) is
  'storage.objects INSERT predicate for the stories bucket: the caller''s own '
  '{uid}/{uuid}.{ext} name, and a caller create_story would accept '
  '(story_post_refusal: listed, unsuspended, policies accepted, stories on).';

revoke all on function public.story_media_upload_allowed(text) from public, anon;
grant execute on function public.story_media_upload_allowed(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The bucket and its policy
-- ---------------------------------------------------------------------------
-- Guarded, and the policy goes through EXECUTE, for 011's reason: the harness
-- has no storage schema and a bare `create policy on storage.objects` would not
-- even parse there. Idempotent, so replaying it (563 does) puts the bucket row
-- back the way this file says it is, whatever was edited by hand since.
--
-- The draft of this file created a client SELECT policy, "Viewers read visible
-- stories". It is dropped here by name and never re-created (see the header),
-- so a database that ran the draft ends in the same state as one that did not.
--
-- Not callable by any client role: it is run once, below, by the migration,
-- and by the test suite as the owner.
create or replace function public.install_stories_bucket()
returns void
language plpgsql
set search_path = public
as $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent, skipping the stories bucket (expected in the test harness)';
    return;
  end if;

  -- 50 MB: thirty seconds of phone video at 1080p/30 is roughly 20-40 MB, so a
  -- real clip fits and a feature film does not. The mime list matches the
  -- extensions story_media_path_is_scoped allows, one for one. Both limits are
  -- enforced by the Storage API at upload, not by Postgres.
  -- https://supabase.com/docs/guides/storage/uploads/file-limits
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('stories', 'stories', false, 52428800,
          array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 52428800,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

  execute $p$drop policy if exists "Viewers read visible stories" on storage.objects$p$;

  execute $p$drop policy if exists "Listed providers upload own stories" on storage.objects$p$;
  execute $p$
    create policy "Listed providers upload own stories"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'stories'
        and public.story_media_upload_allowed(name)
      )
  $p$;
end;
$$;

comment on function public.install_stories_bucket() is
  'Creates the private stories bucket and its one storage.objects policy, '
  'upload, when a storage schema exists (144). No client SELECT policy: media '
  'is signed only by the story-media-url function. Idempotent; owner-only.';

revoke all on function public.install_stories_bucket() from public, anon, authenticated, service_role;

select public.install_stories_bucket();
