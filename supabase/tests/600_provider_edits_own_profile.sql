-- pgTAP for 180: a live provider edits their own headline, about and languages.
--
--  1. a provider saves all three, trimmed
--  2. ...and the stored row is what was sent, trimmed
--  3. a member is refused, because a member has no public profile
--  4. a 141-character headline is refused with a sentence
--  5. a blank about is refused
--  6. an empty language list is refused (075's floor, said as a sentence)
--  7. a thirteenth language is refused (language_list_is_sane)
--  8. the direct PATCH of headline is still refused: 012's guard stands
--  9. in enforce, contact details in about are refused at save (P0011)
-- 10. ...and nothing of that save was written
-- 11. signed out cannot call it; signed in can

\set ON_ERROR_STOP on
begin;
select plan(11);

insert into auth.users (id) values
  ('c6000000-0000-4600-8000-000000000001'),  -- provider
  ('c6000000-0000-4600-8000-000000000002');  -- member

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider600',
       headline             = 'Here to listen',
       about                = 'A provider row for the 600 suite.',
       languages            = array['English'],
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now()
where  id = 'c6000000-0000-4600-8000-000000000001';
update public.profiles set display_name = 'Member600'
where  id = 'c6000000-0000-4600-8000-000000000002';

create or replace function pg_temp.set_mode(p text) returns void language sql as $$
  update admin.config_active
  set payload = payload || jsonb_build_object('contact_guard_mode', p)
  where domain = 'kill_switches' and environment = 'prod';
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c6000000-0000-4600-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.update_provider_profile('  I listen more than I talk  ',
       ' Ten years of listening. ', array['English', 'Hindi']) $$,
  '1. a provider saves headline, about and languages');

select is(
  (select headline || '|' || about || '|' || array_to_string(languages, ',')
   from public.profiles where id = 'c6000000-0000-4600-8000-000000000001'),
  'I listen more than I talk|Ten years of listening.|English,Hindi',
  '2. ...stored trimmed, as sent');

select throws_ok(
  $$ select public.update_provider_profile(repeat('a', 141), 'About', array['English']) $$,
  '22023', 'a headline is 1 to 140 characters',
  '4. a 141-character headline is refused with a sentence');

select throws_ok(
  $$ select public.update_provider_profile('Headline', '   ', array['English']) $$,
  '22023', 'about is 1 to 2000 characters',
  '5. a blank about is refused');

select throws_ok(
  $$ select public.update_provider_profile('Headline', 'About', '{}'::text[]) $$,
  '22023', 'at least one language, at most 12, each 1 to 40 characters',
  '6. an empty language list is refused');

select throws_ok(
  $$ select public.update_provider_profile('Headline', 'About',
       array['a','b','c','d','e','f','g','h','i','j','k','l','m']) $$,
  '22023', 'at least one language, at most 12, each 1 to 40 characters',
  '7. a thirteenth language is refused');

select throws_ok(
  $$ update public.profiles set headline = 'Patched'
     where id = 'c6000000-0000-4600-8000-000000000001' $$,
  '42501', 'profiles.headline is not client-writable',
  '8. the direct PATCH of headline is still refused');

set local request.jwt.claims = '{"sub":"c6000000-0000-4600-8000-000000000002","role":"authenticated"}';
select throws_ok(
  $$ select public.update_provider_profile('Headline', 'About', array['English']) $$,
  '42501', 'only a provider has a public profile',
  '3. a member is refused');

reset role;
select pg_temp.set_mode('enforce');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c6000000-0000-4600-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.update_provider_profile('A new headline',
       'Message me on wa.me/917015884326', array['English']) $$,
  'P0011', 'CONTACT_INFO',
  '9. in enforce, contact details in about are refused at save');

select is(
  (select headline from public.profiles where id = 'c6000000-0000-4600-8000-000000000001'),
  'I listen more than I talk',
  '10. ...and nothing of that save was written');

reset role;
select ok(
  not has_function_privilege('anon', 'public.update_provider_profile(text, text, text[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_provider_profile(text, text, text[])', 'EXECUTE'),
  '11. signed out cannot call it; signed in can');

select * from finish();
rollback;
