-- Development seed: four providers and a member with five conversations.
--
-- Exists for one reason that no unit test can cover: several screens only appear
-- once there is enough data to need them. The inbox search field is gated at
-- four conversations, the "here now" rail needs available providers, and the
-- directory cards need names, ages, headlines and languages to be worth looking
-- at. An empty database renders every one of those as its empty state, which is
-- exactly the state that had already been verified.
--
-- Run against the LINKED DEV PROJECT only:
--   supabase db query --linked --file scripts/seed-dev.sql
--
-- Every row it writes is namespaced by a `1111…`-style uuid or the
-- `seed.*@example.test` email, so `scripts/unseed-dev.sql` can remove all of it
-- without touching a real account.
--
-- Messages are inserted directly rather than through `send_message`, so no
-- tokens are spent and no rate limit applies. That is deliberate, this seeds
-- the *view*, and going through the RPC would need four JWTs, but it does mean
-- balances here are not evidence about billing. The ledger has its own tests.

begin;

-- ---------------------------------------------------------------------------
-- 1. Four providers
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'seed.mira@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'seed.sara@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'seed.nia@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'seed.ivy@example.test', 'x', now(), now(), now())
on conflict (id) do nothing;

-- `identity_verified_at` matters as much as the role: the directory publishes
-- only admitted providers, and `open_conversation` refuses the rest.
--
-- Ages track the PHOTOS, not the other way round: a card that prints 31 beside a
-- face that reads 26 is the same lie as a face that reads 50 beside a 34. The
-- reviewer's read of each photograph is recorded as `apparent_age` in
-- assets/seed/providers/manifest.json and a contract test holds the two within
-- four years of each other.
--
-- Sara at 24 is also the only provider in the 18-24 band. The casting rule caps
-- the seed at 35, so 35-44 and 45+ can never populate; without her the age
-- filter had one live band out of four and could not demonstrate itself.
update public.profiles p set
  role = 'provider',
  display_name = v.name,
  gender = 'female',
  date_of_birth = (current_date - (v.age || ' years')::interval)::date,
  headline = v.headline,
  about = v.about,
  languages = v.languages,
  is_available = v.available,
  -- Set alongside `is_available` rather than derived from it, because 012 split
  -- the two and the seed is the one place that has to show both states on a
  -- device: Nia is closed for work AND away, so the directory can be checked
  -- with a row that has no dot and no presence line.
  presence = case when v.available then 'here'::public.presence_choice else 'away' end,
  presence_visible = true,
  identity_verified_at = now()
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Mira', 28,
   'No advice unless you ask for it',
   'I sit with whatever you bring and I do not rush you toward a conclusion. Most people already know what they think; they need a quiet hour where nobody is scoring them. Ask for advice if you want it. Otherwise I just stay with you.',
   array['English'], true),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Sara', 24,
   'Good at 2am conversations',
   'Late nights are when the real sentences come out. I am used to that hour: the half-formed worry, the thing you cannot say at dinner. We can ramble, we can sit in silence, we can start again. I will still be here after nine.',
   array['English', 'Hindi'], true),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'Nia', 34,
   'I will just listen if that helps',
   'Some days you do not want a plan. You want someone who will not fill the gaps. I listen first and I stay there unless you ask me to step in. If all you need is a witness for twenty minutes, that is enough work for me.',
   array['English', 'Marathi'], false),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Ivy', 29,
   'Tell me about your week',
   'Tell me the ordinary parts. The commute, the message you did not send, the week that felt longer than it was. I like the small facts; they are usually where the feeling is hiding. We can go slow. Nothing here has to be impressive.',
   array['English', 'Tamil'], true)
) as v(id, name, age, headline, about, languages, available)
where p.id = v.id;

-- Profile photos, from the public `avatars` storage bucket (013) under `seed/`.
-- Real royalty-free portraits, one per provider, replacing the earlier set —
-- half of which were not Indian, in a product that is only for India.
--
-- Provenance, photographer, licence and sha256 per file live in
-- assets/seed/providers/manifest.json, and its `scope` note is binding: these
-- are DEV SEED ONLY. The Pexels licence forbids implying that a person in a
-- photo endorses a product, and a paid companionship listing is exactly that
-- implication. A real provider uploads her own photo (useUploadAvatar).
--
-- The files are committed under assets/seed/providers/ and pushed to the bucket
-- out of band (the manifest's `upload` field carries the command); this only
-- points the rows at them. Each name carries the first eight hex of its own
-- sha256 because the bucket cannot replace an object at an existing key and
-- serves public objects immutably: a different photo is a different URL, which
-- is the only version of this that a CDN cannot get wrong. Ada is not created by this seed — she exists only on
-- the linked dev project — so her row is repointed by hand.
update public.profiles set avatar_url =
  'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/seed/' || fn
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'mira-5e3d8f67.jpg'),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'sara-b4cb2e3f.jpg'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'nia-f09661b5.jpg'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'ivy-186efc03.jpg')
) as a(id, fn)
where profiles.id = a.id;

-- ---------------------------------------------------------------------------
-- 2. The device account goes back to being a member
-- ---------------------------------------------------------------------------
-- It was promoted while testing the admission flow, which left the member tree
--, inbox, directory, search, unreachable on the only device we have.
-- The three provider facts go with the role. 011's `member_is_pseudonymous`
-- makes a member row carrying a birth date, gender or headline unrepresentable,
-- so demoting without shedding them fails the CHECK rather than the seed quietly
-- leaving stale provider details on a member.
update public.profiles
set role = 'member',
    is_available = false,
    date_of_birth = null,
    gender = null,
    headline = null,
    -- Explicit, because a member declaring presence is the case 012 made
    -- possible and there is no other way to see it on a device: with this set,
    -- the provider tree's inbox shows the device account's own thread with a dot
    -- on it, which was unrepresentable before.
    presence = 'here',
    presence_visible = true
where id = 'dc842257-519a-46be-8d19-63247bdb5ff6';

-- ---------------------------------------------------------------------------
-- 3. Conversations, spread over time so the relative timestamps differ
-- ---------------------------------------------------------------------------
insert into public.conversations (id, member_id, provider_id, created_at, last_message_at)
values
  ('aaaa1111-0000-4000-8000-000000000001', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   '11111111-1111-4111-8111-111111111111', now() - interval '3 days', now() - interval '11 minutes'),
  ('aaaa1111-0000-4000-8000-000000000002', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   '22222222-2222-4222-8222-222222222222', now() - interval '2 days', now() - interval '4 hours'),
  ('aaaa1111-0000-4000-8000-000000000003', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   '33333333-3333-4333-8333-333333333333', now() - interval '9 days', now() - interval '2 days'),
  ('aaaa1111-0000-4000-8000-000000000004', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   '44444444-4444-4444-8444-444444444444', now() - interval '20 days', now() - interval '9 days')
on conflict (id) do nothing;

-- Two sides in every thread, and one with unread replies so the count badge and
-- the "Waiting for you" header have something to show.
insert into public.messages (conversation_id, sender_id, body, created_at, read_at)
values
  ('aaaa1111-0000-4000-8000-000000000001', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   'long week. mostly just tired', now() - interval '20 minutes', now() - interval '19 minutes'),
  ('aaaa1111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'that sounds like a long week', now() - interval '12 minutes', null),
  ('aaaa1111-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'what made it long?', now() - interval '11 minutes', null),

  ('aaaa1111-0000-4000-8000-000000000002', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   'can we talk later tonight?', now() - interval '5 hours', now() - interval '5 hours'),
  ('aaaa1111-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   'I am around after nine', now() - interval '4 hours', now() - interval '3 hours'),

  ('aaaa1111-0000-4000-8000-000000000003', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   'thanks for yesterday', now() - interval '2 days 1 hour', now() - interval '2 days'),
  ('aaaa1111-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   'any time. talk tomorrow?', now() - interval '2 days', now() - interval '2 days'),

  ('aaaa1111-0000-4000-8000-000000000004', 'dc842257-519a-46be-8d19-63247bdb5ff6',
   'hello', now() - interval '9 days 2 hours', now() - interval '9 days'),
  ('aaaa1111-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444',
   'hi, tell me about your week', now() - interval '9 days', now() - interval '9 days');

-- ---------------------------------------------------------------------------
-- 4. Reviews, so the ratings block on a profile is not permanently empty
-- ---------------------------------------------------------------------------
-- The profile screen shows an average, a star row and the recent comments. With
-- no reviews it shows "No ratings yet" forever, which is the one state that had
-- already been verified and the one nobody needs to see again.
--
-- A review cannot float: 006 hangs it off a conversation, one per conversation,
-- and it names the member who wrote it. So each reviewer is a real member row
-- with a real thread. Three reviewers gives every provider three comments and
-- an average that is not a flat 5.0 -- a directory where everyone is perfect
-- reads as fake, and the star row can only be seen to work when some of it is
-- unfilled.
--
-- Inserted directly rather than through `submit_review`, for the same reason
-- the messages above are: the RPC needs a JWT per member. That is a statement
-- about the seed, not about the RPC, which has its own pgTAP suite (280).
-- `profiles.rating_avg` / `rating_count` still come out right because 006's
-- trigger on `reviews` computes them.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'bbbb1111-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'seed.reviewer1@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb1111-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'seed.reviewer2@example.test', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb1111-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'seed.reviewer3@example.test', 'x', now(), now(), now())
on conflict (id) do nothing;

-- Members, and nothing else: 011's `member_is_pseudonymous` makes a member row
-- carrying a birth date, gender or headline unrepresentable, and these exist
-- only to be the author of a sentence.
update public.profiles set role = 'member'
where id in ('bbbb1111-0000-4000-8000-000000000001',
             'bbbb1111-0000-4000-8000-000000000002',
             'bbbb1111-0000-4000-8000-000000000003');

-- One thread per reviewer per provider. Ids are deterministic so re-running the
-- seed updates rather than duplicating: bbbb2222-<provider digit>-<reviewer digit>.
insert into public.conversations (id, member_id, provider_id, created_at, last_message_at)
select ('bbbb2222-0000-4000-8000-0000000' || p.d || '000' || r.d)::uuid,
       r.id, p.id,
       now() - (p.d * 7 + r.d) * interval '1 day',
       now() - (p.d * 7 + r.d) * interval '1 day'
from (values
  (1, '11111111-1111-4111-8111-111111111111'::uuid),
  (2, '22222222-2222-4222-8222-222222222222'::uuid),
  (3, '33333333-3333-4333-8333-333333333333'::uuid),
  (4, '44444444-4444-4444-8444-444444444444'::uuid)
) as p(d, id)
cross join (values
  (1, 'bbbb1111-0000-4000-8000-000000000001'::uuid),
  (2, 'bbbb1111-0000-4000-8000-000000000002'::uuid),
  (3, 'bbbb1111-0000-4000-8000-000000000003'::uuid)
) as r(d, id)
on conflict (id) do nothing;

-- The reviews themselves. Ratings deliberately uneven, and the comments are
-- about being listened to rather than about a product, because that is what
-- somebody would actually have written.
insert into public.reviews (conversation_id, member_id, provider_id, rating, comment, created_at)
select ('bbbb2222-0000-4000-8000-0000000' || v.pd || '000' || v.rd)::uuid,
       ('bbbb1111-0000-4000-8000-00000000000' || v.rd)::uuid,
       v.provider, v.rating, v.comment,
       now() - (v.pd * 7 + v.rd) * interval '1 day'
from (values
  (1, 1, '11111111-1111-4111-8111-111111111111'::uuid, 5::smallint,
   'She did not try to fix anything. I did not know that was what I wanted until the call ended.'),
  (1, 2, '11111111-1111-4111-8111-111111111111'::uuid, 5::smallint,
   'Asked one question and then let me talk for twenty minutes. Worth it.'),
  (1, 3, '11111111-1111-4111-8111-111111111111'::uuid, 4::smallint,
   'Kind and easy to talk to. I ran out of things to say before the time was up, which is on me.'),

  (2, 1, '22222222-2222-4222-8222-222222222222'::uuid, 5::smallint,
   'Called at 2am and she was actually awake and present. That is the whole thing.'),
  (2, 2, '22222222-2222-4222-8222-222222222222'::uuid, 4::smallint,
   'Good listener. Took a few minutes to warm up but the second half was worth it.'),
  (2, 3, '22222222-2222-4222-8222-222222222222'::uuid, 5::smallint,
   'I said the thing I have not said to anyone. She did not make it a big deal.'),

  (3, 1, '33333333-3333-4333-8333-333333333333'::uuid, 5::smallint,
   'Did not fill the silences. I have never had that on a call before.'),
  (3, 2, '33333333-3333-4333-8333-333333333333'::uuid, 5::smallint,
   'Twenty minutes and I felt like someone had heard it. Booking again.'),
  (3, 3, '33333333-3333-4333-8333-333333333333'::uuid, 5::smallint,
   'She waited. That sounds small and it was not.'),

  (4, 1, '44444444-4444-4444-8444-444444444444'::uuid, 4::smallint,
   'Warm and normal. Felt like talking to a friend who was not keeping score.'),
  (4, 2, '44444444-4444-4444-8444-444444444444'::uuid, 5::smallint,
   'Asked about the ordinary parts of my week and somehow that helped more than advice.'),
  (4, 3, '44444444-4444-4444-8444-444444444444'::uuid, 4::smallint,
   'Easy conversation. I would talk to her again on a bad day.')
) as v(pd, rd, provider, rating, comment)
on conflict do nothing;

commit;

select
  (select count(*) from public.conversations
    where member_id = 'dc842257-519a-46be-8d19-63247bdb5ff6') as threads_for_device,
  (select count(*) from public.provider_directory) as directory_size,
  (select count(*) from public.reviews
    where comment is not null) as reviews_with_comments,
  (select role::text from public.profiles
    where id = 'dc842257-519a-46be-8d19-63247bdb5ff6') as device_role;
