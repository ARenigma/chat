\set ON_ERROR_STOP on
begin;
select plan(24);

select ok(
  position(
    '''media_backend'', v_call.media_backend' in pg_get_functiondef(
      'public.start_call(uuid, public.call_medium)'::regprocedure
    )
  ) > 0,
  'start_call returns the backend assigned by the insert trigger'
);

insert into auth.users (id) values
  ('ca100000-0000-4000-8000-000000000001'),
  ('ca100000-0000-4000-8000-000000000002'),
  ('ca100000-0000-4000-8000-000000000003');

create temporary table media_thread as
with inserted as (
  insert into public.conversations (member_id, provider_id)
  values (
    'ca100000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000002'
  )
  returning id
)
select id from inserted;
grant select on media_thread to authenticated;

create temporary table media_first_call as
with inserted as (
  insert into public.calls (
    conversation_id, caller_id, callee_id, medium, status, ended_at
  )
  select id,
    'ca100000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000002',
    'video', 'ended', now()
  from media_thread
  returning id, media_backend
)
select * from inserted;

create temporary table media_second_call as
with inserted as (
  insert into public.calls (
    conversation_id, caller_id, callee_id, medium, status, ended_at
  )
  select id,
    'ca100000-0000-4000-8000-000000000002',
    'ca100000-0000-4000-8000-000000000001',
    'video', 'ended', now()
  from media_thread
  returning id, media_backend
)
select * from inserted;

select is(
  (select media_backend::text from media_first_call),
  (select media_backend::text from media_second_call),
  'default agora assignment is stable when caller and callee rotate'
);

select is(
  (select media_experiment_id from public.calls
   where id = (select id from media_first_call)),
  'agora-default',
  'normal calls are stamped with the agora-default experiment'
);

select is(
  (select media_assignment_kind from public.calls
   where id = (select id from media_first_call)),
  'default',
  'normal calls use assignment kind default'
);

insert into public.call_media_test_allowlist (user_id, expires_at)
values ('ca100000-0000-4000-8000-000000000001', now() + interval '1 hour');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  format(
    'select public.set_next_call_media_backend(%L, %L, %L, %L)',
    (select id from media_thread),
    'agora',
    'media-pilot',
    'ca200000-0000-4000-8000-000000000001'
  ),
  'P0001',
  'Participants are not allowlisted',
  'one allowlisted participant cannot force a harness arm'
);

reset role;
insert into public.call_media_test_allowlist (user_id, expires_at)
values ('ca100000-0000-4000-8000-000000000002', now() + interval '1 hour');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  format(
    'select public.set_next_call_media_backend(%L, %L, %L, %L)',
    (select id from media_thread),
    'agora',
    'media-pilot',
    'ca200000-0000-4000-8000-000000000001'
  ),
  'either allowlisted participant can schedule the conversation next arm'
);

reset role;
create temporary table media_override_call as
with inserted as (
  insert into public.calls (
    conversation_id, caller_id, callee_id, medium, status, ended_at
  )
  select id,
    'ca100000-0000-4000-8000-000000000001',
    'ca100000-0000-4000-8000-000000000002',
    'video', 'ended', now()
  from media_thread
  returning id
)
select id from inserted;
grant select on media_override_call to authenticated;

select is(
  (select media_backend::text from public.calls
   where id = (select id from media_override_call)),
  'agora',
  'scheduled backend is persisted on the authoritative call row'
);

select is(
  (select media_assignment_kind from public.calls
   where id = (select id from media_override_call)),
  'harness',
  'scheduled call is marked as a harness assignment'
);

select is(
  (select media_run_id from public.calls
   where id = (select id from media_override_call)),
  'ca200000-0000-4000-8000-000000000001'::uuid,
  'both endpoints share one persisted harness run id'
);

select is(
  (select count(*)::integer from public.call_media_overrides),
  0,
  'harness override is consumed exactly once'
);

select ok(
  not has_table_privilege('authenticated', 'public.call_quality_runs', 'SELECT')
  and not has_table_privilege('authenticated', 'public.call_quality_samples', 'SELECT'),
  'clients cannot read restricted QoE traces'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format(
    'select public.record_call_quality_samples(%L, %L::jsonb)',
    (select id from media_override_call),
    '[{"capturedAtMs":1788523200000,"backend":"agora"}]'
  ),
  'P0001',
  'Not a call participant',
  'non-participant cannot write QoE evidence or obtain call context'
);

set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.record_call_quality_samples(
    (select id from media_override_call),
    '[{"capturedAtMs":1788523200000,"backend":"agora","rttMs":42,"quality":2}]'::jsonb
  ),
  1,
  'participant can append a bounded vendor-neutral sample'
);

select throws_ok(
  format(
    'select public.record_call_quality_samples(%L, %L::jsonb)',
    (select id from media_override_call),
    '[{"capturedAtMs":1788523200000,"backend":"agora","phoneNumber":"secret"}]'
  ),
  '22023',
  'Invalid quality sample',
  'PII-shaped or unknown sample fields are rejected'
);

select throws_ok(
  format(
    'select public.record_call_quality_samples(%L, %L::jsonb)',
    (select id from media_override_call),
    '[{"capturedAtMs":1788523200000,"backend":"livekit"}]'
  ),
  '22023',
  'Invalid quality sample',
  'sample backend cannot disagree with server assignment'
);

reset role;
select is(
  (select count(*)::integer from public.call_quality_samples),
  1,
  'only the valid sample reached restricted storage'
);
select is(
  (select quality from public.call_quality_samples),
  2,
  'Agora network quality survives restricted telemetry storage'
);

-- M7, 2026-09-17 audit: networkQuality/audioLossRate/videoLossRate/
-- audioMosValue are new columns (migration 119), separate from `quality`
-- above rather than overwriting it.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  public.record_call_quality_samples(
    (select id from media_override_call),
    '[{"capturedAtMs":1788523200000,"backend":"agora","networkQuality":3,"audioLossRate":1.5,"videoLossRate":2.25,"audioMosValue":410}]'::jsonb
  ),
  1,
  'a sample carrying the new loss-rate/MOS fields is accepted'
);

reset role;
select is(
  (select network_quality from public.call_quality_samples order by id desc limit 1),
  3,
  'networkQuality lands in its own column, separate from quality'
);
select is(
  (select audio_loss_rate from public.call_quality_samples order by id desc limit 1),
  1.5,
  'audioLossRate is recorded'
);
select is(
  (select video_loss_rate from public.call_quality_samples order by id desc limit 1),
  2.25,
  'videoLossRate is recorded'
);
select is(
  (select audio_mos_value from public.call_quality_samples order by id desc limit 1),
  410,
  'audioMosValue is recorded'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::integer from public.calls
   where id = (select id from media_override_call)),
  1,
  'participant RLS exposes the assigned call to token authorization'
);

set local request.jwt.claims =
  '{"sub":"ca100000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::integer from public.calls
   where id = (select id from media_override_call)),
  0,
  'outsider RLS hides the call from token authorization'
);

select * from finish();
rollback;
