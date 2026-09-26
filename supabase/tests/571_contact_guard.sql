-- pgTAP for 156-157: the contact guard decides on the server.
--
-- WHAT THIS IS GUARDING (owner's rules, 2026-09-25):
--   * shadow is the default: a would-be block is logged with its evidence and
--     delivered, and nobody is struck (1-6);
--   * enforce blocks a hard hit with a structured refusal the client maps to
--     copy, leaves no message, and strikes once per incident (7-12);
--   * the ladder: strike 2 warns, strike 3 pauses text and voice notes for
--     24 hours, strikes expire after 90 days (13-19);
--   * edits, the idempotent send, story comments and captions go through the
--     same gate, and the renamed cores cannot be called by a client (20-30);
--   * a number split across messages blocks only the completing message
--     (31-33);
--   * length, images, the cooldown and the kill switch (34-39);
--   * providers: hidden at strike 2, removal review at 3, human review at 5
--     (40-43);
--   * profile fields are refused at save in enforce and logged in shadow
--     (44-47);
--   * the evidence is service-role only and purged at 90 days (48-50);
--   * the detector stays linear at the 4,000-character cap (51).

\set ON_ERROR_STOP on
begin;
select plan(51);

insert into auth.users (id) values
  ('57100000-0000-4571-8000-000000000001'),  -- provider P, receives chats
  ('57100000-0000-4571-8000-000000000002'),  -- provider Q, posts captions
  ('57100000-0000-4571-8000-000000000011'),  -- member M1, shadow
  ('57100000-0000-4571-8000-000000000012'),  -- member M2, the ladder
  ('57100000-0000-4571-8000-000000000013'),  -- member M3, the cooldown
  ('57100000-0000-4571-8000-000000000014'),  -- member M4, edits and surfaces
  ('57100000-0000-4571-8000-000000000015');  -- member M5, the window

update public.profiles set display_name = 'Ada' where id = '57100000-0000-4571-8000-000000000001';
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values ('57100000-0000-4571-8000-000000000001', 'Ada', (current_date - interval '30 years')::date, array['English']);
select public.approve_provider_application('57100000-0000-4571-8000-000000000001');

update public.profiles
set role = 'provider', languages = array['en'], display_name = 'Bina',
    date_of_birth = date '1990-01-01', identity_verified_at = now()
where id = '57100000-0000-4571-8000-000000000002';

update public.profiles set promo_balance = 500
where id::text like '57100000-0000-4571-8000-00000000001%';
select test.accept_current_policies(id) from auth.users where id::text like '57100000-%';

-- Conversations, opened the way the app opens them.
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000011","role":"authenticated"}';
insert into test.fixture (k, v) values ('c1', public.open_conversation('57100000-0000-4571-8000-000000000001'));
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
insert into test.fixture (k, v) values ('c2', public.open_conversation('57100000-0000-4571-8000-000000000001'));
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000013","role":"authenticated"}';
insert into test.fixture (k, v) values ('c3', public.open_conversation('57100000-0000-4571-8000-000000000001'));
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000014","role":"authenticated"}';
insert into test.fixture (k, v) values ('c4', public.open_conversation('57100000-0000-4571-8000-000000000001'));
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000015","role":"authenticated"}';
insert into test.fixture (k, v) values ('c5', public.open_conversation('57100000-0000-4571-8000-000000000001'));
reset role;

create temporary table cg_mode (m text);
grant all on cg_mode to authenticated;

create or replace function pg_temp.set_mode(p text) returns void language sql as $$
  update admin.config_active
  set payload = payload || jsonb_build_object('contact_guard_mode', p)
  where domain = 'kill_switches' and environment = 'prod';
$$;
-- Pretend the incident is more than ten minutes old, so the next block is a new strike.
create or replace function pg_temp.age_incidents(p_user uuid) returns void language sql as $$
  update public.contact_guard_strikes set created_at = created_at - interval '11 minutes' where user_id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- Shadow, the default
-- ---------------------------------------------------------------------------
select is(private.contact_guard_mode(), 'shadow', '1. the mode is shadow until someone flips it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000011","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'c1'), 'mera number 70158 84326') ->> 'success')::boolean,
  true, '2. in shadow a phone number is delivered');
reset role;

select is(
  (select outcome || '/' || tier || '/' || category || '/' || excerpt from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000011' and tier = 'hard'),
  'shadow/hard/phone/mera number 70158 84326',
  '3. ...and logged as a shadow block with its evidence');
select is(
  (select count(*)::int from public.contact_guard_strikes where user_id = '57100000-0000-4571-8000-000000000011'),
  0, '4. ...and nobody is struck in shadow');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000011","role":"authenticated"}';
select public.send_message((select v from test.fixture where k = 'c1'), '98231');
select public.send_message((select v from test.fixture where k = 'c1'), '46705');
select public.send_message((select v from test.fixture where k = 'c1'), 'WA pe aao na, wahan baat karte hain');
reset role;

select is(
  (select outcome || '/' || ('98231' = any(window_texts))::text || '/' || excerpt from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000011' and tier = 'window'),
  'shadow/true/46705', '5. a number split across two messages is logged in shadow, with the earlier part as evidence');
select is(
  (select outcome || '/' || ('app_move' = any(rules))::text from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000011' and tier = 'signal'),
  'flagged/true', '6. an intent phrase is flagged for review');

-- ---------------------------------------------------------------------------
-- Enforce
-- ---------------------------------------------------------------------------
select pg_temp.set_mode('enforce');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
insert into cg_mode (m)
select public.send_message((select v from test.fixture where k = 'c2'), 'mera number 70158 84326')::text;
select is(
  (select (m::jsonb ->> 'error') || '/' || (m::jsonb ->> 'category') || '/' || (m::jsonb ->> 'surface') from cg_mode),
  'CONTACT_INFO/phone/chat', '7. in enforce a phone number is refused, naming the category');
select is(
  (select (m::jsonb ->> 'strikes') || '/' || (m::jsonb ->> 'warn') from cg_mode),
  '1/false', '8. ...as strike 1, with no warning yet');
reset role;
select is(
  (select count(*)::int from public.messages where body = 'mera number 70158 84326'
     and sender_id = '57100000-0000-4571-8000-000000000012'),
  0, '9. ...and no message row exists');
select is(
  (select count(*)::int from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000012' and outcome = 'blocked' and counts_as_strike),
  1, '10. ...and the event is a blocked one that counted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
select is(
  public.send_message((select v from test.fixture where k = 'c2'), 'UTR 402911882345 ka paisa nahi aaya')::jsonb
    - 'restricted_until' - 'directory_hidden_until' - 'spec' - 'field',
  jsonb_build_object('success', false, 'error', 'CONTACT_INFO', 'category', 'phone', 'reason', 'reference',
                     'surface', 'chat', 'strikes', 1, 'warn', false),
  '11. a bare reference number is blocked with reason reference, and a retry within ten minutes is the same incident');
select is(
  (public.send_message((select v from test.fixture where k = 'c2'), 'DOB 12/08/1995 4:35 am patna, shaadi kab hogi?') ->> 'success')::boolean,
  true, '12. birth details go through');
reset role;

select pg_temp.age_incidents('57100000-0000-4571-8000-000000000012');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
select is(
  (select (r ->> 'category') || '/' || (r ->> 'strikes') || '/' || (r ->> 'warn')
   from (select public.send_message((select v from test.fixture where k = 'c2'), 'priya.sharma95@gmail.com')::jsonb r) x),
  'email/2/true', '13. strike 2 is a warning');
reset role;

select pg_temp.age_incidents('57100000-0000-4571-8000-000000000012');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
select is(
  (select (r ->> 'category') || '/' || (r ->> 'strikes') || '/' || (r ? 'restricted_until' and r ->> 'restricted_until' is not null)::text
   from (select public.send_message((select v from test.fixture where k = 'c2'), 'gpay kar do rohan99@ybl pe')::jsonb r) x),
  'payment/3/true', '14. strike 3 pauses messaging');
select is(
  public.send_message((select v from test.fixture where k = 'c2'), 'theek hai') ->> 'error',
  'CONTACT_RESTRICTED', '15. while paused, even a clean message is refused');
select is(
  public.send_message((select v from test.fixture where k = 'c2'), null, null,
    (select v from test.fixture where k = 'c2')::text || '/note.m4a', 4000) ->> 'error',
  'CONTACT_RESTRICTED', '16. ...and so is a voice note');
reset role;

select ok(
  (select paused_until between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
          and review_state is null
   from public.contact_guard_restrictions where user_id = '57100000-0000-4571-8000-000000000012'),
  '17. the pause is 24 hours, and a member at strike 3 is not yet in review');

-- Strikes expire after 90 days.
update public.contact_guard_strikes set expires_at = now() - interval '1 second'
where user_id = '57100000-0000-4571-8000-000000000012';
update public.contact_guard_restrictions set paused_until = null
where user_id = '57100000-0000-4571-8000-000000000012';
select pg_temp.age_incidents('57100000-0000-4571-8000-000000000012');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
select is(
  public.send_message((select v from test.fixture where k = 'c2'), 'insta: priya_astro_22') ->> 'strikes',
  '1', '18. an expired strike no longer counts');
reset role;
select is(
  (select expires_at::date from public.contact_guard_strikes
   where user_id = '57100000-0000-4571-8000-000000000012' and expires_at > now()),
  (now() + interval '90 days')::date, '19. a strike lasts 90 days');

-- ---------------------------------------------------------------------------
-- Every entry point
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000014","role":"authenticated"}';
insert into test.fixture (k, v)
select 'm4', (public.send_message((select v from test.fixture where k = 'c4'), 'ok') ->> 'message_id')::uuid;
select is(
  public.edit_message((select v from test.fixture where k = 'm4'), 'call 70158 84326') ->> 'error',
  'CONTACT_INFO', '20. an edit that adds a number is refused');
select is(
  (select body from public.messages where id = (select v from test.fixture where k = 'm4')),
  'ok', '21. ...and the message keeps its words');
select is(
  (public.edit_message((select v from test.fixture where k = 'm4'), 'ok, kal 7:30 pm') ->> 'success')::boolean,
  true, '22. a clean edit still works');
select is(
  public.send_message_idempotent('57100000-0000-4571-8000-0000000000e1',
    (select v from test.fixture where k = 'c4'), 'insta pe dhundo ananya underscore reads') ->> 'error',
  'CONTACT_INFO', '23. the idempotent send goes through the same gate');
select is(
  (select count(*)::int from public.messages where client_nonce = '57100000-0000-4571-8000-0000000000e1'),
  0, '24. ...and leaves no row under its nonce');
select is(
  (select (r ->> 'error') || '/' || (r ->> 'surface')
   from (select public.post_story_comment(gen_random_uuid(), gen_random_uuid(), 'follow karo @riya_22')::jsonb r) x),
  'CONTACT_INFO/story_comment', '25. a story comment with a handle is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000001","role":"authenticated"}';
select is(
  (select (r ->> 'error') || '/' || (r ->> 'surface')
   from (select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'booking ke liye wa.me/917015884326')::jsonb r) x),
  'CONTACT_INFO/story_caption', '26. a story caption with a link is refused');
reset role;

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('send_message_core', 'edit_message_core', 'post_story_comment_core', 'create_story_core')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))),
  0, '27. no client can call a renamed core');
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('send_message', 'edit_message', 'post_story_comment', 'create_story')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')),
  4, '28. the four wrappers are callable signed in, and not signed out');
select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname like 'contact\_guard%'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  0, '29. no detector or gate function is callable by a client');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000014","role":"authenticated"}';
select throws_ok(
  $$ select public.send_message_core((select v from test.fixture where k = 'c4'), 'x') $$,
  '42501', null, '30. calling send_message_core directly is refused');
reset role;

-- ---------------------------------------------------------------------------
-- Split across messages: only the completing message is blocked
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000015","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'c5'), 'mera number 70158') ->> 'success')::boolean,
  true, '31. the first half of a number is delivered');
select is(
  (select (r ->> 'error') || '/' || (r ->> 'category')
   from (select public.send_message((select v from test.fixture where k = 'c5'), 'aur 84326')::jsonb r) x),
  'CONTACT_INFO/window', '32. the message that completes it is refused');
reset role;
select is(
  (select count(*)::int from public.messages
   where sender_id = '57100000-0000-4571-8000-000000000015' and body = 'mera number 70158' and deleted_at is null),
  1, '33. ...and the earlier part is left as it was');

-- ---------------------------------------------------------------------------
-- Length, images, cooldown, kill switch
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000014","role":"authenticated"}';
select is(
  public.send_message((select v from test.fixture where k = 'c4'), repeat('a1 ', 1334)) ->> 'error',
  'CONTACT_TOO_LONG', '34. text over 4,000 characters is refused before the detector runs');
select is(
  public.send_message((select v from test.fixture where k = 'c4'), null, null, null, null,
    (select v from test.fixture where k = 'c4')::text || '/p.jpg', 100, 100) ->> 'error',
  'IMAGES_DISABLED', '35. a chat image is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000013","role":"authenticated"}';
select public.send_message((select v from test.fixture where k = 'c3'), 'call 70158 8432' || n::text)
from generate_series(1, 5) n;
select is(
  public.send_message((select v from test.fixture where k = 'c3'), 'call 70158 84999') ->> 'error',
  'CONTACT_COOLDOWN', '36. the sixth blocked attempt in ten minutes hits the cooldown');
reset role;
select is(
  (select count(*)::int from public.contact_guard_strikes where user_id = '57100000-0000-4571-8000-000000000013'),
  1, '37. five retries in one incident are one strike');

select pg_temp.set_mode('off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000014","role":"authenticated"}';
select is(
  (public.send_message((select v from test.fixture where k = 'c4'), 'ring 91234 56780') ->> 'success')::boolean,
  true, '38. with the guard off, a number goes through');
reset role;
select is(
  (select count(*)::int from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000014' and excerpt = 'ring 91234 56780'),
  0, '39. ...and nothing is logged');
select pg_temp.set_mode('enforce');

-- ---------------------------------------------------------------------------
-- Providers: stricter consequences on the same ladder
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000002","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'insta @bina.tarot');
reset role;
select pg_temp.age_incidents('57100000-0000-4571-8000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000002","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'booking 70158 84326');
reset role;
select ok(
  (select directory_hidden_until between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
   from public.contact_guard_restrictions where user_id = '57100000-0000-4571-8000-000000000002'),
  '40. a provider at strike 2 is hidden from the directory for 7 days');
select pg_temp.age_incidents('57100000-0000-4571-8000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000002","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'bina at gmail dot com');
reset role;
select is(
  (select review_state || '/' || (paused_until > now())::text
   from public.contact_guard_restrictions where user_id = '57100000-0000-4571-8000-000000000002'),
  'removal_review/true', '41. at strike 3 a provider is paused and goes to review for removal');
select pg_temp.age_incidents('57100000-0000-4571-8000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000002","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'tarot.bina.in');
reset role;
select pg_temp.age_incidents('57100000-0000-4571-8000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000002","role":"authenticated"}';
select is(
  public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'snap: bina.99') ->> 'strikes',
  '5', '42. the fifth strike is counted');
reset role;
select is(
  (select review_state from public.contact_guard_restrictions where user_id = '57100000-0000-4571-8000-000000000002'),
  'human_review', '43. ...and puts the account in human review');

-- ---------------------------------------------------------------------------
-- Profile fields, at save
-- ---------------------------------------------------------------------------
-- Text fields reach profiles through SECURITY DEFINER writers
-- (claim_member_profile, complete_provider_onboarding, set_provider_expertise),
-- which run as the owner with the caller's claims. So the trigger is driven the
-- same way here: the owner's role, the user's claims.
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set headline = 'WhatsApp 70158 84326' where id = '57100000-0000-4571-8000-000000000001' $$,
  'P0011', 'CONTACT_INFO', '44. in enforce a headline with a number is refused at save');
select lives_ok(
  $$ update public.profiles set headline = 'Vedic astrologer, 12 years, 5000+ readings' where id = '57100000-0000-4571-8000-000000000001' $$,
  '45. a headline with ordinary numbers saves');
select pg_temp.set_mode('shadow');
select lives_ok(
  $$ update public.profiles set about = 'readings on wa.me/917015884326' where id = '57100000-0000-4571-8000-000000000001' $$,
  '46. in shadow the same kind of save goes through');
reset request.jwt.claims;
select is(
  (select outcome || '/' || field || '/' || category from public.contact_guard_events
   where user_id = '57100000-0000-4571-8000-000000000001' and surface = 'profile'),
  'shadow/about/phone', '47. ...and is logged against the field');

-- ---------------------------------------------------------------------------
-- The evidence
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"57100000-0000-4571-8000-000000000012","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from public.contact_guard_events $$,
  '42501', null, '48. no client can read the evidence');
reset role;
select throws_ok(
  $$ update public.contact_guard_events set excerpt = 'x' where user_id = '57100000-0000-4571-8000-000000000012' $$,
  '42501', null, '49. the evidence is append-only apart from voiding');
alter table public.contact_guard_events disable trigger contact_guard_events_append_only;
update public.contact_guard_events set purge_after = now() - interval '1 second'
where user_id = '57100000-0000-4571-8000-000000000011';
alter table public.contact_guard_events enable trigger contact_guard_events_append_only;
select private.contact_guard_purge();
select is(
  (select count(*)::int from public.contact_guard_events where user_id = '57100000-0000-4571-8000-000000000011'),
  0, '50. evidence past its 90 days is purged');

-- ---------------------------------------------------------------------------
-- Cost at the cap
-- ---------------------------------------------------------------------------
-- The slowest of these is far under the budget on a laptop; the budget is set
-- for slower CI hardware and exists to catch a rule that grows faster than
-- the text does.
create or replace function pg_temp.blocked_ms(p text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp();
begin
  perform private.contact_guard_blocked(p);
  return extract(epoch from clock_timestamp() - t0) * 1000;
end $$;
select ok(
  (select max(pg_temp.blocked_ms(s)) from unnest(array[
     repeat('a1 ', 1334), repeat('whatsapp ', 445), repeat('9 ', 2000), repeat('@', 4000),
     repeat('a.', 2000), repeat('नौ ', 1334), repeat('insta pe ', 445), repeat('98765 ', 667),
     repeat('x@y.', 1000), repeat('double nine ', 334), repeat('9🔥', 1333)]) s) < 1500,
  '51. every adversarial 4,000-character shape is judged in under 1.5 s');

select * from finish();
rollback;
