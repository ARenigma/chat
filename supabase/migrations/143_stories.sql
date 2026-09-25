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

-- Story media names that are on their way out of the bucket: a deleted
-- story's, recorded as its row goes, and every name the media purge has been
-- handed to remove (151). Declared here rather than in 151 because
-- create_story (section 6) reads it: a name on this list is never posted
-- again, which is what keeps a retried create_story from pointing a new row
-- at an object the purge is about to delete (Greptile P1 on bb32af4). The
-- trigger that fills it, the purge that claims into it and the job that
-- forgets from it are all 151's.
create table if not exists public.story_media_released (
  name        text        primary key,
  -- When the name was last released or last handed to the purge. The purge
  -- forgets a name only a day after this, and only once its object is gone.
  released_at timestamptz not null default now()
);

comment on table public.story_media_released is
  'Stories-bucket keys whose story row was deleted or which the media purge '
  'has claimed (151). create_story refuses them (143). Forgotten by '
  'purge_expired_stories a day after the last claim, once the object is gone. '
  'Server-only.';

alter table public.story_media_released enable row level security;
revoke all on public.story_media_released from anon, authenticated;

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
-- DEFINER because is_blocked_pair must not be callable by a client (005). It
-- takes a STORY id and not a provider id on purpose: with a provider id it
-- would answer "has provider X blocked me" for any X, including one who has
-- never posted. With a story id the caller learns nothing beyond what the tray
-- already shows them.
--
-- "Must not be callable" was not true on the hosted project, and every story
-- file leans on it. 005 revoked is_blocked_pair from PUBLIC only, and
-- Supabase's default privileges grant EXECUTE on every new function in public
-- to anon, authenticated and service_role by name, so those grants survive a
-- revoke from PUBLIC. 105 recorded exactly that for service_role
-- (has_function_privilege was true after 005's revoke). So any signed-in
-- account could call rpc('is_blocked_pair', {viewer_id, competitor_id}) and
-- learn who has blocked whom, which is the disclosure 005's missing SELECT
-- policy on blocks exists to avoid, and the story, comment and insight
-- predicates below all call it. The pgTAP harness did not model function
-- defaults, so 040's "a client cannot probe the block graph" passed there
-- while it failed live; supabase/tests/hosted_function_grants.sql now gives
-- the harness the same grant this revoke removes.
-- https://supabase.com/docs/guides/database/postgres/roles#public-schema-and-function-privileges
revoke execute on function public.is_blocked_pair(uuid, uuid) from anon, authenticated;

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
-- 5. Who may post, stated once
-- ---------------------------------------------------------------------------
-- The caller's standing to add a story, as the error create_story returns, or
-- NULL when they may. Order is 005's: identity, feature gate, standing
-- (suspended, listed, policy).
--
-- One function, because there are two places a story is posted from and they
-- drifted apart. create_story checks it at the write; the stories bucket's
-- upload policy (144) checks it at the upload, so an account that could never
-- post does not get 50 MB of private storage. The upload predicate used to
-- repeat the listing and kill-switch tests by hand and left out the policy
-- gate, so a listed provider who had not accepted the current terms could
-- still fill the bucket (Greptile P1 on bb32af4). Both now read this.
--
-- No argument: it answers for auth.uid() only. With a user id it would tell
-- any caller whether any account is suspended, listed or up to date on the
-- policies. Internal all the same, for stories_enabled's reason: both callers
-- are DEFINER and run it as its owner.
create or replace function public.story_post_refusal()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_suspended timestamptz;
begin
  if v_uid is null then
    return 'UNAUTHORIZED';
  end if;

  if not public.stories_enabled() then
    return 'STORIES_DISABLED';
  end if;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return 'SUSPENDED';
  end if;

  -- Members, applicants and delisted providers all land here. A story is
  -- discovery, and discovery is the directory's to grant, not the role's.
  if not public.provider_is_listed(v_uid) then
    return 'NOT_LISTED';
  end if;

  -- Public UGC, so the same gate send_message and the session RPCs use (027).
  if not public.user_has_accepted_current_policies(v_uid) then
    return 'POLICY_REQUIRED';
  end if;

  return null;
end;
$$;

comment on function public.story_post_refusal() is
  'Why the caller may not post a story now (UNAUTHORIZED, STORIES_DISABLED, '
  'SUSPENDED, NOT_LISTED, POLICY_REQUIRED), or NULL when they may. The one '
  'definition, read by create_story (143) and the stories upload policy (144).';

revoke all on function public.story_post_refusal() from public, anon, authenticated;
grant execute on function public.story_post_refusal() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Posting one
-- ---------------------------------------------------------------------------
-- Order is 005's: identity and standing (story_post_refusal, above), shape,
-- the object, then the cap under a lock, then the write.
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
  v_refusal   text := public.story_post_refusal();
  v_existing  public.stories%rowtype;
  v_story     public.stories%rowtype;
  v_active    integer;
  v_mimetype  text;
  -- Blank and blank-looking alike become NULL (section 0): a story is never
  -- refused for an empty caption, it just has none. One with a control
  -- character in it is refused, by the CHECK.
  v_caption   text := public.story_text_trim(p_caption);
begin
  -- The same answer the upload policy got (section 5), so a provider the
  -- bucket refused is refused here for the same reason, and the reverse.
  if v_refusal is not null then
    return json_build_object('success', false, 'error', v_refusal);
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

  /*
   * A name the purge may be removing is never posted again.
   *
   * The purge lists objects no story names and then removes them through the
   * Storage API, two steps with nothing between them. A retry of an earlier
   * create_story, with the same client-minted id after the provider deleted
   * that story, landed its new row in the gap: the object still existed, so
   * the create succeeded, and the purge then deleted the live story's media
   * (Greptile P1 on bb32af4). So a story id whose media was released, under
   * any of the names it could have, is refused here; and so is an upload the
   * purge has claimed for being a day old with no story.
   *
   * The second case is a race rather than a lookup, so it needs a lock: the
   * purge's claim (claim_story_objects_to_purge, 151) takes this key
   * exclusively while it decides and records; every create_story takes it
   * shared, so creates never wait on each other, only on a claim. Whichever
   * commits first, the other sees it: a claim after this create finds the
   * story row and leaves the object alone, a create after the claim finds the
   * name here and is refused. Taken after story_cap, and the claim takes no
   * other lock, so the two orders cannot cross.
   * https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS
   */
  perform pg_advisory_xact_lock_shared(hashtextextended('story_media_purge', 0));

  if exists (
    select 1 from public.story_media_released m
    where m.name = p_media_path
       or m.name = any (array[
         v_uid::text || '/' || p_story_id::text || '.jpg',
         v_uid::text || '/' || p_story_id::text || '.jpeg',
         v_uid::text || '/' || p_story_id::text || '.png',
         v_uid::text || '/' || p_story_id::text || '.webp',
         v_uid::text || '/' || p_story_id::text || '.mp4'
       ])
  ) then
    return json_build_object('success', false, 'error', 'MEDIA_RELEASED');
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
  -- The same client-minted id raced by another account: its advisory lock is
  -- per caller, so only the primary key sees the collision.
  when unique_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

comment on function public.create_story(uuid, text, text, text, integer) is
  'The only writer of public.stories. Listed, unsuspended, policy-accepted '
  'providers only, while kill_switches.stories_enabled is on; at most 30 '
  'unexpired stories each; the upload must exist and its content type match '
  'the file name; idempotent on the client-minted story id, which is never '
  'reused once its media was released (MEDIA_RELEASED, 151).';

revoke all on function public.create_story(uuid, text, text, text, integer) from public, anon;
grant execute on function public.create_story(uuid, text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Every server-only function, closed as the hosted project grants them
-- ---------------------------------------------------------------------------
-- Section 3's is_blocked_pair was one of a class. Supabase's default
-- privileges grant EXECUTE on every function created in public to anon and
-- authenticated by name, so a migration that meant a function for the server
-- and revoked it from PUBLIC only left it callable by any client. With that
-- grant modelled from the first migration (supabase/tests/
-- hosted_function_grants.sql), these were the functions a signed-in account
-- could call that no migration meant it to, and what that let it do:
--
--   * approve_provider_application, reject_provider_application and
--     request_application_info (006, last 083) have no caller check, so a
--     member could submit an application and approve it themselves: role
--     provider, identity_verified_at set, listed (provider_is_listed), and
--     from there create_story. The stories' first rule, providers post, rests
--     on this being closed.
--   * credit_user_token, deduct_user_token (002), credit_promo_tokens,
--     deduct_tokens (028), credit_purchased_recharge (033) and
--     record_provider_accrual (029, last 132) take any account id and move
--     its money: credit_user_token(self, 1000000) succeeded.
--   * has_ever_recharged (102) answers about any account id, and
--     first_recharge_discount_bps (102) is its pair; refresh_reply_latencies
--     and refund_unanswered_messages (006) are the cron's.
--
-- Every caller of these holds the service role (the admin console, the
-- review console, moderate.mjs, verify-order, cashfree-webhook) or is a
-- DEFINER function running as the owner, so nothing a client does changes.
-- 010, 020 and 563's sweep are what fail if any of these comes back.
-- https://supabase.com/docs/guides/database/postgres/roles#public-schema-and-function-privileges
revoke execute on function public.approve_provider_application(uuid, text) from anon, authenticated;
revoke execute on function public.reject_provider_application(uuid, text) from anon, authenticated;
revoke execute on function public.request_application_info(uuid, text[], text) from anon, authenticated;
revoke execute on function public.credit_user_token(uuid, integer) from anon, authenticated;
revoke execute on function public.deduct_user_token(uuid, integer) from anon, authenticated;
revoke execute on function public.credit_promo_tokens(uuid, integer, text) from anon, authenticated;
revoke execute on function public.deduct_tokens(uuid, integer, uuid, uuid) from anon, authenticated;
revoke execute on function public.credit_purchased_recharge(uuid, integer, uuid) from anon, authenticated;
revoke execute on function public.record_provider_accrual(uuid, uuid, integer, integer, integer, integer, uuid)
  from anon, authenticated;
revoke execute on function public.first_recharge_discount_bps() from anon, authenticated;
revoke execute on function public.has_ever_recharged(uuid) from anon, authenticated;
revoke execute on function public.refresh_reply_latencies() from anon, authenticated;
revoke execute on function public.refund_unanswered_messages(interval) from anon, authenticated;

-- And signed out. A function a migration revoked from PUBLIC was never meant
-- for anon: no migration before this one grants one back to anon, and the
-- ones a signed-in client may call were granted to `authenticated` by name.
-- So each of them loses anon's default grant too. Twenty-two client RPCs
-- (submit_report, open_conversation, delete_user_account and the rest) were
-- callable with only the anon key; each checks auth.uid(), so none acted, but
-- a signed-out caller has no business reaching them. A sweep rather than a
-- list, because it is a rule: extension functions are left alone (pgTAP here,
-- whatever the platform installs live), and a function that kept PUBLIC's
-- grant, a trigger or get_public_config, keeps anon's with it.
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and not exists (
        select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('revoke execute on function %s from anon', v_fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Push: a sign-out's row delete that deletes, and whose push it is
-- ---------------------------------------------------------------------------
-- Two defects in the push path the stories' sign-out work leans on, closed
-- here because this is the first file that has not been deployed.
--
-- The row delete removed nothing. A sign-out deletes this device's
-- push_tokens row as the account leaving (src/lib/push.ts), and did it as
-- `delete from push_tokens where token = $1` under RLS. 008 gives the table
-- a DELETE policy and, on purpose, no SELECT policy; and a DELETE whose WHERE
-- reads a column applies the table's SELECT policies as well, so the owner's
-- delete matched zero rows, with no error. Measured on a fresh database: the
-- statement answered DELETE 0 and the row stayed, while a bare `delete from
-- push_tokens` by the same owner answered DELETE 1. When the FCM token's own
-- deletion also failed, (token, old account) stayed live and went on
-- delivering the old account's pushes to a phone signed into another.
-- https://www.postgresql.org/docs/16/sql-createpolicy.html
-- ("Policies Applied by Command Type": a DELETE that needs read access to
-- the rows, as a WHERE does, applies the SELECT policies' USING as well.)
--
-- So the delete is a function, as the insert already is (register_push_token,
-- 008): it names the caller, never a client-supplied user id, and removes the
-- caller's own row for that token only. Scoped to the caller because the same
-- token may belong to the next account on the phone by the time a sign-out's
-- retry runs, and that row is not the leaving account's to remove. It answers
-- whether a row went, and the client treats any error as a delete that has
-- not happened yet (the sign-out keeps its pending entry and tries again).
create or replace function public.unregister_push_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_gone integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  delete from public.push_tokens
  where token = btrim(p_token)
    and user_id = v_uid;
  get diagnostics v_gone = row_count;

  return v_gone > 0;
end;
$$;

comment on function public.unregister_push_token(text) is
  'Remove the caller''s own push_tokens row for this token (143). The only '
  'client delete: a DELETE on the table matches nothing under RLS, which has '
  'no SELECT policy (008).';

revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- And whose push it is. A push names the peer and the conversation and never
-- the account it is for, and the device used to check only that SOMEONE is
-- signed in (signedInOnDevice). A sign-in no longer waits for the previous
-- account's server half, so in the window between the two, the old account's
-- row still delivered, and its pushes were posted inside the new account's
-- session: the old peer's name, a long-lived shortcut, and a tap that opened
-- that peer's chat in the wrong account. So both queues now carry the row's
-- owner, the senders put it in the payload as `recipientId`, and the app
-- posts a push only for the account signed in (src/lib/push.ts).
--
-- Appended as the last column of each view, which is what CREATE OR REPLACE
-- VIEW allows; every other column keeps its name, position and expression
-- from 110 (pending_pushes) and 052 (pending_call_pushes).
-- https://www.postgresql.org/docs/16/sql-createview.html
create or replace view public.pending_pushes
with (security_invoker = true) as
  -- A message nobody has been told about.
  select
    m.id                as message_id,
    m.conversation_id,
    m.sender_id         as peer_id,
    t.token,
    t.platform,
    coalesce(s.display_name, public.member_handle(m.sender_id))
                        as sender_display_name,
    m.created_at,
    d.avatar_url        as sender_avatar_url,
    'message'::text     as kind,
    t.user_id           as recipient_id
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
  join public.profiles s on s.id = m.sender_id
  left join public.provider_directory d on d.id = m.sender_id
  where m.read_at is null
    and m.notified_at is null
    and m.created_at > now() - interval '24 hours'
    and not public.is_blocked_pair(c.member_id, c.provider_id)

  union all

  -- A provider-initiated chat request the member has not been told about.
  select
    r.id                as message_id,
    r.conversation_id,
    r.initiator_id      as peer_id,
    t.token,
    t.platform,
    d.display_name      as sender_display_name,
    r.created_at,
    d.avatar_url        as sender_avatar_url,
    'contact'::text     as kind,
    t.user_id           as recipient_id
  from public.session_requests r
  join public.conversations c on c.id = r.conversation_id
  join public.push_tokens t on t.user_id = c.member_id
  join public.provider_directory d on d.id = r.initiator_id
  where r.channel = 'chat'
    and r.status = 'pending'
    and r.notified_at is null
    and r.expires_at > now()
    and r.initiator_id = c.provider_id
    and r.recipient_id = c.member_id
    and c.chat_consent_declined_at is null
    and not public.is_blocked_pair(c.member_id, c.provider_id)
    and not exists (
      select 1
      from   public.messages m2
      where  m2.conversation_id = r.conversation_id
        and  m2.sender_id       = r.initiator_id
        and  m2.created_at     >= r.created_at
    );

revoke all on public.pending_pushes from anon, authenticated;
grant select on public.pending_pushes to service_role;

create or replace view public.pending_call_pushes
with (security_invoker = true) as
  select
    c.id as call_id,
    c.conversation_id,
    c.caller_id as peer_id,
    c.medium,
    coalesce(d.display_name, public.member_handle(c.caller_id)) as caller_display_name,
    t.token,
    t.platform,
    c.created_at,
    d.avatar_url as caller_avatar_url,
    c.media_backend,
    c.media_experiment_id,
    t.user_id as recipient_id
  from public.calls c
  join public.push_tokens t on t.user_id = c.callee_id
  left join public.provider_directory d on d.id = c.caller_id
  where c.status = 'ringing'
    and c.notified_at is null
    and c.created_at > now() - interval '2 minutes';

revoke all on public.pending_call_pushes from anon, authenticated;
