-- ===========================================================================
-- 194  Profile saves lock their row; photo deletes are serialized
-- ===========================================================================
-- update_provider_profile (190), restated with two changes:
--   * it locks the caller's profile row (select ... for update) before reading
--     the rename cooldown, so the read and the final UPDATE see the same row
--     (192's trigger already refuses the second of two concurrent renames;
--     this makes the RPC's own check exact as well);
--   * a p_display_name equal to the current name is not a rename: no
--     validation, no stamp, so resaving an unchanged name cannot hit the
--     cooldown and fail the headline/about/languages edit with it.
--
-- provider_photos_delete_guard (191), restated with a per-provider advisory
-- lock before it counts, so two concurrent client deletes cannot both pass
-- the three-photo floor.
--
-- Both bodies are otherwise 190/191 verbatim.

create or replace function public.update_provider_profile(
  p_headline     text,
  p_about        text,
  p_languages    text[],
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_role           text;
  v_headline       text        := btrim(coalesce(p_headline, ''));
  v_about          text        := btrim(coalesce(p_about, ''));
  v_languages      text[]      := coalesce(p_languages, '{}'::text[]);
  v_display_name   text;
  v_last_changed   timestamptz;
  v_current_name   text;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- 194: lock the caller's row for the whole call, so the cooldown read
  -- below and the UPDATE at the end see the same row.
  select role, display_name into v_role, v_current_name
  from public.profiles where id = v_uid
  for update;
  if v_role is distinct from 'provider' then
    raise exception 'only a provider has a public profile' using errcode = '42501';
  end if;

  -- Headline/about/languages validations (copied from 180 verbatim).
  if length(v_headline) not between 1 and 140 then
    raise exception 'a headline is 1 to 140 characters' using errcode = '22023';
  end if;
  if length(v_about) not between 1 and 2000 then
    raise exception 'about is 1 to 2000 characters' using errcode = '22023';
  end if;
  if cardinality(v_languages) = 0 or not public.language_list_is_sane(v_languages) then
    raise exception 'at least one language, at most 12, each 1 to 40 characters'
      using errcode = '22023';
  end if;

  -- Display name change is optional; the parameter defaults to null and is skipped
  -- when not supplied so existing 3-arg callers continue working (the 4th arg
  -- defaults and the name is left untouched).
  -- 194: a resubmitted unchanged name is not a rename. It is neither checked
  -- nor stamped, so it cannot trip the cooldown and block the other fields.
  if p_display_name is not null
    and btrim(p_display_name) is distinct from btrim(coalesce(v_current_name, ''))
  then
    v_display_name := btrim(p_display_name);

    -- Length: 2–30 characters (provider names may be shorter than the member
    -- check_display_name floor of 3 and may exceed its ceiling of 24).
    if length(v_display_name) not between 2 and 30 then
      raise exception 'a display name is 2 to 30 characters' using errcode = '22023';
    end if;

    -- Charset: letters, digits and underscores only, matching check_display_name
    -- and the handles the generator produces.
    if v_display_name !~ '^[a-zA-Z0-9_]+$' then
      raise exception 'letters, numbers, and underscores only' using errcode = '22023';
    end if;

    -- Reserved words: case-insensitive substring match. A name that contains
    -- "pappal", "admin" etc. would impersonate the platform.
    if lower(v_display_name) ~ '(pappal|support|admin|official|team|staff|moderator|help)' then
      raise exception 'that name is not available' using errcode = '22023';
    end if;

    -- Phone number: six or more consecutive digits, or eight or more digits
    -- in total. Mirrors stageNamePii's phone branch in src/lib/stageName.ts.
    if v_display_name ~ '\d{6,}'
      or length(regexp_replace(v_display_name, '[^0-9]', '', 'g')) >= 8
    then
      raise exception 'don''t put a phone number in your display name'
        using errcode = '22023';
    end if;

    -- Uniqueness: case-insensitive, excluding the caller's own current row.
    -- The unique index profiles_display_name_lower_unique would refuse the UPDATE
    -- anyway; this raises a readable sentence instead of a constraint name.
    if exists (
      select 1 from public.profiles
      where lower(display_name) = lower(v_display_name)
        and id <> v_uid
        and btrim(coalesce(display_name, '')) <> ''
    ) then
      raise exception 'that name is already taken' using errcode = '22023';
    end if;

    -- 30-day cooldown: providers may change their display name at most once a month.
    select display_name_changed_at into v_last_changed
    from public.profiles where id = v_uid;

    if v_last_changed is not null
      and v_last_changed > now() - interval '30 days'
    then
      raise exception 'display names can only change once every 30 days'
        using errcode = '22023';
    end if;
  end if;

  -- Single UPDATE for all fields so the contact guard (157) sees the whole write
  -- in one statement and the row cannot half-update.
  update public.profiles
  set
    headline                = v_headline,
    about                   = v_about,
    languages               = v_languages,
    -- coalesce: when p_display_name was null, v_display_name is null and the
    -- existing name is kept. When supplied, write the trimmed value.
    display_name            = coalesce(v_display_name, display_name),
    display_name_changed_at = case
      when v_display_name is not null then now()
      else display_name_changed_at
    end
  where id = v_uid;
end;
$$;

-- create or replace keeps 190's grants; restated so this file stands alone.
revoke all on function public.update_provider_profile(text, text, text[], text) from public, anon;
grant execute on function public.update_provider_profile(text, text, text[], text) to authenticated;

create or replace function public.provider_photos_delete_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_role  text;
  v_count bigint;
begin
  -- Only a delete made by the app is held to the floor (see above).
  if current_user not in ('authenticated', 'anon') then
    return old;
  end if;

  -- Skip if the provider's profile no longer exists (account-deletion cascade).
  select role into v_role
  from   public.profiles
  where  id = old.provider_id;

  if not found then
    return old;
  end if;

  if v_role <> 'provider' then
    return old;
  end if;

  -- 194: one delete at a time per provider. Without it two deletes of
  -- different photos could both count four and both pass, ending at two. The
  -- lock is held to commit; the waiting delete then counts what is left.
  perform pg_advisory_xact_lock(hashtextextended('provider_photos:' || old.provider_id::text, 0));

  select count(*) into v_count
  from   public.provider_photos
  where  provider_id = old.provider_id;

  if v_count <= 3 then
    raise exception 'keep at least 3 photos'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

-- create or replace keeps 191's revoke; restated so this file stands alone.
revoke all on function public.provider_photos_delete_guard()
  from public, anon, authenticated;
