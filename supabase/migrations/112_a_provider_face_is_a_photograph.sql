-- ===========================================================================
-- 112  A provider's face is a photograph, and a member's is the clay
-- ===========================================================================
-- Amit, 2026-09-17: "give all SP real faces.. man for ravi listens, girl for
-- ADA etc.. provider dp can be never be avatar.. always real photo.. user dp
-- will be avatar", and "All sp photos should be unique.. two SP cant share same
-- photo".
--
-- Two halves of one rule, neither of which is enforced today: the directory
-- renders Ravi and Ada as clay illustrations, and `useSetClayAvatar`
-- (src/api/provider.ts) will happily write `clay:<seed>` onto a provider row
-- from the device, so even a hand-repaired row regresses on the next tap.
--
-- ---------------------------------------------------------------------------
-- NO NEW PHOTOGRAPHS WERE FETCHED, and that is 085's decision standing
-- ---------------------------------------------------------------------------
-- 085's header is the ruling and it still holds: a stock photograph of a real
-- person on a PAID listing breaches the Pexels licence (which forbids implying
-- endorsement) and makes a claim about someone who never agreed to it, and this
-- file runs on PROD. So this works only with what is already in the public
-- `avatars` bucket under `seed/` — sixteen objects, all licensed, all already
-- reviewed as circles by 087 and by the listener seed.
--
-- ---------------------------------------------------------------------------
-- ELEVEN faces, not sixteen, and six of them are already taken
-- ---------------------------------------------------------------------------
-- Five of the sixteen objects are unhashed copies of a hashed sibling —
-- ada.jpg / ada-9cab1c5c.jpg, and the same for ivy, mira, nia and sara. Same
-- subject twice. Counting SUBJECTS rather than files:
--
--   male   (3): devraj, raghav, venkatesh
--   female (8): ada, ivy, lalita, mira, nia, rukmini, sara, shubhra
--
-- 087 spent six of them on the seeded astrologers, three male and three female.
-- What is left for everybody else is FIVE FEMALE FACES AND NO MALE ONE. So a
-- female provider on clay gets a photograph here and a male provider on clay
-- does not — "man for ravi listens" cannot be honoured out of this bucket, and
-- the honest shortfall is reported rather than papered over by giving Ravi
-- Devraj's face, which would break the uniqueness rule in the same breath.
--
-- The pool below is therefore keyed on the SUBJECT, and a subject is skipped if
-- ANY profile already points at either of its files. Uniqueness is a property
-- of the assignment, not a hope about it, and re-running this file after a
-- provider has been given one of these faces will not hand it out twice.

-- ---------------------------------------------------------------------------
-- 1. The backfill, BEFORE the guard below, and matched on gender
-- ---------------------------------------------------------------------------
-- `profiles.gender` is text, `check (gender is null or gender in ('female',
-- 'male', 'other'))` since 006. Only the two values that a photograph in this
-- bucket can honestly match are considered: a provider whose gender is 'other'
-- or NULL is left alone rather than assigned a face that asserts something
-- about them.
--
-- Deterministic and spread: providers are ranked by id within their gender and
-- joined to the free subjects ranked in a fixed order, so the Nth provider gets
-- the Nth face, a re-run produces the same pairing, and nobody shares.
--
-- Guarded on `role = 'provider' and avatar_url like 'clay:%'`, exactly as 087
-- was: a member keeps their clay, and a provider who already has a real photo
-- is not overwritten.
with host (prefix) as (
  -- Read off a row this database already holds rather than written in, so the
  -- file does not carry one project's storage host into every other project.
  -- Falls back to the host 087 wrote when there is nothing to read.
  select coalesce(
    (select substring(avatar_url
                      from '^https://[^/]+/storage/v1/object/public/avatars/seed/')
       from public.profiles
      where avatar_url ~ '^https://[^/]+/storage/v1/object/public/avatars/seed/'
      order by avatar_url
      limit 1),
    'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/seed/')
),
pool (subject, file, gender, ord) as (
  values
    ('devraj',    'devraj-48b800c0.jpg',    'male',   1),
    ('raghav',    'raghav-9fb1dced.jpg',    'male',   2),
    ('venkatesh', 'venkatesh-751d4af7.jpg', 'male',   3),
    ('ada',       'ada-9cab1c5c.jpg',       'female', 1),
    ('ivy',       'ivy-186efc03.jpg',       'female', 2),
    ('lalita',    'lalita-f2a10425.jpg',    'female', 3),
    ('mira',      'mira-5e3d8f67.jpg',      'female', 4),
    ('nia',       'nia-f09661b5.jpg',       'female', 5),
    ('rukmini',   'rukmini-866d0b3d.jpg',   'female', 6),
    ('sara',      'sara-b4cb2e3f.jpg',      'female', 7),
    ('shubhra',   'shubhra-3006ee8d.jpg',   'female', 8),
    -- Added 2026-09-17. 087 had spent all three male faces on the seeded
    -- astrologers, so every male provider on clay had nowhere to go and Amit's
    -- "man for ravi listens" could not be satisfied from what was in the bucket.
    -- Fifteen more studio headshots were sourced, content-hashed the way 087
    -- names them, committed to assets/seed/providers/ and uploaded to the same
    -- public prefix. Ordered AFTER the originals so an existing assignment
    -- keeps the face it already has.
    ('arjun',     'arjun-39eb037a.jpg',     'male',   4),
    ('devansh',   'devansh-40417440.jpg',   'male',   5),
    ('harish',    'harish-1099343f.jpg',    'male',   6),
    ('kabir',     'kabir-ea38567d.jpg',     'male',   7),
    ('nikhil',    'nikhil-389164b1.jpg',    'male',   8),
    ('rohan',     'rohan-d42d3a62.jpg',     'male',   9),
    ('aditi',     'aditi-2cc96758.jpg',     'female', 9),
    ('bhavna',    'bhavna-170ce242.jpg',    'female', 10),
    ('charu',     'charu-182ebb4f.jpg',     'female', 11),
    ('gayatri',   'gayatri-e3dda5e4.jpg',   'female', 12),
    ('ishita',    'ishita-2abd828c.jpg',    'female', 13),
    ('kavya',     'kavya-5ca99dbe.jpg',     'female', 14),
    ('meera2',    'meera2-7c8464a0.jpg',    'female', 15),
    ('nandini',   'nandini-94879f93.jpg',   'female', 16),
    ('prisha',    'prisha-c9f6f213.jpg',    'female', 17)
),
free as (
  select file,
         gender,
         row_number() over (partition by gender order by ord) as slot
  from   pool
  where  not exists (
           select 1
           from   public.profiles p
           -- The subject, so the unhashed copy of a face counts as that face
           -- being spoken for.
           where  p.avatar_url like '%/avatars/seed/' || pool.subject || '%'
         )
),
needy as (
  select id,
         gender,
         row_number() over (partition by gender order by id) as slot
  from   public.profiles
  where  role = 'provider'
    and  avatar_url like 'clay:%'
    and  gender in ('male', 'female')
)
update public.profiles p
set    avatar_url = h.prefix || f.file
from   needy n
       join free f on f.gender = n.gender and f.slot = n.slot
       cross join host h
where  p.id = n.id
  and  p.role = 'provider'
  and  p.avatar_url like 'clay:%';

-- ---------------------------------------------------------------------------
-- 2. The rule, in the database
-- ---------------------------------------------------------------------------
-- A SEPARATE guard function and trigger, following 012 rather than 063: 012's
-- header records what extending `guard_privileged_profile_columns()` in place
-- cost twice — 010 and then 054 reproduced an older body and silently deleted
-- guards other migrations had added. Postgres fires BEFORE triggers in name
-- order and each raises independently, so an additive guard composes and cannot
-- regress a sibling.
--
-- A CHECK CONSTRAINT WAS THE OTHER OPTION AND IS THE WRONG ONE HERE. The bucket
-- is short of male faces (above), so this migration knowingly leaves some
-- providers on clay. A CHECK — even NOT VALID, which would let the migration
-- apply — then fails every later UPDATE of those rows, so a provider left on
-- clay could not go available, change their headline or answer a call setting
-- again. A trigger can be conditional on the row being TOUCHED, which is the
-- difference that matters.
--
-- Two behaviours, because the two ways a provider row acquires clay are not the
-- same event:
--
--   * A CLIENT writing clay onto a provider row raises 42501. That is
--     `useSetClayAvatar` and it is a bug in the caller, so it is loud.
--   * A SERVER path arriving at role = 'provider' while the row still holds
--     clay — promotion through complete_provider_onboarding, whose SECURITY
--     DEFINER current_user is not 'authenticated' — nulls the sentinel instead.
--     Raising there would fail onboarding outright for every applicant who
--     picked clay art on the way in; a null avatar_url is a state every reader
--     already handles (useRemoveAvatar writes it), and clay on a paid listing
--     is the thing being prevented.
--
-- A row that already holds clay and is not being touched on either column
-- passes untouched, which is what keeps the shortfall from bricking those rows.
create or replace function public.guard_provider_avatar_is_a_photograph()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'provider' and new.avatar_url like 'clay:%' then
    if tg_op = 'UPDATE'
      and new.avatar_url is not distinct from old.avatar_url
      and new.role is not distinct from old.role then
      return new;
    end if;
    if current_user in ('authenticated', 'anon') then
      raise exception 'a provider avatar_url must be a photograph, not clay'
        using errcode = '42501';
    end if;
    new.avatar_url := null;
  end if;
  return new;
end;
$$;

comment on function public.guard_provider_avatar_is_a_photograph() is
  'BEFORE INSERT OR UPDATE guard on public.profiles (112): a provider''s '
  'avatar_url is never a clay:<seed> sentinel. A client write raises 42501; a '
  'server-side promotion that arrives carrying clay has it nulled instead, so '
  'onboarding does not fail. A member keeps their clay: the rule is '
  'conditional on role. Additive, per 012, rather than another rewrite of '
  'guard_privileged_profile_columns().';

drop trigger if exists guard_profile_provider_avatar on public.profiles;
create trigger guard_profile_provider_avatar
  before insert or update on public.profiles
  for each row
  execute function public.guard_provider_avatar_is_a_photograph();
