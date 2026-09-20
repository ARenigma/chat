-- ===========================================================================
-- 122  Data repair: RaviListens avatar + member profile null backfill
-- ===========================================================================
--
-- Two separate repairs in one migration because both are one-shot data fixes
-- that must not be repeated:
--
--   (a) RaviListens (67e3c9e0…) has a 0-byte primary upload and a phone-
--       screenshot as the gallery primary. The fix points both to the licensed
--       seed photo already in the bucket, matching how migration 112/113
--       assigned seed URLs to the other test providers.
--
--   (b) 15 live member profiles carry null display_name / avatar_url and
--       profile_completed_at. They appear as "Member xxxx" everywhere.
--       The fix assigns a pop-vocabulary handle + clay avatar and marks them
--       as completed, using the same word shapes that suggestUsernames() and
--       claim_member_profile() already enforce.
--
-- Neither change affects billing, session, or conversation rows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. RaviListens (test provider) — point avatar to venkatesh seed photo
-- ---------------------------------------------------------------------------
-- migration 112 assigns seed photos to providers whose avatar_url is still
-- clay:%; RaviListens had a broken upload that bypassed that path. The venkatesh
-- seed portrait is a Pexels-licensed studio photo already used by Venkatesh Rao
-- (a5000005…); using the same bucket object for a different test provider is
-- fine — two test profiles can share a photo. The fix is gated on the profile
-- still carrying the broken upload path, so re-running is safe.
-- ---------------------------------------------------------------------------

do $$
declare
  v_seed_url text :=
    'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/seed/venkatesh-751d4af7.jpg';
  v_ravi_id uuid := '67e3c9e0-0c33-41fb-9f09-22bf5db896f9';
begin
  -- Only run when the profile is still carrying the broken upload.
  -- The 0-byte object path contains the provider's own bucket folder; the seed
  -- path does not.
  if exists (
    select 1 from public.profiles
    where id = v_ravi_id
      and avatar_url like '%/67e3c9e0-%'
  ) then
    update public.profiles
    set avatar_url = v_seed_url
    where id = v_ravi_id;

    raise notice 'Fixed: RaviListens avatar_url → venkatesh seed photo.';
  end if;

  -- Clean provider_photos: replace any row pointing at the broken upload
  -- folder with a row for the seed photo. A seed URL has no upload-folder prefix.
  update public.provider_photos
  set url = v_seed_url,
      is_primary = true
  where provider_id = v_ravi_id
    and url like '%/67e3c9e0-%'
    and is_primary = true;

  -- Delete the non-primary screenshot row (the phone recharge screenshot).
  delete from public.provider_photos
  where provider_id = v_ravi_id
    and url like '%/67e3c9e0-%'
    and is_primary = false;

  raise notice 'Fixed: RaviListens provider_photos cleaned.';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill null member profiles with pop-vocabulary handles + clay avatars
-- ---------------------------------------------------------------------------
-- Uses Bollywood/Hindi pop-vocabulary word pairs from design/handles.json
-- (the same source as suggestUsernames() in ProfileSetupScreen.tsx).
-- A numeric suffix is appended when a pair is already taken so every row
-- gets a unique, valid display_name.
-- ---------------------------------------------------------------------------

do $$
declare
  v_adjectives text[] := array[
    'Filmi','Jhakaas','Bindaas','Rangeela','Masala','Googly',
    'Retro','Desi','Zabardast','Superhit','Classic','Vintage'
  ];
  v_nouns text[] := array[
    'Baazigar','Sholay','Talkies','Jugaad','Chacha','Dada',
    'Mirchi','Jalebi','Googly','Tamasha','Masala','Interval'
  ];
  v_seeds text[] := array[
    'ada','bloom','coral','dusk','ember','fern',
    'glow','haze','iris','jade','kiwi','luna'
  ];
  v_uid  uuid;
  v_adj  text;
  v_noun text;
  v_seed text;
  v_handle text;
  v_idx  int;
  v_counter int := 0;
begin
  for v_uid in
    select id from public.profiles
    where role = 'member'
      and display_name is null
    order by created_at
  loop
    -- Hash the UUID to pick words deterministically: the same UUID always gets
    -- the same base pair, so this is safe to re-run after a partial failure.
    v_idx := (('x' || left(replace(v_uid::text,'-',''),8))::bit(32)::int
              & 2147483647) % array_length(v_adjectives,1) + 1;
    v_adj  := v_adjectives[v_idx];

    v_idx := (('x' || right(replace(v_uid::text,'-',''),8))::bit(32)::int
              & 2147483647) % array_length(v_nouns,1) + 1;
    v_noun := v_nouns[v_idx];

    v_idx := (('x' || substring(replace(v_uid::text,'-',''),9,8))::bit(32)::int
              & 2147483647) % array_length(v_seeds,1) + 1;
    v_seed := v_seeds[v_idx];

    -- Try the base pair; append a numeric suffix until unique.
    for i in 0..999 loop
      v_handle := v_adj || '_' || v_noun
                  || case when i = 0 then '' else i::text end;
      exit when not exists (
        select 1 from public.profiles
        where lower(display_name) = lower(v_handle)
          and btrim(coalesce(display_name,'')) <> ''
      );
    end loop;

    update public.profiles
    set display_name          = v_handle,
        avatar_url            = 'clay:' || v_seed,
        profile_completed_at  = now()
    where id = v_uid
      and display_name is null;  -- Guard: do not overwrite a race-settled row

    v_counter := v_counter + 1;
  end loop;

  raise notice 'Backfilled % null member profiles with generated handles.', v_counter;
end $$;
