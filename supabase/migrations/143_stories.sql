-- ===========================================================================
-- 143  A provider posts a story, and it lasts a day
-- ===========================================================================
-- Owner's rules (2026-09-25), final: providers post photo and video stories
-- that live for 24 hours; "any member can see" a LISTED provider's active
-- stories, which is discovery; blocked pairs see nothing of each other. The
-- audience is the member ROLE, the word he used next to "sp" for providers,
-- so another provider (listed or an applicant) sees no one's stories but
-- their own (story_is_visible, section 3).
-- This file is the story row itself and the one predicate every later story
-- file reads. Views (145), reactions (146), comments (147-148), insights (149),
-- reports (150) and expiry (151) hang off it.
--
-- ---------------------------------------------------------------------------
-- The shape of the write, and why the CLIENT names the story
-- ---------------------------------------------------------------------------
-- The media is uploaded first, to `stories/{provider_id}/{story_id}.{ext}`, and
-- only then is the row created. So the id must exist before the row does, and
-- the client mints it (a v4 uuid, the same way it mints a message nonce, 081).
-- The alternative, a server id and a rename after upload, needs a storage move
-- the Storage API does not do atomically and a window in which the object
-- exists under a name no row claims.
--
-- create_story is the ONLY writer. There is no INSERT or UPDATE grant: the
-- listed-provider test, the kill switch and the active-story cap all have to
-- hold at the moment of the write, and an RLS policy cannot take a lock.
--
-- ---------------------------------------------------------------------------
-- Realtime: deliberately NOT published
-- ---------------------------------------------------------------------------
-- The story tray is read when it is opened and a new story is not an event a
-- viewer has to be interrupted by. Publishing would also broadcast DELETE
-- events, which skip RLS (104's note), i.e. "provider X removed a story at T"
-- to every subscriber. If the tray ever needs to be live, add the table to
-- supabase_realtime with replica identity left at the primary key, as 104 did.

-- ---------------------------------------------------------------------------
-- 0. What counts as text in a public caption or comment
-- ---------------------------------------------------------------------------
-- btrim() removes spaces and nothing else, so a caption or comment made of
-- newlines, tabs, no-break spaces or zero-width characters passed a "not
-- blank" check and rendered as an empty bar, or as 500 empty lines in a public
-- comment sheet. Three helpers, shared by the caption (here) and the comment
-- body (147), so both surfaces mean the same thing by "blank" and by "text":
--
--   * story_text_trim: strips Unicode white space and zero-width characters
--     from both ends, and is NULL when nothing visible is left. "Visible"
--     excludes the characters that render as nothing on their own: format and
--     bidi controls, variation selectors, tag characters, and the Hangul and
--     Braille fillers that are the usual way to post a blank that is not
--     empty. Variation selectors and tags only ever count against a whole
--     string and are never cut from its edges, because a trailing U+FE0F is
--     half of the heart emoji and a trailing tag is the end of a flag.
--   * story_text_line_breaks: counts line breaks, CRLF as one, the Unicode
--     line and paragraph separators included, so a length cap cannot be
--     spent on height instead.
--   * story_text_has_control: true when the text holds a C0 or C1 control
--     character other than tab and the line breaks above. A control is not
--     blank to story_text_trim (DEL, U+007F, counts as visible), and it is
--     not text either: a comment made of DEL is an empty comment in every
--     viewer's sheet, and ESC starts a terminal escape sequence, so a report
--     that copies it into evidence_body (150) can erase or rewrite lines of
--     the operator's terminal when scripts/moderate.mjs prints it. So both
--     CHECKs REFUSE a control anywhere in the text rather than trimming it,
--     and an ESC inside otherwise visible words is refused as well.
--
-- Code points are written as ARE hex escapes (\xhhh) rather than as
-- [[:space:]], whose meaning for non-ASCII characters depends on the
-- database's LC_CTYPE, and rather than as literal characters, which are
-- invisible in review by definition.
-- https://www.postgresql.org/docs/16/functions-matching.html#POSIX-ESCAPE-SEQUENCES
create or replace function public.story_text_trim(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_text ~ '[^\x9\xa\xb\xc\xd\x20\x85\xa0\x115f\x1160\x1680\x180e\x2000-\x200f\x2028-\x202f\x205f-\x206f\x2800\x3000\x3164\xfe00-\xfe0f\xfeff\xffa0\xe0000-\xe007f]'
    then regexp_replace(p_text, '^[\x9\xa\xb\xc\xd\x20\x85\xa0\x1680\x2000-\x200b\x2028\x2029\x202f\x205f\x3000\xfeff]+|[\x9\xa\xb\xc\xd\x20\x85\xa0\x1680\x2000-\x200b\x2028\x2029\x202f\x205f\x3000\xfeff]+$', '', 'g')
  end;
$$;

comment on function public.story_text_trim(text) is
  'Trims white space and zero-width characters from both ends; NULL when no '
  'visible character is left. The one meaning of "blank" for story captions '
  '(143) and story comments (147).';

create or replace function public.story_text_line_breaks(p_text text)
returns integer
language sql
immutable
parallel safe
as $$
  select cardinality(regexp_split_to_array(p_text, '\xd\xa|[\xa\xb\xc\xd\x85\x2028\x2029]')) - 1;
$$;

comment on function public.story_text_line_breaks(text) is
  'Line breaks in a caption or comment, CRLF counted once.';

-- Tab (\x9) and the line breaks story_text_line_breaks counts (\xa-\xd, and
-- NEL \x85) are allowed; every other C0 and C1 code point is not. NUL needs no
-- range: a Postgres text value cannot hold it.
create or replace function public.story_text_has_control(p_text text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_text ~ '[\x1-\x8\xe-\x1f\x7f-\x84\x86-\x9f]';
$$;

comment on function public.story_text_has_control(text) is
  'Whether a caption or comment holds a C0/C1 control other than tab and the '
  'line breaks. Refused by both CHECKs (143, 147): a control renders as '
  'nothing, and ESC rewrites the terminal moderate.mjs prints evidence to.';

-- Called by the CHECKs below, so the RPCs' owner and the service role need it.
-- Harmless to anyone, but granted the repo's way rather than left to PUBLIC.
revoke all on function public.story_text_trim(text) from public, anon;
grant execute on function public.story_text_trim(text) to authenticated, service_role;
revoke all on function public.story_text_line_breaks(text) from public, anon;
grant execute on function public.story_text_line_breaks(text) to authenticated, service_role;
revoke all on function public.story_text_has_control(text) from public, anon;
grant execute on function public.story_text_has_control(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.stories (
  -- No default: see the header. create_story takes it from the client.
  id           uuid        primary key,
  provider_id  uuid        not null references public.profiles(id) on delete cascade,
  media_type   text        not null check (media_type in ('image', 'video')),
  media_path   text        not null,
  caption      text,
  -- How long the viewer holds this frame. For an image it is the display time
  -- (7s default, WhatsApp's is about the same); for a video it is the clip's
  -- own length, reported by the picker and trusted for the reason 011 trusts
  -- voice_duration_ms: lying about it buys nothing, and the 50 MB bucket
  -- ceiling (144) is what actually bounds the upload.
  duration_ms  integer     not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,

  -- The storage read policy (144) authorises on the row that names the object,
  -- so the name has to be exactly the one the provider's own folder allows and
  -- the extension has to agree with the declared type. Spelled out as the full
  -- set of legal names rather than a regex, so there is nothing to misread.
  constraint story_media_path_is_scoped check (
    (media_type = 'image' and media_path in (
      provider_id::text || '/' || id::text || '.jpg',
      provider_id::text || '/' || id::text || '.jpeg',
      provider_id::text || '/' || id::text || '.png',
      provider_id::text || '/' || id::text || '.webp'
    ))
    or (media_type = 'video'
        and media_path = provider_id::text || '/' || id::text || '.mp4')
  ),
  -- 200 characters and at most 3 line breaks (4 lines): a caption is a line
  -- over a full-screen photo, not a post. Blank, including blank-looking (see
  -- section 0), is stored as NULL by create_story, so a caption bar with
  -- nothing visible in it never renders. A control character is refused, not
  -- trimmed (section 0).
  constraint story_caption_is_short check (
    caption is null
    or (public.story_text_trim(caption) is not null
        and length(caption) <= 200
        and public.story_text_line_breaks(caption) <= 3
        and not public.story_text_has_control(caption))
  ),
  -- Images 1-15s, videos 1-30s. The 30s video ceiling is the owner's rule; a
  -- longer clip is refused rather than silently cut.
  constraint story_duration_in_range check (
    (media_type = 'image' and duration_ms between 1000 and 15000)
    or (media_type = 'video' and duration_ms between 1000 and 30000)
  ),
  -- Exactly a day. Subtraction rather than `created_at + interval`, because
  -- timestamptz + interval is only STABLE (day arithmetic follows TimeZone),
  -- while timestamptz - timestamptz is IMMUTABLE and '1 day' = '24 hours' as
  -- intervals compare.
  -- https://www.postgresql.org/docs/16/functions-datetime.html
  constraint story_lasts_a_day check (expires_at - created_at = interval '24 hours')
);

comment on table public.stories is
  'A provider''s 24-hour photo or video story (143). Written only by '
  'create_story; readable while unexpired by the provider and by members, '
  'while the provider is listed and the two are not blocked '
  '(story_is_visible). Media lives in the private `stories` bucket at '
  'media_path (144), reached only through the story-media-url function; '
  'expired rows are purged by purge_expired_stories and their objects '
  'removed through the Storage API by purge-story-media (151).';

-- The tray reads "this provider's live stories, oldest first" and the purge
-- reads "everything past expiry".
create index if not exists stories_provider_created
  on public.stories (provider_id, created_at);
create index if not exists stories_expires_at
  on public.stories (expires_at);
-- The storage read policy looks a row up by the object's name.
create unique index if not exists stories_media_path
  on public.stories (media_path);

-- ---------------------------------------------------------------------------
-- 2. The kill switch
-- ---------------------------------------------------------------------------
-- Read from the same place start_call reads video_calls_enabled (044, 132):
-- admin.config_active, domain kill_switches, environment prod. ON when the key
-- is missing, so a database that has never published it does not ship with
-- stories switched off, and a rolling deploy cannot turn them off by accident.
--
-- Registered the way video_calls_enabled is: a boolean field in the admin
-- console's registry (admin/lib/config-registry.ts, default true) AND the key
-- published ON below, as 044 published the call controls. Both halves are
-- needed. The console seeds its form from the active payload and validates a
-- draft against the registry, which requires every field and refuses unknown
-- ones. Without the field, a published key would make every kill_switches
-- draft fail as "Unknown field". Without the published key, the switch would
-- open drawn as Disabled while this function reads ON, and every draft would
-- fail as "Stories is required" until an operator touched a control they
-- never meant to change. With both, the switch shows the real state and a
-- publish of any other kill switch carries this one forward.
--
-- What it stops: everything that ADDS content (a story, a comment, a reaction).
-- What it never stops: reading, deleting, and reporting. An operator reaching
-- for this switch during an abuse wave needs removal and reports to keep
-- working, not to stop with everything else.
create or replace function public.stories_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, admin
as $$
  select coalesce(
    (select (payload ->> 'stories_enabled')::boolean
     from admin.config_active
     where domain = 'kill_switches' and environment = 'prod'),
    true
  );
$$;

comment on function public.stories_enabled() is
  'kill_switches.stories_enabled from admin.config_active (prod), true when '
  'absent. Gates every write that adds story content; never reads, deletes '
  'or reports.';

-- Internal: called only from the SECURITY DEFINER story writers. The client
-- reads the same flag through get_public_config('kill_switches').
revoke all on function public.stories_enabled() from public, anon, authenticated;
grant execute on function public.stories_enabled() to service_role;

-- Publish the key ON in both environments, 044's block with one change.
-- Config history is append-only (ADR-0023): supersede the active version,
-- publish a new one carrying every unrelated kill switch, move the pointer,
-- audit it. The change: an environment whose active payload already has the
-- key is left alone, so a replay, or a database where it was published by
-- hand, keeps the operator's value and gains no empty version.
do $$
declare
  v_env  text;
  v_id   uuid;
  v_old  uuid;
  v_ver  bigint;
  v_sha  text;
  v_kill jsonb;
begin
  foreach v_env in array array['staging', 'prod'] loop
    select version_id, payload
      into v_old, v_kill
    from admin.config_active
    where domain = 'kill_switches'
      and environment = v_env;

    if v_kill ? 'stories_enabled' then
      continue;
    end if;

    v_kill := coalesce(v_kill, '{}'::jsonb)
      || jsonb_build_object('stories_enabled', true);

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded', superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1
      into v_ver
    from admin.config_versions
    where domain = 'kill_switches'
      and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_kill::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'kill_switches', v_env, v_ver, 'active',
       v_kill, v_sha, now(),
       'migration_143', 'migration_143', now(),
       'Register the stories kill switch');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('kill_switches', v_env, v_id, v_kill, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', 'kill_switches', v_id, 'migration_143',
       'stories_enabled=true (' || v_env || ')');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Who can see a story
-- ---------------------------------------------------------------------------
-- One predicate, used by the table's RLS (and so by the story-media-url
-- function that signs media, 144) and every story RPC, so "visible" means one
-- thing everywhere.
--
--   * unexpired, always. Expiry is a read-time filter, not a purge-time one:
--     the purge (151) is housekeeping and can lag; the 24 hours cannot.
--   * the provider always sees their own, listed or not, so a provider under
--     review can still see and delete what they posted while listed.
--   * everyone else must be a MEMBER (the owner's "any member", see the
--     header), the provider must be in the directory right now
--     (provider_is_listed, 070, which carries 004's boundary: role, verified,
--     not suspended), and the pair must not be blocked in either direction.
--     Another provider, listed or still an applicant, is not an audience: a
--     competitor watching would put their face in the provider's viewer list
--     (149) and hand them the media, and nobody asked for that.
--
-- DEFINER because is_blocked_pair is not callable by a client (005). It takes a
-- STORY id and not a provider id on purpose: with a provider id it would answer
-- "has provider X blocked me" for any X, including one who has never posted.
-- With a story id the caller learns nothing beyond what the tray already shows
-- them.
create or replace function public.story_is_visible(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stories s
    where s.id = p_story_id
      and s.expires_at > now()
      and auth.uid() is not null
      and (
        s.provider_id = auth.uid()
        or (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'member'
          )
          and public.provider_is_listed(s.provider_id)
          and not public.is_blocked_pair(auth.uid(), s.provider_id)
        )
      )
  );
$$;

comment on function public.story_is_visible(uuid) is
  'Whether the caller may see this story now: unexpired, and either their own, '
  'or the caller is a member and the story is a listed provider''s they are '
  'not blocked with. The single visibility rule for stories RLS, the '
  'story-media-url function, and every story RPC.';

-- Granted, because RLS policies run as the caller and must be able to call it.
revoke all on function public.story_is_visible(uuid) from public, anon;
grant execute on function public.story_is_visible(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. RLS and grants
-- ---------------------------------------------------------------------------
alter table public.stories enable row level security;

drop policy if exists stories_select_visible on public.stories;
create policy stories_select_visible
  on public.stories
  for select to authenticated
  using (public.story_is_visible(id));

-- The provider takes their own story down. A plain policy is enough here: no
-- block or cap is involved in removing your own row. Reports keep a snapshot
-- of the caption and media path (150), and the object is only ever removed by
-- the purge (151), which skips any object a report names, so a delete cannot
-- destroy evidence.
drop policy if exists stories_delete_own on public.stories;
create policy stories_delete_own
  on public.stories
  for delete to authenticated
  using (provider_id = auth.uid());

revoke all on public.stories from anon, authenticated;
grant select, delete on public.stories to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Posting one
-- ---------------------------------------------------------------------------
-- Order is 005's: identity, feature gate, standing (listed, suspended, policy),
-- shape, the object, then the cap under a lock, then the write.
create or replace function public.create_story(
  p_story_id    uuid,
  p_media_type  text,
  p_media_path  text,
  p_caption     text default null,
  p_duration_ms integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_suspended timestamptz;
  v_existing  public.stories%rowtype;
  v_story     public.stories%rowtype;
  v_active    integer;
  v_mimetype  text;
  -- Blank and blank-looking alike become NULL (section 0): a story is never
  -- refused for an empty caption, it just has none. One with a control
  -- character in it is refused, by the CHECK.
  v_caption   text := public.story_text_trim(p_caption);
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  if not public.stories_enabled() then
    return json_build_object('success', false, 'error', 'STORIES_DISABLED');
  end if;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  -- Members, applicants and delisted providers all land here. A story is
  -- discovery, and discovery is the directory's to grant, not the role's.
  if not public.provider_is_listed(v_uid) then
    return json_build_object('success', false, 'error', 'NOT_LISTED');
  end if;

  -- Public UGC, so the same gate send_message and the session RPCs use (027).
  if not public.user_has_accepted_current_policies(v_uid) then
    return json_build_object('success', false, 'error', 'POLICY_REQUIRED');
  end if;

  if p_story_id is null or p_media_path is null then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  -- One lock per provider, taken before the retry check and the count, so two
  -- uploads finishing together cannot both see 29 and both insert.
  perform pg_advisory_xact_lock(hashtextextended('story_cap:' || v_uid::text, 0));

  -- A retry after a lost response is the same story, not a second one and not
  -- an error: the id is the client's idempotency key, as the nonce is in 081.
  select * into v_existing from public.stories where id = p_story_id;
  if found then
    if v_existing.provider_id <> v_uid then
      return json_build_object('success', false, 'error', 'BAD_REQUEST');
    end if;
    return json_build_object(
      'success', true,
      'story_id', v_existing.id,
      'created_at', v_existing.created_at,
      'expires_at', v_existing.expires_at
    );
  end if;

  -- The object must already be there, and must be what its name says it is.
  -- Guarded like 094's purge, because the pgTAP harness is plain Postgres with
  -- no storage schema unless a suite builds one (563).
  --
  -- The bucket accepts video/mp4 under any name, so without the second check
  -- an mp4 uploaded as {id}.jpg becomes an "image" story, held for an image's
  -- duration and exempt from the 30s ceiling. story_media_path_is_scoped ties
  -- the extension to media_type; this ties the upload's content type to the
  -- extension, so all three agree. It is the type the uploader DECLARED:
  -- Storage checks it against allowed_mime_types and records it in
  -- metadata.mimetype, but does not sniff the bytes. A client that lies about
  -- both gets past this, which is why the player also stops at duration_ms.
  -- https://supabase.com/docs/guides/storage/uploads/file-limits
  -- https://github.com/supabase/storage/blob/master/src/storage/uploader.ts
  if to_regclass('storage.objects') is not null then
    select o.metadata ->> 'mimetype' into v_mimetype
    from storage.objects o
    where o.bucket_id = 'stories' and o.name = p_media_path;
    if not found then
      return json_build_object('success', false, 'error', 'MEDIA_MISSING');
    end if;
    if v_mimetype is distinct from (
      case substring(p_media_path from '\.([a-z0-9]+)$')
        when 'jpg'  then 'image/jpeg'
        when 'jpeg' then 'image/jpeg'
        when 'png'  then 'image/png'
        when 'webp' then 'image/webp'
        when 'mp4'  then 'video/mp4'
      end
    ) then
      return json_build_object('success', false, 'error', 'MEDIA_MISMATCH');
    end if;
  end if;

  -- 30 live stories, WhatsApp's own ceiling. Counted on unexpired rows only:
  -- an expired story the purge has not reached yet is not "active".
  select count(*)::int into v_active
  from public.stories
  where provider_id = v_uid and expires_at > now();

  if v_active >= 30 then
    return json_build_object('success', false, 'error', 'LIMIT_REACHED');
  end if;

  insert into public.stories (
    id, provider_id, media_type, media_path, caption, duration_ms,
    created_at, expires_at
  )
  values (
    p_story_id, v_uid, p_media_type, p_media_path, v_caption,
    -- The image default lives here rather than as a column default, because a
    -- column default cannot depend on media_type and a video has no default.
    case when p_media_type = 'image' then coalesce(p_duration_ms, 7000)
         else p_duration_ms end,
    now(), now() + interval '24 hours'
  )
  returning * into v_story;

  return json_build_object(
    'success', true,
    'story_id', v_story.id,
    'created_at', v_story.created_at,
    'expires_at', v_story.expires_at
  );
exception
  -- The CHECKs above are the one statement of what a story may be; caught
  -- rather than re-listed here, as toggle_reaction does (011), so the two
  -- copies cannot drift.
  when check_violation or not_null_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

comment on function public.create_story(uuid, text, text, text, integer) is
  'The only writer of public.stories. Listed, unsuspended, policy-accepted '
  'providers only, while kill_switches.stories_enabled is on; at most 30 '
  'unexpired stories each; the upload must exist and its content type match '
  'the file name; idempotent on the client-minted story id.';

revoke all on function public.create_story(uuid, text, text, text, integer) from public, anon;
grant execute on function public.create_story(uuid, text, text, text, integer) to authenticated;
