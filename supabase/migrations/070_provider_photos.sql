-- ===========================================================================
-- 070  A provider publishes several photos, and one of them is the face
-- ===========================================================================
-- 013 gave a provider ONE photo, `profiles.avatar_url`, and every reader keys
-- off that scalar. A directory listing sells a person and one frame is not
-- enough to decide on; the detail hero has 420dp of room and shows a single
-- still (Amit, 2026-09-07 — "multiple photo upload for providers, a card swap
-- for photos on the detail page, and a toggle for the primary image").
--
-- ---------------------------------------------------------------------------
-- Why a table and not more columns
-- ---------------------------------------------------------------------------
-- `profiles` RLS is owner-only ("User owns profile", 001:35) and 004
-- deliberately REMOVED the "Providers are discoverable" policy, making the
-- explicit column list of `provider_directory` the privacy boundary rather than
-- a base-table policy (004:63-100). A member cannot select another provider's
-- `profiles` row at all, so a gallery cannot live there. It lives in its own
-- table whose SELECT policy REUSES that boundary instead of restating it —
-- restating a predicate is how 054 silently dropped four guards (see the 063
-- header), and 064 made the same argument for provider_offers_channel.
--
-- ---------------------------------------------------------------------------
-- The decision on avatar_url, and where it is enforced
-- ---------------------------------------------------------------------------
-- `profiles.avatar_url` STAYS, and a trigger keeps it in step with the primary
-- photo, ONE-DIRECTIONALLY: photos -> avatar_url, never the reverse.
--
-- The alternative — leaving the client to write both — was rejected for the
-- reason 063 exists: two writers of one fact eventually disagree, and here the
-- disagreement is a provider whose directory row shows a face that is no longer
-- in her gallery. avatar_url is read by provider_directory (064:180),
-- conversation_peers (013:70), the home rail, the call screen and every push
-- payload; none of those learn about this table, and none of them have to.
--
-- avatar_url remains client-writable (it is deliberately NOT in the 063 guard)
-- because a member and a provider both still pick a bundled `clay:<seed>`
-- avatar through useSetClayAvatar. Accepted consequence, stated plainly: while
-- a gallery is non-empty the photos are authoritative, so the next gallery
-- change overwrites a directly-written avatar_url. Emptying the gallery nulls
-- it, and a provider who wants the clay art back re-picks it.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists public.provider_photos (
  id          uuid        primary key default gen_random_uuid(),
  provider_id uuid        not null references public.profiles(id) on delete cascade,
  -- The full public URL, the same shape `avatar_url` already holds, so the sync
  -- trigger below is an assignment rather than a URL the database would have to
  -- build without knowing the project host.
  url         text        not null,
  is_primary  boolean     not null default false,
  -- clock_timestamp(), NOT now(). now() is the transaction timestamp and is
  -- identical for every row of one multi-row INSERT, which is exactly how the
  -- client adds a batch of photos — the whole gallery would then tie on
  -- created_at and "the oldest" would fall back to a random uuid. clock_timestamp()
  -- advances per row, so the first photo the provider picked is the first photo
  -- in the pager and the one promoted to primary.
  -- https://www.postgresql.org/docs/current/functions-datetime.html
  created_at  timestamptz not null default clock_timestamp(),
  -- The bucket, pinned. WHOSE folder inside it is the storage layer's job:
  -- "Providers upload own avatar" (038:150-157) already pins
  -- (storage.foldername(name))[1] = auth.uid()::text. This constraint stops the
  -- other thing — a "photo" pointing at an arbitrary third-party URL, which
  -- would be an off-platform contact and tracking-pixel channel aimed straight
  -- at a member. It deliberately does NOT pin the uid folder: the dev seed
  -- writes `avatars/seed/<file>` (scripts/seed-dev.sql:105) and a CHECK binds
  -- the service role too.
  constraint provider_photo_url_is_an_avatar check (
    url ~ '^https://[^/]+/storage/v1/object/public/avatars/.+'
  )
);

comment on table public.provider_photos is
  'A provider''s published gallery (070). Rows are the provider''s own to '
  'insert and delete; the only column a client may UPDATE is is_primary, and '
  'only upwards. Exactly one row per provider is primary while any row exists, '
  'and profiles.avatar_url mirrors it by trigger — the photos are '
  'authoritative and the scalar is the projection every other surface already '
  'reads.';

comment on column public.provider_photos.url is
  'Public URL in the `avatars` bucket (038). Same shape as profiles.avatar_url, '
  'so the sync trigger assigns rather than constructs.';
comment on column public.provider_photos.is_primary is
  'The face. Exactly one per provider while the gallery is non-empty '
  '(provider_photos_one_primary + provider_photos_sync_avatar), and the value '
  'profiles.avatar_url mirrors.';

-- The floor under the triggers, not a substitute for them: the BEFORE trigger
-- demotes, this makes two primaries unrepresentable. Same shape as
-- provider_payout_accounts_one_default (048:66-69).
create unique index if not exists provider_photos_one_primary
  on public.provider_photos (provider_id)
  where is_primary;

-- The read path is always "this provider's gallery, primary first, then oldest".
create index if not exists provider_photos_provider
  on public.provider_photos (provider_id, is_primary desc, created_at asc);

-- ---------------------------------------------------------------------------
-- 2. One readable predicate for "a member may see this provider"
-- ---------------------------------------------------------------------------
-- Reuses provider_directory rather than restating role / identity_verified_at /
-- suspended_until, which is the argument 064 made for provider_offers_channel.
-- The reference is inside a function body, which Postgres does not track as a
-- dependency, so a later `create or replace view public.provider_directory`
-- stays as free as it is today.
--
-- Defaults to FALSE for an unknown id — the opposite of provider_offers_channel
-- and correct here: unknown means not listed, which means not readable.
create or replace function public.provider_is_listed(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.provider_directory d where d.id = p_provider_id
  );
$$;

comment on function public.provider_is_listed(uuid) is
  'Whether this provider is in the member-facing directory. One predicate over '
  'the 004 boundary instead of a second copy of its where-clause. False for an '
  'unknown id: unknown means not listed, which means not readable.';

revoke all on function public.provider_is_listed(uuid) from public, anon;
grant execute on function public.provider_is_listed(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.provider_photos enable row level security;

-- The owner always sees their own gallery, including while they are not yet
-- listed — otherwise a provider setting up could not see what they just
-- uploaded.
drop policy if exists provider_photos_select on public.provider_photos;
create policy provider_photos_select
  on public.provider_photos
  for select to authenticated
  using (provider_id = auth.uid() or public.provider_is_listed(provider_id));

drop policy if exists provider_photos_insert_own on public.provider_photos;
create policy provider_photos_insert_own
  on public.provider_photos
  for insert to authenticated
  with check (provider_id = auth.uid());

drop policy if exists provider_photos_update_own on public.provider_photos;
create policy provider_photos_update_own
  on public.provider_photos
  for update to authenticated
  using (provider_id = auth.uid())
  with check (provider_id = auth.uid());

drop policy if exists provider_photos_delete_own on public.provider_photos;
create policy provider_photos_delete_own
  on public.provider_photos
  for delete to authenticated
  using (provider_id = auth.uid());

-- Supabase grants nothing to anon on a new table by default, but 004 revokes
-- explicitly rather than relying on that, and so does this.
revoke all on public.provider_photos from anon;
grant select, insert, update, delete on public.provider_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Only is_primary is client-writable, and only upwards
-- ---------------------------------------------------------------------------
-- The mirror of guard_message_columns (004:55-58) and of the 063 profile guard.
-- Two rules, each with its own reason:
--
--   * url / provider_id / id / created_at are frozen. A URL a provider can
--     rewrite after it is published is a URL that can be swapped for something
--     else after a member has looked at it. Replacing a photo is a delete and
--     an insert.
--
--   * is_primary may go false -> true but never true -> false from a client.
--     "Un-primary this one" would leave a non-empty gallery with no face and
--     avatar_url null, which is the split-brain this migration exists to
--     prevent. The way to stop a photo being the face is to make another one
--     the face, which is one UPDATE and demotes the old primary below.
--     The demotion itself is issued by a SECURITY DEFINER function, whose
--     current_user is the owner and so is not checked here.
create or replace function public.guard_provider_photo_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
      or new.provider_id is distinct from old.provider_id
      or new.url is distinct from old.url
      or new.created_at is distinct from old.created_at then
      raise exception 'only provider_photos.is_primary is client-writable'
        using errcode = '42501';
    end if;
    if old.is_primary and not new.is_primary then
      raise exception 'make another photo primary instead of clearing this one'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_provider_photo_columns() is
  'BEFORE UPDATE guard on provider_photos for the authenticated/anon roles: the '
  'url and the identity columns are frozen, and is_primary may only be set, '
  'never cleared — clearing it would leave a gallery with no face. 42501.';

drop trigger if exists guard_provider_photo_columns on public.provider_photos;
create trigger guard_provider_photo_columns
  before update on public.provider_photos
  for each row execute function public.guard_provider_photo_columns();

-- ---------------------------------------------------------------------------
-- 5. Setting a primary is ONE statement: the trigger demotes the old one
-- ---------------------------------------------------------------------------
-- Named to sort AFTER guard_provider_photo_columns: BEFORE triggers on one
-- table fire in alphabetical order, and the guard must see the client's raw
-- change before anything else touches it.
--
-- SECURITY DEFINER so its own demoting UPDATE runs as the owner, which is what
-- keeps it out of the guard above. That inner UPDATE sets is_primary = false,
-- so the `if new.is_primary` branch is not re-entered and it terminates at
-- depth 2.
--
-- The demotion happens BEFORE the promoted row is written, so at no instant do
-- two rows carry is_primary — which is what keeps provider_photos_one_primary
-- from firing on a legitimate swap.
create or replace function public.provider_photos_single_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_primary then
    update public.provider_photos
    set    is_primary = false
    where  provider_id = new.provider_id
      and  id <> new.id
      and  is_primary;
  end if;
  return new;
end;
$$;

comment on function public.provider_photos_single_primary() is
  'BEFORE INSERT OR UPDATE on provider_photos: demotes the previous primary so '
  'setting a new one is ONE client statement rather than two that can race, and '
  'so the partial unique index never sees two.';

drop trigger if exists provider_photos_single_primary on public.provider_photos;
create trigger provider_photos_single_primary
  before insert or update on public.provider_photos
  for each row execute function public.provider_photos_single_primary();

-- ---------------------------------------------------------------------------
-- 6. The ceiling, the promotion, and profiles.avatar_url — all after the fact
-- ---------------------------------------------------------------------------
-- Everything that has to COUNT rows lives here rather than in a BEFORE trigger,
-- and both halves of that are the subtle part of this file, so both are stated.
--
-- THE CEILING. The client adds photos as ONE multi-row INSERT. A BEFORE ROW
-- trigger fires once per row while the command is still running, and sees only
-- the rows of that command inserted before it — measured on Postgres 16 at
-- authoring time, the counts across a three-row insert run 0, 1, 2 — so it is
-- always reasoning about a half-finished statement. An AFTER ROW trigger is
-- queued and fired at the end of the statement, when every row is in place,
-- which is where a ceiling belongs.
-- https://www.postgresql.org/docs/current/trigger-definition.html
--
-- THE PROMOTION, and why it is skipped for tg_op = 'UPDATE'. Section 5's
-- demotion is itself an UPDATE, and its AFTER trigger fires at the end of that
-- INNER statement — a moment when the old primary has been cleared and the new
-- one has not been written yet. A promotion there puts the old primary straight
-- back, and the outer statement then collides with it. That is not a theory:
-- the first draft of this migration promoted on every operation, and every
-- "make this photo my main one" tap died on
--   23505 duplicate key value violates unique constraint "provider_photos_one_primary"
-- until the branch below was added. On an UPDATE the BEFORE trigger has already
-- guaranteed the invariant, so there is nothing to repair; INSERT and DELETE are
-- the two operations that can genuinely leave a gallery with no face.
create or replace function public.provider_photos_sync_avatar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_url      text;
begin
  -- NEW is unassigned on DELETE in PL/pgSQL; reading a field of it raises.
  if tg_op = 'DELETE' then
    v_provider := old.provider_id;
  else
    v_provider := new.provider_id;
  end if;

  -- A gallery is a decision, not an album. Six: two rows of three tiles in the
  -- manager, and a dot row that still reads as dots on a 360dp hero.
  if tg_op = 'INSERT' then
    if (select count(*) from public.provider_photos
        where provider_id = v_provider) > 6 then
      raise exception 'a provider may publish at most 6 photos'
        using errcode = 'P0010';
    end if;
  end if;

  if tg_op <> 'UPDATE' then
    if not exists (
      select 1 from public.provider_photos
      where provider_id = v_provider and is_primary
    ) then
      update public.provider_photos p
      set    is_primary = true
      where  p.id = (
        select id from public.provider_photos
        where  provider_id = v_provider
        order  by created_at asc, id asc
        limit  1
      );
    end if;
  end if;

  select url into v_url
  from   public.provider_photos
  where  provider_id = v_provider and is_primary;

  -- NULL when the last photo goes, which is honest: the gallery is empty and
  -- the directory falls back to the initial, exactly as useRemoveAvatar does.
  -- `is distinct from` stops the recursive pass writing profiles twice.
  update public.profiles
  set    avatar_url = v_url
  where  id = v_provider
    and  avatar_url is distinct from v_url;

  return null;
end;
$$;

comment on function public.provider_photos_sync_avatar() is
  'AFTER INSERT OR UPDATE OR DELETE on provider_photos: caps the gallery at 6 '
  '(P0010) where the count is true, promotes a replacement primary when an '
  'insert or a delete leaves none, then writes profiles.avatar_url from it '
  '(NULL when the gallery empties). One-directional — photos are authoritative '
  'and avatar_url is the projection provider_directory, conversation_peers, the '
  'rail, the call screen and the push payloads already read.';

drop trigger if exists provider_photos_sync_avatar on public.provider_photos;
create trigger provider_photos_sync_avatar
  after insert or update or delete on public.provider_photos
  for each row execute function public.provider_photos_sync_avatar();
