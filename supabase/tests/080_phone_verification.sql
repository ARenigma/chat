-- 080 — phone verification is a claim only the server can make
--
-- The point of migration 010 is that "this person controls this number" is
-- asserted by MSG91 through an Edge Function, never by a client about itself. If
-- a client can write either column directly, the verification is decorative and
-- the uniqueness index becomes a way to squat on someone else's number.
begin;
select plan(9);

select has_column('public', 'profiles', 'phone_e164', 'profiles records the verified number');
select has_column('public', 'profiles', 'phone_verified_at', 'and when it was verified');

-- The write path is service_role only.
select is(
  (select count(*)::int from information_schema.role_routine_grants
   where routine_name = 'verify_phone' and grantee in ('anon', 'authenticated')),
  0,
  'verify_phone is not callable by a client'
);

insert into auth.users (id) values
  ('cccccccc-0000-4000-8000-000000000001'),
  ('cccccccc-0000-4000-8000-000000000002')
on conflict do nothing;

-- The guard: a signed-in client updating its own row cannot set either column.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set phone_verified_at = now()
    where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', null,
  'a client cannot mark itself verified'
);
select throws_ok(
  $$update public.profiles set phone_e164 = '+919999999999'
    where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', null,
  'nor claim a number directly'
);
reset role;

-- The columns the older guard protects must still be protected: migration 010
-- first tried to extend that function and silently dropped five of them.
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.profiles set token_balance = 9999
    where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', null,
  'and the original guard still holds — the two triggers compose'
);
reset role;

-- The server path works, and enforces E.164.
select lives_ok(
  $$select public.verify_phone('cccccccc-0000-4000-8000-000000000001', '+919876543210')$$,
  'the service role can record a verification'
);
select throws_ok(
  $$select public.verify_phone('cccccccc-0000-4000-8000-000000000002', '9876543210')$$,
  '22023', null,
  'a number without a country code is refused'
);

-- One account per number, or the accountability is decorative.
select throws_ok(
  $$select public.verify_phone('cccccccc-0000-4000-8000-000000000002', '+919876543210')$$,
  '23505', null,
  'a second account cannot claim a number that is already verified'
);

select * from finish();
rollback;
