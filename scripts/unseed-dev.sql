-- Removes everything scripts/seed-dev.sql created, and nothing else.
--
--   supabase db query --linked --file scripts/unseed-dev.sql
--
-- Every seeded row is identifiable without guessing: the providers are the four
-- `seed.*@example.test` accounts, and the conversations are the `aaaa1111-`
-- prefix. Deleting by "recently created" would eventually delete a real
-- account, so it deletes by identity instead.
--
-- It does NOT restore the device account's provider role. That was a test
-- promotion in the first place, and a member is the state the app should be
-- exercised in, flipping it back is a deliberate act, not cleanup.

begin;

delete from public.messages
where conversation_id in (
  select id from public.conversations where id::text like 'aaaa1111-%'
);

delete from public.conversations where id::text like 'aaaa1111-%';

-- Cascades to the profile, wallet ledger and anything else keyed on the user.
delete from auth.users where email like 'seed.%@example.test';

commit;

select
  (select count(*) from public.conversations where id::text like 'aaaa1111-%') as seeded_threads,
  (select count(*) from auth.users where email like 'seed.%@example.test') as seeded_users;
