-- pgTAP for 159: the contact guard's review queues and a moderator's strike.
--
--   1-4  a strike from a reported story's media counts once per report,
--        audited, whatever the mode;
--   5-6  strikes 3 (provider) and 5 fill the two queues;
--   7-10 resolving: clear leaves strikes, suspend and ban set suspended_until,
--        each audited first; a closed row cannot be resolved twice;
--   11-12 no client can read the queue or call either function.

\set ON_ERROR_STOP on
begin;
select plan(12);

insert into auth.users (id) values
  ('57300000-0000-4573-8000-000000000001'),  -- provider P
  ('57300000-0000-4573-8000-000000000011');  -- member M, the reporter

update public.profiles
set role = 'provider', languages = array['en'], display_name = 'Chitra',
    date_of_birth = date '1990-01-01', identity_verified_at = now()
where id = '57300000-0000-4573-8000-000000000001';

insert into public.stories (id, provider_id, media_type, media_path, duration_ms, created_at, expires_at)
select ('57300000-0000-4573-8000-0000000000a' || n)::uuid, '57300000-0000-4573-8000-000000000001', 'image',
       '57300000-0000-4573-8000-000000000001/57300000-0000-4573-8000-0000000000a' || n || '.jpg', 7000,
       now() - interval '1 hour', now() + interval '23 hours'
from generate_series(1, 5) n;

insert into public.reports (id, reporter_id, subject_user_id, reason, story_id, evidence_surface, evidence_story_media_path)
select ('57300000-0000-4573-8000-0000000000b' || n)::uuid, '57300000-0000-4573-8000-000000000011',
       '57300000-0000-4573-8000-000000000001', 'solicitation',
       ('57300000-0000-4573-8000-0000000000a' || n)::uuid, 'story',
       '57300000-0000-4573-8000-000000000001/57300000-0000-4573-8000-0000000000a' || n || '.jpg'
from generate_series(1, 5) n;

select is(
  public.contact_guard_strike_from_report('57300000-0000-4573-8000-0000000000b1', 'ops:test', 'QR code in the photo') ->> 'strikes',
  '1', '1. a moderator strikes the provider of a reported story, in shadow mode too');
select is(
  public.contact_guard_strike_from_report('57300000-0000-4573-8000-0000000000b1', 'ops:test') ->> 'already',
  'true', '2. the same report never strikes twice');
select is(
  (select count(*)::int from public.contact_guard_strikes where user_id = '57300000-0000-4573-8000-000000000001'),
  1, '3. ...so there is still one strike');
select is(
  (select action || '/' || (report_id = '57300000-0000-4573-8000-0000000000b1')::text from public.moderation_actions
   where subject_user_id = '57300000-0000-4573-8000-000000000001'),
  'warned/true', '4. the strike is audited against its report');

-- Moderator strikes count one per report even inside ten minutes.
select public.contact_guard_strike_from_report(('57300000-0000-4573-8000-0000000000b' || n)::uuid, 'ops:test')
from generate_series(2, 3) n;
select is(
  (select review_state || '/' || active_strikes from public.contact_guard_review_queue
   where user_id = '57300000-0000-4573-8000-000000000001'),
  'removal_review/3', '5. a provider at strike 3 is in the removal queue');

select public.contact_guard_strike_from_report(('57300000-0000-4573-8000-0000000000b' || n)::uuid, 'ops:test')
from generate_series(4, 5) n;
select is(
  (select review_state || '/' || active_strikes from public.contact_guard_review_queue
   where user_id = '57300000-0000-4573-8000-000000000001'),
  'human_review/5', '6. at strike 5 the account moves to human review');

select is(
  public.contact_guard_resolve_review('57300000-0000-4573-8000-000000000001', 'clear', null, 'ops:test', 'looked fine') ->> 'was',
  'human_review', '7. clearing closes the row');
select is(
  (select count(*)::int from public.contact_guard_review_queue) || '/' ||
  (select count(*)::int from public.contact_guard_strikes where user_id = '57300000-0000-4573-8000-000000000001'),
  '0/5', '8. ...and leaves the strikes to expire on their own');

select throws_ok(
  $$ select public.contact_guard_resolve_review('57300000-0000-4573-8000-000000000001', 'ban') $$,
  'P0002', null, '9. a closed row cannot be resolved again');

update public.contact_guard_restrictions set review_state = 'removal_review', review_requested_at = now()
where user_id = '57300000-0000-4573-8000-000000000001';
select public.contact_guard_resolve_review('57300000-0000-4573-8000-000000000001', 'ban', null, 'ops:test');
select is(
  (select (suspended_until > now() + interval '900 years')::text from public.profiles
   where id = '57300000-0000-4573-8000-000000000001')
  || '/' ||
  (select string_agg(action, ',' order by created_at) from public.moderation_actions
   where subject_user_id = '57300000-0000-4573-8000-000000000001' and report_id is null),
  'true/none,banned', '10. removal is a ban, audited like the clear before it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57300000-0000-4573-8000-000000000011","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from public.contact_guard_review_queue $$,
  '42501', null, '11. no client can read the review queue');
select throws_ok(
  $$ select public.contact_guard_resolve_review('57300000-0000-4573-8000-000000000001', 'clear') $$,
  '42501', null, '12. no client can resolve a review');
reset role;

select * from finish();
rollback;
