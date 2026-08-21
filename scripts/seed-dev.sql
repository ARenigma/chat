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
-- tokens are spent and no rate limit applies. That is deliberate — this seeds
-- the *view*, and going through the RPC would need four JWTs — but it does mean
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
update public.profiles p set
  role = 'provider',
  display_name = v.name,
  gender = 'female',
  date_of_birth = (current_date - (v.age || ' years')::interval)::date,
  headline = v.headline,
  languages = v.languages,
  is_available = v.available,
  identity_verified_at = now()
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'Mira', 31,
   'No advice unless you ask for it', array['English'], true),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'Sara', 26,
   'Good at 2am conversations', array['English', 'Hindi'], true),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'Nia', 34,
   'I will just listen if that helps', array['English', 'Marathi'], false),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'Ivy', 29,
   'Tell me about your week', array['English', 'Tamil'], true)
) as v(id, name, age, headline, languages, available)
where p.id = v.id;

-- ---------------------------------------------------------------------------
-- 2. The device account goes back to being a member
-- ---------------------------------------------------------------------------
-- It was promoted while testing the admission flow, which left the member tree
-- — inbox, directory, search — unreachable on the only device we have.
update public.profiles
set role = 'member', is_available = false
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
   'hi — tell me about your week', now() - interval '9 days', now() - interval '9 days');

commit;

select
  (select count(*) from public.conversations
    where member_id = 'dc842257-519a-46be-8d19-63247bdb5ff6') as threads_for_device,
  (select count(*) from public.provider_directory) as directory_size,
  (select role::text from public.profiles
    where id = 'dc842257-519a-46be-8d19-63247bdb5ff6') as device_role;
