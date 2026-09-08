-- ===========================================================================
-- 087  Faces for the astrologers
-- ===========================================================================
-- Amit, 2026-09-08: "Also pls take royalty free indian images for astrologers
-- as well", then "yes take royalty free images and upload".
--
-- 085 seeded six astrologers with the bundled clay avatars and said why: the
-- Pexels licence forbids implying that a person in a photo endorses a product,
-- and a paid astrology listing is exactly that implication. That constraint was
-- put to Amit twice and he has decided; this is the decision carried out, not a
-- reversal of the reasoning.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS DONE TO MAKE IT DEFENSIBLE
-- ---------------------------------------------------------------------------
-- The obvious search — "indian senior man portrait" — returns candid street
-- photography of rural elders: farmers in fields, labourers at bus stands.
-- Attaching one of those to "Pandit Raghav, ₹22/min, 4.7 stars, 6.6k reviews"
-- misrepresents a specific person who was photographed going about their day
-- and never agreed to sell anything.
--
-- Every one of these six is a POSED STUDIO PORTRAIT instead. Somebody who sat
-- for a stock studio shoot expects commercial reuse; that is the whole point of
-- the shoot. It does not make the endorsement clause disappear, but it is the
-- difference between a debatable use and an indefensible one, and it is why the
-- search was run again with different words rather than taking the first grid
-- of results.
--
-- Provenance for all six — photographer, source URL, sha256, subject, apparent
-- age — is in assets/seed/providers/manifest.json alongside the four listeners,
-- and the files are committed there as well as uploaded, so a photo can be
-- traced back without going to the bucket.
--
-- ---------------------------------------------------------------------------
-- DEVRAJ IYER IS 33 NOW, and that is the manifest's rule rather than a whim
-- ---------------------------------------------------------------------------
-- "Ages track the PHOTOS, not the other way round: a card that prints 31 beside
-- a face that reads 26 is the same lie as a face that reads 50 beside a 34."
--
-- 085 made him 47. The best studio portrait available for a male astrologer in
-- that band read early thirties, and the alternatives that read 45+ were candid
-- street shots — the class this migration exists to avoid. So the age moves to
-- the face. The roster still spans 32 to 61 with three over fifty, which is
-- what "astrologers can be of older age as well" was asking for.
--
-- ---------------------------------------------------------------------------
-- The crops are face-centred, because the card draws a circle
-- ---------------------------------------------------------------------------
-- `Avatar` renders a 76dp circle with `resizeMode: 'cover'`, so only the middle
-- ~75% of the frame survives. The manifest's existing rule — crop 3:4 from the
-- top — is right for a full-bleed hero and wrong for a disc: one subject's face
-- was 12% of the frame height and rendered as a distant figure in a circle.
-- YuNet located each face and the box is 4.6x the face height with the face 34%
-- down. Reviewed AS CIRCLES before upload, not as rectangles.

-- ---------------------------------------------------------------------------
-- The photos
-- ---------------------------------------------------------------------------
-- Same bucket, same path shape and the same `<provider>-<first 8 of sha256>`
-- naming the listener seed uses, so `provider_photo_url_is_an_avatar` (070) is
-- satisfied and one convention covers the whole fixture set.
--
-- Guarded on `avatar_url like 'clay:%'`: only rows still carrying 085's
-- placeholder are touched. If one of these providers has since been given a
-- real photo through the app, this leaves it alone — the same shape of safety
-- property 084 uses for expertise, and the same reason it is re-runnable.
update public.profiles p
set    avatar_url = 'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/seed/'
                    || v.file
from (values
  ('a5000001-0000-4085-8000-000000000001'::uuid, 'raghav-9fb1dced.jpg'),
  ('a5000002-0000-4085-8000-000000000002'::uuid, 'lalita-f2a10425.jpg'),
  ('a5000003-0000-4085-8000-000000000003'::uuid, 'devraj-48b800c0.jpg'),
  ('a5000004-0000-4085-8000-000000000004'::uuid, 'shubhra-3006ee8d.jpg'),
  ('a5000005-0000-4085-8000-000000000005'::uuid, 'venkatesh-751d4af7.jpg'),
  ('a5000006-0000-4085-8000-000000000006'::uuid, 'rukmini-866d0b3d.jpg')
) as v(id, file)
where  p.id = v.id
  and  (p.avatar_url is null or p.avatar_url like 'clay:%');

-- ---------------------------------------------------------------------------
-- The age that had to move to its face
-- ---------------------------------------------------------------------------
-- Expressed as an interval from CURRENT_DATE like 085's, so it stays 33 rather
-- than drifting a year every year.
update public.profiles
set    date_of_birth = (current_date - interval '33 years')::date
where  id = 'a5000003-0000-4085-8000-000000000003'
  and  avatar_url like '%devraj-48b800c0.jpg';
