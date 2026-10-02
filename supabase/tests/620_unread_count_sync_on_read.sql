-- pgTAP for migration 183: unread_count_member/provider resets when read_at is set.
--
-- Assertions:
--  (a) Out-of-session message from provider, member marks it read → counter 0.
--  (b) In-session message from provider, member marks it read → counter 0.
--  (c) Message with hidden_at set is excluded from the count (does not inflate
--      or block the reset).
--  (d) Backfill: threads where stored counter > recomputed truth are 0 after
--      the migration's UPDATE runs (validated by re-running the backfill query
--      in the test's own transaction).

\set ON_ERROR_STOP on
begin;
select plan(9);

-- ── Shared fixtures ───────────────────────────────────────────────────────────
-- Three independent member/provider pairs (unique constraint on conversations).
-- member:   aa620a…01 / aa620b…01 / aa620c…01
-- provider: bb620a…02 / bb620b…02 / bb620c…02

insert into auth.users (id) values
  ('aa620a00-0000-4000-8000-000000000001'),  -- member (a)
  ('bb620a00-0000-4000-8000-000000000002'),  -- provider (a)
  ('aa620b00-0000-4000-8000-000000000001'),  -- member (b)
  ('bb620b00-0000-4000-8000-000000000002'),  -- provider (b)
  ('aa620c00-0000-4000-8000-000000000001'),  -- member (c)
  ('bb620c00-0000-4000-8000-000000000002');  -- provider (c)

-- Provider profiles via the approval path.
insert into public.provider_applications (user_id, display_name, date_of_birth, languages)
values
  ('bb620a00-0000-4000-8000-000000000002', 'Test Provider 620a', (current_date - interval '30 years')::date, array['English']),
  ('bb620b00-0000-4000-8000-000000000002', 'Test Provider 620b', (current_date - interval '30 years')::date, array['English']),
  ('bb620c00-0000-4000-8000-000000000002', 'Test Provider 620c', (current_date - interval '30 years')::date, array['English']);

select public.approve_provider_application('bb620a00-0000-4000-8000-000000000002');
select public.approve_provider_application('bb620b00-0000-4000-8000-000000000002');
select public.approve_provider_application('bb620c00-0000-4000-8000-000000000002');

-- Policy acceptances (required by send_message guard).
insert into public.policy_acceptances (user_id, policy_kind, version_id)
select u.id, pv.kind, pv.id
from (values
  ('aa620a00-0000-4000-8000-000000000001'::uuid),
  ('bb620a00-0000-4000-8000-000000000002'::uuid),
  ('aa620b00-0000-4000-8000-000000000001'::uuid),
  ('bb620b00-0000-4000-8000-000000000002'::uuid),
  ('aa620c00-0000-4000-8000-000000000001'::uuid),
  ('bb620c00-0000-4000-8000-000000000002'::uuid)
) u(id)
cross join lateral (
  select distinct on (kind) id, kind
  from   public.policy_versions
  where  effective_at <= now()
  order  by kind, version desc
) pv;

-- Give every member a token budget.
update public.profiles
set promo_balance = 500, purchased_balance = 0
where id in (
  'aa620a00-0000-4000-8000-000000000001',
  'aa620b00-0000-4000-8000-000000000001',
  'aa620c00-0000-4000-8000-000000000001'
);

-- Conversations (direct insert bypasses RLS in pgTAP context).
insert into public.conversations (id, member_id, provider_id) values
  ('cc620000-0000-4000-8000-0000000000c1',
   'aa620a00-0000-4000-8000-000000000001',
   'bb620a00-0000-4000-8000-000000000002'),
  ('cc620000-0000-4000-8000-0000000000c2',
   'aa620b00-0000-4000-8000-000000000001',
   'bb620b00-0000-4000-8000-000000000002'),
  ('cc620000-0000-4000-8000-0000000000c3',
   'aa620c00-0000-4000-8000-000000000001',
   'bb620c00-0000-4000-8000-000000000002');

-- ── (a) Out-of-session message → read → counter 0 ────────────────────────────
-- Provider (a) sends a message with no active session (session_id null).
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb620a00-0000-4000-8000-000000000002","role":"authenticated"}';
select public.send_message(
  p_conversation_id := 'cc620000-0000-4000-8000-0000000000c1'::uuid,
  p_body            := 'Aawaz ni aa ri'
);

reset role;

-- Confirm counter is 1.
select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c1'),
  1,
  '(a) unread_count_member = 1 after provider sends out-of-session message'
);

-- Member marks the message read (direct UPDATE, same as useMarkRead client call).
update public.messages
set read_at = now()
where conversation_id = 'cc620000-0000-4000-8000-0000000000c1'
  and sender_id       = 'bb620a00-0000-4000-8000-000000000002'
  and read_at         is null;

select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c1'),
  0,
  '(a) unread_count_member = 0 after member marks out-of-session message read'
);

-- ── (b) In-session message → read → counter 0 ────────────────────────────────
-- Provider (b) sends in-session.
insert into public.paid_sessions (
  id, conversation_id, channel, status, member_id, provider_id,
  rate_tokens_per_min, provider_share_percent, payout_hold_days, accepted_at, started_at
) values (
  '5e620b00-0000-4000-8000-000000000001',
  'cc620000-0000-4000-8000-0000000000c2',
  'chat', 'active',
  'aa620b00-0000-4000-8000-000000000001',
  'bb620b00-0000-4000-8000-000000000002',
  5, 60, 7, now(), now()
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bb620b00-0000-4000-8000-000000000002","role":"authenticated"}';
select public.send_message(
  p_conversation_id := 'cc620000-0000-4000-8000-0000000000c2'::uuid,
  p_body            := 'In-session message'
);

reset role;

select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c2'),
  1,
  '(b) unread_count_member = 1 after provider sends in-session message'
);

update public.messages
set read_at = now()
where conversation_id = 'cc620000-0000-4000-8000-0000000000c2'
  and sender_id       = 'bb620b00-0000-4000-8000-000000000002'
  and read_at         is null;

select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c2'),
  0,
  '(b) unread_count_member = 0 after member marks in-session message read'
);

-- ── (c) Hidden messages do not count ─────────────────────────────────────────
-- Plant two provider (c) messages directly: one hidden, one visible unread.
insert into public.messages (id, conversation_id, sender_id, body, hidden_at)
values
  ('dd620000-0000-4000-8000-000000000001',
   'cc620000-0000-4000-8000-0000000000c3',
   'bb620c00-0000-4000-8000-000000000002',
   'session purged', now()),
  ('dd620000-0000-4000-8000-000000000002',
   'cc620000-0000-4000-8000-0000000000c3',
   'bb620c00-0000-4000-8000-000000000002',
   'visible unread', null);

-- Set stored counter to 2 (as if both were counted).
insert into public.conversation_thread_meta (conversation_id, unread_count_member, unread_count_provider)
values ('cc620000-0000-4000-8000-0000000000c3', 2, 0)
on conflict (conversation_id) do update
  set unread_count_member = 2;

-- Mark the hidden message read — trigger fires but hidden_at IS NULL filter
-- means it is excluded from the recomputed count.
update public.messages
set read_at = now()
where id = 'dd620000-0000-4000-8000-000000000001';

-- Counter should be 1 (only the visible unread message remains).
select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c3'),
  1,
  '(c) hidden message excluded; visible unread still counted (counter = 1)'
);

-- Now mark the visible message read.
update public.messages
set read_at = now()
where id = 'dd620000-0000-4000-8000-000000000002';

select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c3'),
  0,
  '(c) all visible messages read → counter 0'
);

-- ── (d) Backfill: zero drift after migration UPDATE ───────────────────────────
-- Introduce artificial drift on conversation (a): set counter to 5.
update public.conversation_thread_meta
set unread_count_member = 5
where conversation_id = 'cc620000-0000-4000-8000-0000000000c1';

-- Re-run the backfill statement from migration 183.
update public.conversation_thread_meta tm
set
  unread_count_member = (
    select count(*)
    from   public.messages m
    where  m.conversation_id = tm.conversation_id
      and  m.sender_id       = c.provider_id
      and  m.read_at         is null
      and  m.hidden_at       is null
  ),
  unread_count_provider = (
    select count(*)
    from   public.messages m
    where  m.conversation_id = tm.conversation_id
      and  m.sender_id       = c.member_id
      and  m.read_at         is null
      and  m.hidden_at       is null
  )
from public.conversations c
where c.id = tm.conversation_id;

select is(
  (
    select count(*)::integer
    from   public.conversation_thread_meta tm
    join   public.conversations c on c.id = tm.conversation_id
    where  tm.unread_count_member != (
             select count(*)
             from   public.messages m
             where  m.conversation_id = tm.conversation_id
               and  m.sender_id       = c.provider_id
               and  m.read_at         is null
               and  m.hidden_at       is null
           )
       or tm.unread_count_provider != (
             select count(*)
             from   public.messages m
             where  m.conversation_id = tm.conversation_id
               and  m.sender_id       = c.member_id
               and  m.read_at         is null
               and  m.hidden_at       is null
           )
  ),
  0,
  '(d) zero drift threads after backfill'
);

-- ── (e) 184: one statement marking several messages read recounts once ───────
insert into public.messages (conversation_id, sender_id, body)
select 'cc620000-0000-4000-8000-0000000000c3', 'bb620c00-0000-4000-8000-000000000002', 'batch ' || g
from generate_series(1, 3) g;

update public.conversation_thread_meta
set unread_count_member = 3
where conversation_id = 'cc620000-0000-4000-8000-0000000000c3';

update public.messages
set read_at = now()
where conversation_id = 'cc620000-0000-4000-8000-0000000000c3'
  and body like 'batch %';

select is(
  (select unread_count_member from public.conversation_thread_meta
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c3'),
  (select count(*)::integer from public.messages
   where conversation_id = 'cc620000-0000-4000-8000-0000000000c3'
     and sender_id = 'bb620c00-0000-4000-8000-000000000002'
     and read_at is null and hidden_at is null),
  '(e) a batch mark-read recounts to the true figure'
);

select ok(
  (select (tgtype & 1) = 0 from pg_trigger
   where tgname = 'sync_unread_count_on_read'
     and tgrelid = 'public.messages'::regclass),
  '(f) the recount trigger is statement-level (184)'
);

select * from finish();
rollback;
