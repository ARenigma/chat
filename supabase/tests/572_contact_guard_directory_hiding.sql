-- pgTAP for 158: strike 2 hides a provider from the directory for 7 days,
-- from strangers only.
--
--   1-3  a hidden provider is gone from a stranger's directory, and from
--        provider_is_listed as the stranger asks it;
--   4-5  a member who already talks to them still sees them;
--   6    the provider still sees their own row;
--   7    a reader with no end user (pg_cron, the service role) still does;
--   8    the columns are 155's, in 155's order, nothing appended;
--   9    after the 7 days the provider is back for everyone;
--   10   the ladder itself writes the date at strike 2 (157, through 158).

\set ON_ERROR_STOP on
begin;
select plan(10);

insert into auth.users (id) values
  ('57200000-0000-4572-8000-000000000001'),  -- provider P
  ('57200000-0000-4572-8000-000000000011'),  -- member M1, a stranger to P
  ('57200000-0000-4572-8000-000000000012');  -- member M2, already talks to P

update public.profiles set display_name = 'Ada' where id = '57200000-0000-4572-8000-000000000001';
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values ('57200000-0000-4572-8000-000000000001', 'Ada', (current_date - interval '30 years')::date, array['English']);
select public.approve_provider_application('57200000-0000-4572-8000-000000000001');
select test.accept_current_policies(id) from auth.users where id::text like '57200000-%';

insert into public.conversations (member_id, provider_id)
values ('57200000-0000-4572-8000-000000000012', '57200000-0000-4572-8000-000000000001');

insert into public.contact_guard_restrictions (user_id, directory_hidden_until)
values ('57200000-0000-4572-8000-000000000001', now() + interval '7 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000011","role":"authenticated"}';
select is(
  (select count(*)::int from public.provider_directory where id = '57200000-0000-4572-8000-000000000001'),
  0, '1. a stranger no longer finds the hidden provider in the directory');
select is(
  public.provider_is_listed('57200000-0000-4572-8000-000000000001'),
  false, '2. ...and to them the provider reads as not listed');
select is(
  (select count(*)::int from public.provider_directory),
  0, '3. ...nor anywhere else in the list');

set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000012","role":"authenticated"}';
select is(
  (select display_name from public.provider_directory where id = '57200000-0000-4572-8000-000000000001'),
  'Ada', '4. a member who already talks to them still sees them');
select is(
  public.provider_is_listed('57200000-0000-4572-8000-000000000001'),
  true, '5. ...so their chat, names and the provider''s stories keep working');

set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000001","role":"authenticated"}';
select is(
  public.provider_is_listed('57200000-0000-4572-8000-000000000001'),
  true, '6. the provider still sees their own listing');
reset role;
reset request.jwt.claims;

select is(
  (select count(*)::int from public.provider_directory where id = '57200000-0000-4572-8000-000000000001'),
  1, '7. a reader with no end user (pg_cron, the service role) still reads the row');

select is(
  (select string_agg(column_name::text, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'provider_directory'),
  'id,display_name,gender,age,headline,languages,is_available,rating_avg,rating_count,median_reply_seconds,last_active_at,created_at,presence,avatar_url,about,chat_enabled,audio_enabled,video_enabled,provider_category,expertise,online,last_seen_at',
  '8. the columns are 155''s, in order, with nothing appended');

update public.contact_guard_restrictions set directory_hidden_until = now() - interval '1 second'
where user_id = '57200000-0000-4572-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000011","role":"authenticated"}';
select is(
  (select count(*)::int from public.provider_directory where id = '57200000-0000-4572-8000-000000000001'),
  1, '9. after the 7 days the provider is back for everyone');
reset role;

-- The ladder, end to end: two strikes in enforce, ten minutes apart.
delete from public.contact_guard_restrictions where user_id = '57200000-0000-4572-8000-000000000001';
update admin.config_active
set payload = payload || jsonb_build_object('contact_guard_mode', 'enforce')
where domain = 'kill_switches' and environment = 'prod';
set local role authenticated;
set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000001","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'insta @ada.tarot');
reset role;
update public.contact_guard_strikes set created_at = created_at - interval '11 minutes'
where user_id = '57200000-0000-4572-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000001","role":"authenticated"}';
select public.create_story(gen_random_uuid(), 'image', 'x/y.jpg', 'booking 70158 84326');
set local request.jwt.claims = '{"sub":"57200000-0000-4572-8000-000000000011","role":"authenticated"}';
select is(
  (select count(*)::int from public.provider_directory where id = '57200000-0000-4572-8000-000000000001'),
  0, '10. a second strike hides the provider from strangers');
reset role;

select * from finish();
rollback;
