-- ===========================================================================
-- 085  An Astrologers tab with astrologers in it
-- ===========================================================================
-- Amit, 2026-09-08: "Seed asttrologers profiles as well in db with indian names
-- and pictures.. astrologers can be of older age as well".
--
-- Migration 065 split the directory into Listeners and Astrologers and every
-- provider on the roster is a listener, so the second tab has been empty since
-- the day it shipped — including on the device, where the card rebuild is being
-- reviewed. Six astrologers, so the tab has something in it and the card can be
-- judged against the kind of provider it was copied from.
--
-- ---------------------------------------------------------------------------
-- NO PHOTOGRAPHS, and this is the one part of the request not delivered as
-- asked
-- ---------------------------------------------------------------------------
-- The existing seed uses real Indian portraits from Pexels, and
-- `assets/seed/providers/manifest.json` already binds us on what that permits:
--
--   "DEV SEED ONLY. These are stock photographs of real people used to populate
--    a demo directory on a test project. They must never be shipped as
--    production provider listings: the Pexels licence forbids implying that a
--    person in a photo endorses a product, and a paid companionship listing is
--    exactly that implication."
--
-- This migration runs on PROD. Putting a stock photograph of a real person on a
-- paid astrology listing is the case that sentence was written about, and it is
-- a licence breach and a claim about a person who never agreed to it — a worse
-- version of the problem 084's header already worries at.
--
-- So these carry the bundled CLAY avatars instead: the illustrated marks the app
-- already ships and already falls back to (`clay:<seed>`, src/lib/clayAvatars.ts,
-- twelve of them, no real face involved). The directory reads them exactly as it
-- reads a photo.
--
-- To get real faces here, either supply photographs the people in them have
-- released for this use, or say the word and the DEV seed (scripts/seed-dev.sql,
-- which never touches prod) gets the Pexels treatment the listeners have.
--
-- ---------------------------------------------------------------------------
-- Older, which is the point of asking
-- ---------------------------------------------------------------------------
-- 34 to 61. The listener seed runs 24-34 because that is who the photographs
-- read as; an astrologer's credibility is built on years, and a directory where
-- every astrologer is 28 would be its own kind of tell. `age` in the directory
-- view is computed from `date_of_birth`, so the birth dates are expressed as an
-- interval from CURRENT_DATE and the ages stay right as time passes rather than
-- drifting a year every year.
--
-- Idempotent: `on conflict do nothing` on the users, and the profile update is
-- keyed to these six ids, so re-running changes nothing. Removing them is
-- `delete from auth.users where email like 'seed.astro.%@example.test'`, which
-- cascades.

-- ---------------------------------------------------------------------------
-- 1. The accounts
-- ---------------------------------------------------------------------------
-- Unreachable by design: no phone, and a password hash of 'x' that no bcrypt
-- comparison will ever match. They exist to own a profile row, not to be signed
-- into.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a5000001-0000-4085-8000-000000000001',
   'authenticated', 'authenticated', 'seed.astro.pandit@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000002-0000-4085-8000-000000000002',
   'authenticated', 'authenticated', 'seed.astro.lalita@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000003-0000-4085-8000-000000000003',
   'authenticated', 'authenticated', 'seed.astro.devraj@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000004-0000-4085-8000-000000000004',
   'authenticated', 'authenticated', 'seed.astro.shubhra@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000005-0000-4085-8000-000000000005',
   'authenticated', 'authenticated', 'seed.astro.venkatesh@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000006-0000-4085-8000-000000000006',
   'authenticated', 'authenticated', 'seed.astro.rukmini@example.test', 'x', now(), now(), now())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The listings
-- ---------------------------------------------------------------------------
-- `identity_verified_at` matters as much as the role: `provider_directory`
-- publishes only admitted providers, and `open_conversation` refuses the rest.
--
-- Languages are drawn from OFFERED_LANGUAGES (src/lib/languagePrefs.ts) so a
-- member's language sort can actually match them; expertise from the astrologer
-- half of OFFERED_EXPERTISE (src/lib/expertise.ts) for the same reason. Both
-- lists are gated against those constants by __tests__/languagePrefs.test.ts.
--
-- `seeded_expertise_at` is left NULL: 084's marker means "we made this up
-- because the column was empty". These tags are part of the fixture's identity
-- rather than a backfill over a real answer, and marking them would make the
-- "how much of the directory is still placeholder" query in 084 §4 lie in the
-- other direction. They are fictional people; the whole row is a placeholder.
update public.profiles p
set    role                 = 'provider',
       display_name         = v.name,
       gender               = v.gender,
       date_of_birth        = (current_date - (v.age || ' years')::interval)::date,
       headline             = v.headline,
       about                = v.about,
       languages            = v.languages,
       expertise            = v.expertise,
       provider_category    = 'astrologer',
       avatar_url           = v.avatar,
       is_available         = v.available,
       presence             = case when v.available then 'here'::public.presence_choice
                                   else 'away' end,
       presence_visible     = true,
       identity_verified_at = now()
from (values
  ('a5000001-0000-4085-8000-000000000001'::uuid, 'Pandit Raghav', 'male', 61,
   'Forty years with the same set of charts',
   'I read the birth chart and I tell you what it says, including the parts that are not flattering. I have been doing this since before most of my clients were born, and the one thing I have learned is that people already suspect the answer. They come to hear it out loud.',
   array['Hindi', 'English'], array['Vedic', 'Marriage', 'Career'], 'clay:dusk', true),
  ('a5000002-0000-4085-8000-000000000002'::uuid, 'Lalita Devi', 'female', 54,
   'Tarot, and no theatre with it',
   'The cards are a way of asking a better question, not a way of avoiding one. I will not tell you a stranger is coming into your life. I will tell you what you are circling, and we can sit with that for as long as you need.',
   array['Hindi', 'Marathi'], array['Tarot', 'Love', 'Career'], 'clay:iris', true),
  ('a5000003-0000-4085-8000-000000000003'::uuid, 'Devraj Iyer', 'male', 47,
   'Numbers, dates and the patterns in them',
   'Numerology is arithmetic with a long memory. I work from your date of birth and the name you actually use, and I am precise about what the method can and cannot say. If a question is outside it, I will tell you that instead of guessing.',
   array['Tamil', 'English'], array['Numerology', 'Career', 'Marriage'], 'clay:fern', true),
  ('a5000004-0000-4085-8000-000000000004'::uuid, 'Shubhra Mishra', 'female', 39,
   'Vastu for homes people actually live in',
   'Most Vastu advice assumes you can move a wall. Mine assumes you cannot. We work with the flat you have, the light it gets and the money you want to spend, and I will happily tell you when the answer is that nothing needs changing.',
   array['Hindi', 'English'], array['Vastu', 'Vedic'], 'clay:ember', false),
  ('a5000005-0000-4085-8000-000000000005'::uuid, 'Venkatesh Rao', 'male', 58,
   'Palmistry, patiently',
   'A hand changes over a life, which is the part people find surprising. I take my time, I ask a lot of questions, and I would rather say "I am not sure" than fill a silence. Bring good light if you can.',
   array['Telugu', 'English', 'Hindi'], array['Palmistry', 'Vedic', 'Love'], 'clay:haze', true),
  ('a5000006-0000-4085-8000-000000000006'::uuid, 'Rukmini Bhat', 'female', 34,
   'Charts for people who are sceptical',
   'A good half of the people I read for do not believe in this, and that is a fine place to start. I explain what I am doing and why, you can push back on any of it, and if it turns out to be useless to you I will say so and we can stop.',
   array['Bengali', 'English', 'Hindi'], array['Vedic', 'Tarot', 'Career'], 'clay:luna', true)
) as v(id, name, gender, age, headline, about, languages, expertise, avatar, available)
where p.id = v.id;
