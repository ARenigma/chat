-- pgTAP for migration 066: a review per session, and the ratings read.
--
--  1. reviews carries session_id
--  2. 006's one-review-per-conversation constraint is gone
--  3. ...replaced by one review per SESSION
--  4. ...and one per conversation for legacy rows with no session
--  5. submit_session_review refuses a session that has not ended
--  6. ...refuses anyone who is not the member
--  7. ...refuses a rating outside 1..5
--  8. accepts an ended session, and 8b attaches it to that session
--  9. re-submitting corrects rather than adding a second opinion
-- 10. a SECOND session by the same member is a second opinion, and both count
-- 11. get_provider_ratings returns the average, count and a five-row 5..1
--     distribution including zeros
-- 12. ...returns the comment but never a member id
-- 13. ...returns null for someone the directory does not publish

\set ON_ERROR_STOP on
begin;
select plan(14);

select has_column('public', 'reviews', 'session_id', '1. reviews carries session_id');

select ok(
  not exists (
    select 1 from pg_constraint con
    where con.conrelid = 'public.reviews'::regclass
      and con.contype  = 'u'
      and con.conkey = array[
            (select attnum from pg_attribute
             where attrelid = 'public.reviews'::regclass and attname = 'conversation_id')
          ]::smallint[]
  ),
  '2. the one-review-per-conversation constraint is gone'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'reviews_one_per_session'
      and indexdef like '%WHERE (session_id IS NOT NULL)%'
  ),
  '3. one review per session, as a partial unique index'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'reviews_one_per_legacy_conversation'
      and indexdef like '%WHERE (session_id IS NULL)%'
  ),
  '4. and one per conversation for legacy rows with no session'
);

-- ---------------------------------------------------------------------------
-- Fixtures: member + provider, a chat session driven through the 037 handshake
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('cc066000-0000-4066-8000-000000000001'),  -- member
  ('cc066000-0000-4066-8000-000000000002'); -- provider

update public.profiles
set    role                 = 'provider',
       languages            = array['English'],
       display_name         = 'Provider066',
       date_of_birth        = (current_date - interval '30 years')::date,
       identity_verified_at = now(),
       is_available         = true
where  id = 'cc066000-0000-4066-8000-000000000002';

update public.profiles
set    display_name      = 'Member066',
       promo_balance     = 500,
       purchased_balance = 0
where  id = 'cc066000-0000-4066-8000-000000000001';

select test.accept_current_policies('cc066000-0000-4066-8000-000000000001');
select test.accept_current_policies('cc066000-0000-4066-8000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';
insert into test.fixture (k, v)
values ('conv066', public.open_conversation('cc066000-0000-4066-8000-000000000002'));
do $$ begin
  perform public.send_message((select v from test.fixture where k = 'conv066'), 'hello');
end $$;

set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.send_message((select v from test.fixture where k = 'conv066'), 'hi back');
end $$;

set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';
select public.confirm_chat_session(
  (select id from public.session_requests
   where conversation_id = (select v from test.fixture where k = 'conv066')
     and channel = 'chat' and status = 'pending')
);

reset role;
insert into test.fixture (k, v)
select 'sess066', id from public.paid_sessions
where  conversation_id = (select v from test.fixture where k = 'conv066');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';

select throws_ok(
  format(
    $$select public.submit_session_review(%L::uuid, 5::smallint, null)$$,
    (select v from test.fixture where k = 'sess066')
  ),
  '22023', null,
  '5. a session that has not ended cannot be rated'
);

reset role;
update public.paid_sessions
set    status = 'ended', ended_at = now()
where  id = (select v from test.fixture where k = 'sess066');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format(
    $$select public.submit_session_review(%L::uuid, 5::smallint, null)$$,
    (select v from test.fixture where k = 'sess066')
  ),
  '42501', null,
  '6. only the member may review'
);

set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format(
    $$select public.submit_session_review(%L::uuid, 6::smallint, null)$$,
    (select v from test.fixture where k = 'sess066')
  ),
  '22023', null,
  '7. a rating outside 1..5 is refused'
);

select lives_ok(
  format(
    $$select public.submit_session_review(%L::uuid, 5::smallint, 'she listened')$$,
    (select v from test.fixture where k = 'sess066')
  ),
  '8. an ended session can be rated'
);

reset role;
select is(
  (select session_id from public.reviews
   where conversation_id = (select v from test.fixture where k = 'conv066')),
  (select v from test.fixture where k = 'sess066'),
  '8b. and the review is attached to that session'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';
do $$ begin
  perform public.submit_session_review(
    (select v from test.fixture where k = 'sess066'), 3::smallint, 'on reflection'
  );
end $$;

reset role;
select is(
  (select count(*)::int from public.reviews
   where conversation_id = (select v from test.fixture where k = 'conv066')),
  1,
  '9. re-submitting corrects rather than adding a second opinion'
);

-- A SECOND ended session in the same conversation: a second opinion, and both
-- count toward the average (Amit, 2026-09-06: "all count").
with s as (
  insert into public.paid_sessions (
    conversation_id, channel, member_id, provider_id, status,
    rate_tokens_per_min, accepted_at, started_at, ended_at
  ) values (
    (select v from test.fixture where k = 'conv066'), 'chat',
    'cc066000-0000-4066-8000-000000000001', 'cc066000-0000-4066-8000-000000000002',
    'ended', 22, now() + interval '1 minute', now(), now()
  )
  returning id
)
insert into test.fixture (k, v) select 'sess066b', id from s;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';
do $$ begin
  perform public.submit_session_review(
    (select v from test.fixture where k = 'sess066b'), 1::smallint, null
  );
end $$;

reset role;
select is(
  (select rating_count from public.profiles
   where id = 'cc066000-0000-4066-8000-000000000002'),
  2,
  '10. a second session is a second opinion, and both count'
);

-- ---------------------------------------------------------------------------
-- get_provider_ratings (item 10)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc066000-0000-4066-8000-000000000001","role":"authenticated"}';

select ok(
  (
    with r as (
      select public.get_provider_ratings('cc066000-0000-4066-8000-000000000002') as j
    )
    select (j->>'rating_count')::int = 2
       and (j->>'rating_avg')::numeric = 2.00
       and jsonb_array_length(j->'distribution') = 5
       and (j->'distribution'->0->>'stars')::int = 5
       and (j->'distribution'->4->>'stars')::int = 1
       -- The 3 and the 1 are real; the 5, 4 and 2 rows must be present as zeros
       -- so the chart does not reshape itself as ratings arrive.
       and (select (d->>'count')::int from jsonb_array_elements(j->'distribution') d
            where (d->>'stars')::int = 3) = 1
       and (select (d->>'count')::int from jsonb_array_elements(j->'distribution') d
            where (d->>'stars')::int = 1) = 1
       and (select (d->>'count')::int from jsonb_array_elements(j->'distribution') d
            where (d->>'stars')::int = 5) = 0
    from r
  ),
  '11. average, count and a five-row 5..1 distribution including zeros'
);

select ok(
  (
    with r as (
      select public.get_provider_ratings('cc066000-0000-4066-8000-000000000002') as j
    )
    select j::text like '%on reflection%'
       and j::text not like '%cc066000-0000-4066-8000-000000000001%'
    from r
  ),
  '12. the comment is returned, a member id never is'
);

select ok(
  public.get_provider_ratings('cc066000-0000-4066-8000-000000000001') is null,
  '13. null for someone the directory does not publish'
);

select * from finish();
rollback;
