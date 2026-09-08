-- pgTAP for migration 083: a provider's own topic tags.
--
-- The two assertions worth reading before the rest are 6 and 7. 083 makes a
-- deliberate choice NOT to add `expertise` to the 063 guard, on the grounds
-- that it is a provider-written claim rather than a server-owned fact — so the
-- reasoning is checked from both sides here rather than left as a paragraph in
-- the migration. If somebody later adds it to the guard "for consistency", 6
-- fails and tells them why.
--
--  1. the column exists, defaults to empty, and is never null
--  2. the shape floor rejects a ninth topic
--  3. ...and an empty-string element
--  4. ...and accepts eight
--  5. the directory publishes it
--  6. a provider may write their OWN through the RPC
--  7. ...and a member may not, because a member has no directory row
-- 8a/8. a stranger cannot write somebody else's, RLS not the RPC
--  9. the RPC refuses a list the CHECK would refuse, with a sentence
-- 10. approval carries the applicant's tags across
-- 11. ...and an EMPTY application does not erase tags set after applying
-- 12. an empty list is a legal provider — this is not 075
-- 13. 084 backfills a provider who has none
-- 14. ...with exactly what the card shows, three tags
-- 15. ...drawn from the vocabulary their CATEGORY offers
-- 16. ...deterministically, so a re-run cannot reshuffle the directory
-- 17. 084 never overwrites a provider who chose their own
-- 18. the seeded marker says which is which
-- 19. ...and the provider answering clears it

\set ON_ERROR_STOP on
begin;
select plan(21);

insert into auth.users (id) values
  ('cc083000-0000-4083-8000-000000000001'),  -- provider
  ('cc083000-0000-4083-8000-000000000002'),  -- member
  ('cc083000-0000-4083-8000-000000000003'); -- applicant

update public.profiles
set    role                 = 'provider',
       display_name         = 'Provider083',
       headline             = 'Here to listen',
       about                = 'A provider row for the 083 suite.',
       languages            = array['English'],
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc083000-0000-4083-8000-000000000001';

update public.profiles set display_name = 'Member083', token_balance = 5000
where  id = 'cc083000-0000-4083-8000-000000000002';
update public.profiles set display_name = 'Applicant083'
where  id = 'cc083000-0000-4083-8000-000000000003';

select test.accept_current_policies('cc083000-0000-4083-8000-000000000001');
select test.accept_current_policies('cc083000-0000-4083-8000-000000000002');
select test.accept_current_policies('cc083000-0000-4083-8000-000000000003');

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------
select is(
  (select expertise from public.profiles
   where id = 'cc083000-0000-4083-8000-000000000001'),
  '{}'::text[],
  '1. a new profile starts with an empty array, never null'
);

select throws_ok(
  $$update public.profiles
    set expertise = array['a','b','c','d','e','f','g','h','i']
    where id = 'cc083000-0000-4083-8000-000000000001'$$,
  '23514',
  null,
  '2. a ninth topic is refused by the shape floor'
);

select throws_ok(
  $$update public.profiles
    set expertise = array['Anxiety','   ']
    where id = 'cc083000-0000-4083-8000-000000000001'$$,
  '23514',
  null,
  '3. an element that is blank after trimming is refused'
);

select lives_ok(
  $$update public.profiles
    set expertise = array['a','b','c','d','e','f','g','h']
    where id = 'cc083000-0000-4083-8000-000000000001'$$,
  '4. eight is the ceiling and eight is allowed'
);

-- ---------------------------------------------------------------------------
-- Published
-- ---------------------------------------------------------------------------
update public.profiles
set    expertise = array['Anxiety', 'Stress', 'Relationships']
where  id = 'cc083000-0000-4083-8000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000002","role":"authenticated"}';

select is(
  (select expertise from public.provider_directory
   where id = 'cc083000-0000-4083-8000-000000000001'),
  array['Anxiety', 'Stress', 'Relationships'],
  '5. a member reads the tags off the directory view'
);

-- ---------------------------------------------------------------------------
-- Who may write it
-- ---------------------------------------------------------------------------
-- 6 and 7 are the pair that checks 083's decision to stay out of the 063 guard.
-- The guard is a denylist of SERVER-owned columns; this is provider-owned, so
-- the owner must get through and everyone else must not.
set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000001","role":"authenticated"}';

select is(
  public.set_provider_expertise(array['Grief', 'Sleep']),
  array['Grief', 'Sleep'],
  '6. a provider writes their own tags and is told what was stored'
);

set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.set_provider_expertise(array['Anxiety'])$$,
  '42501',
  null,
  '7. a member cannot: tags on a profile with no directory row are unreadable'
);

-- 8. RLS, not the RPC. A member who reaches past the function and PATCHes the
-- provider's row directly must also fail — 003's owner-only UPDATE is what
-- actually protects the column, and the RPC is a convenience over it.
select lives_ok(
  $$update public.profiles set expertise = array['Hacked']
    where id = 'cc083000-0000-4083-8000-000000000001'$$,
  '8a. the UPDATE statement itself does not error (RLS filters rows, silently)'
);

/*
 * Read back as the OWNER, and the first draft of this assertion did not — it
 * read as the member and compared NULL against the expected array, then failed
 * for a reason that looks exactly like an RLS hole and is the opposite of one.
 *
 * A member cannot SELECT another profile's row at all (004 removed the one
 * permissive SELECT policy), so the subquery returned no row. The UPDATE was
 * already correctly filtered to zero rows by the owner-only policy; the read
 * was filtered too. Two protections, one of which made the other unobservable.
 */
reset role;
select is(
  (select expertise from public.profiles
   where id = 'cc083000-0000-4083-8000-000000000001'),
  array['Grief', 'Sleep'],
  '8. ...and it changed nothing: the provider''s tags are untouched'
);
set local role authenticated;

-- 9. The RPC restates the CHECK so the caller gets a sentence.
set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.set_provider_expertise(
      array['a','b','c','d','e','f','g','h','i'])$$,
  '22023',
  'at most 8 topics, each 1 to 40 characters',
  '9. the RPC refuses what the CHECK would, in words'
);

-- ---------------------------------------------------------------------------
-- Approval
-- ---------------------------------------------------------------------------
reset role;

insert into public.provider_applications
  (user_id, display_name, headline, about, languages, expertise,
   date_of_birth, status, missing_fields)
values
  ('cc083000-0000-4083-8000-000000000003', 'Applicant083', 'Here to listen',
   'An application row for the 083 suite.', array['Hindi'],
   array['Tarot', 'Numerology'],
   (current_date - interval '25 years')::date, 'submitted', '{}'::text[]);

select public.approve_provider_application('cc083000-0000-4083-8000-000000000003');

select is(
  (select expertise from public.profiles
   where id = 'cc083000-0000-4083-8000-000000000003'),
  array['Tarot', 'Numerology'],
  '10. approval carries the applicant''s tags onto the profile'
);

-- 11. The fallback idiom, copied from 075's languages clause. A provider who
-- sets tags AFTER applying, and is then re-approved from an application that
-- has none, must not lose them.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000003","role":"authenticated"}';
select public.set_provider_expertise(array['Vastu', 'Palmistry']);

reset role;
update public.provider_applications
set    expertise = '{}'::text[], status = 'submitted'
where  user_id = 'cc083000-0000-4083-8000-000000000003';

select public.approve_provider_application('cc083000-0000-4083-8000-000000000003');

select is(
  (select expertise from public.profiles
   where id = 'cc083000-0000-4083-8000-000000000003'),
  array['Vastu', 'Palmistry'],
  '11. an empty application does not erase tags set after applying'
);

-- 12. Empty is legal. 075 makes a language mandatory because a provider nobody
-- can talk to is broken; a provider with no tags is merely harder to find, and
-- blocking an approval on it would put an admin in the way of somebody ready.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc083000-0000-4083-8000-000000000001","role":"authenticated"}';

select is(
  public.set_provider_expertise('{}'::text[]),
  '{}'::text[],
  '12. clearing every tag is allowed — this is not the 075 rule'
);

-- ---------------------------------------------------------------------------
-- 084: the backfill, and the two properties that make it safe to have run
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id) values
  ('cc084000-0000-4084-8000-000000000001'),   -- listener, no tags
  ('cc084000-0000-4084-8000-000000000002');  -- astrologer, no tags

update public.profiles
set    role = 'provider', display_name = 'Seeded084', headline = 'Here to listen',
       about = 'A backfill fixture.', languages = array['English'],
       date_of_birth = (current_date - interval '30 years')::date,
       identity_verified_at = now(), provider_category = 'listener',
       expertise = '{}'::text[]
where  id = 'cc084000-0000-4084-8000-000000000001';

update public.profiles
set    role = 'provider', display_name = 'Astro084', headline = 'Here to read',
       about = 'A backfill fixture.', languages = array['Hindi'],
       date_of_birth = (current_date - interval '30 years')::date,
       identity_verified_at = now(), provider_category = 'astrologer',
       expertise = '{}'::text[]
where  id = 'cc084000-0000-4084-8000-000000000002';

-- The migration's own statement, replayed. It is written to be idempotent, so
-- running it here is the same operation production got.
update public.profiles
set    expertise           = public.seed_expertise_for(id, provider_category),
       seeded_expertise_at = now()
where  role = 'provider'
  and  coalesce(cardinality(expertise), 0) = 0;

select isnt(
  (select expertise from public.profiles
   where id = 'cc084000-0000-4084-8000-000000000001'),
  '{}'::text[],
  '13. a provider with no tags is given some'
);

select is(
  cardinality((select expertise from public.profiles
               where id = 'cc084000-0000-4084-8000-000000000001')),
  3,
  '14. exactly three — what the card shows, so nothing is seeded unseen'
);

-- 15. The vocabularies are split by category (065/083); seeding Tarot onto a
-- listener would describe them as something they are not.
select ok(
  (select bool_and(e = any (array['Anxiety','Stress','Relationships','Breakup',
                                  'Loneliness','Family','Career','Self-esteem',
                                  'Sleep','Grief']))
   from unnest((select expertise from public.profiles
                where id = 'cc084000-0000-4084-8000-000000000001')) as e),
  '15a. a listener gets listener topics'
);

select ok(
  (select bool_and(e = any (array['Vedic','Tarot','Numerology','Palmistry',
                                  'Vastu','Love','Marriage','Career']))
   from unnest((select expertise from public.profiles
                where id = 'cc084000-0000-4084-8000-000000000002')) as e),
  '15. an astrologer gets astrologer disciplines'
);

select is(
  public.seed_expertise_for('cc084000-0000-4084-8000-000000000001', 'listener'),
  public.seed_expertise_for('cc084000-0000-4084-8000-000000000001', 'listener'),
  '16. deterministic: a re-run cannot reshuffle the directory'
);

-- 17. THE SAFETY PROPERTY. A provider who answered for themselves is never
-- overwritten, which is also what makes the migration idempotent.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc084000-0000-4084-8000-000000000001","role":"authenticated"}';
select public.set_provider_expertise(array['Grief']);

reset role;
update public.profiles
set    expertise           = public.seed_expertise_for(id, provider_category),
       seeded_expertise_at = now()
where  role = 'provider'
  and  coalesce(cardinality(expertise), 0) = 0;

select is(
  (select expertise from public.profiles
   where id = 'cc084000-0000-4084-8000-000000000001'),
  array['Grief'],
  '17. a provider''s own answer survives a second run of the backfill'
);

select is(
  (select seeded_expertise_at from public.profiles
   where id = 'cc084000-0000-4084-8000-000000000001'),
  null,
  '19. ...and answering cleared the seeded marker, so no row is both'
);

select isnt(
  (select seeded_expertise_at from public.profiles
   where id = 'cc084000-0000-4084-8000-000000000002'),
  null,
  '18. while a still-unclaimed row stays marked as placeholder'
);

select * from finish();
rollback;
