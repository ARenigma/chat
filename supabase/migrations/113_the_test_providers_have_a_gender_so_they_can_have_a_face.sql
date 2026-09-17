-- ===========================================================================
-- 113  The test providers get a gender, so 112 can give them a face
-- ===========================================================================
-- 112 ran and worked exactly as written, and Ravi and Ada QA still rendered as
-- clay illustrations on the device. Not a bug in 112: they have `gender` NULL,
-- and 112 deliberately leaves NULL and 'other' alone, because no photograph in
-- the seed bucket can honestly match a gender nobody has stated and assigning
-- one would assert something about a person.
--
-- That reasoning is right for a real provider and beside the point for these.
-- 084's header already records what they are: "every provider currently on it
-- is a test account - Ravi, RaviListens, Mrunal, Ada QA - not a member of the
-- public." Nobody is being described here; these are fixtures.
--
-- Amit named the two on 2026-09-17: "man for ravi listens, girl for ADA". So
-- the gender is set from his instruction, not inferred from the name, and only
-- for rows that are BOTH a test account by name AND still NULL. A provider who
-- has stated a gender is never touched, and a name that is not on this list
-- stays NULL and stays on clay, which is 112's rule and remains correct.
--
-- Then the same assignment 112 performs is run again for whatever is still on
-- clay. It is written as a re-run rather than an edit to 112 because 112 has
-- already been applied to prod and a migration that has run is not rewritten.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The gender, for test accounts only, and only where it is unstated
-- ---------------------------------------------------------------------------
update public.profiles
set    gender = 'male'
where  role = 'provider'
  and  gender is null
  and  display_name in ('Ravi', 'RaviListens', 'Ravi Listens');

update public.profiles
set    gender = 'female'
where  role = 'provider'
  and  gender is null
  and  display_name in ('Ada QA', 'Ada');

-- ---------------------------------------------------------------------------
-- 2. The same assignment as 112, for whatever is still on clay
-- ---------------------------------------------------------------------------
-- Identical CTEs to 112 section 1, including the `free` guard that treats an
-- unhashed copy of a face as that subject being spoken for, so a face already
-- in use is never handed out twice. Uniqueness is Amit's rule: "All sp photos
-- should be unique.. two SP cant share same photo".
with host (prefix) as (
  -- Byte-identical to 112's, including the column alias list: the prefix is
  -- read off a row this database already holds rather than written in, so the
  -- file does not carry one project's storage host into another.
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
    ('arjun',     'arjun-39eb037a.jpg',     'male',   4),
    ('devansh',   'devansh-40417440.jpg',   'male',   5),
    ('harish',    'harish-1099343f.jpg',    'male',   6),
    ('kabir',     'kabir-ea38567d.jpg',     'male',   7),
    ('nikhil',    'nikhil-389164b1.jpg',    'male',   8),
    ('rohan',     'rohan-d42d3a62.jpg',     'male',   9),
    ('ada',       'ada-9cab1c5c.jpg',       'female', 1),
    ('ivy',       'ivy-186efc03.jpg',       'female', 2),
    ('lalita',    'lalita-f2a10425.jpg',    'female', 3),
    ('mira',      'mira-5e3d8f67.jpg',      'female', 4),
    ('nia',       'nia-f09661b5.jpg',       'female', 5),
    ('rukmini',   'rukmini-866d0b3d.jpg',   'female', 6),
    ('sara',      'sara-b4cb2e3f.jpg',      'female', 7),
    ('shubhra',   'shubhra-3006ee8d.jpg',   'female', 8),
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
