-- packet loss and MOS were never recorded, and two unrelated Agora metrics
-- overwrote each other in the one `quality` column. Telegram-CTO audit,
-- 2026-09-17, confirmed (M7).
--
-- `onNetworkQuality` (tx/rx signal quality, Agora's QualityType 0-6) and
-- `onRemoteAudioStats` (that same stream's own `.quality`, ALSO QualityType
-- 0-6) both wrote to agora.ts's one `quality` field on CallQualitySample --
-- different diagnostic dimensions, same column, whichever callback fired
-- last silently discarded the other's reading. Meanwhile the SDK's actual
-- loss-rate and MOS fields were never read at all:
--   RemoteAudioStats.audioLossRate  -- audio frame loss rate (%)
--   RemoteAudioStats.mosValue       -- Agora's real-time audio MOS, 0-500
--                                      (divide by 100 for the 0-5 score)
--   RemoteVideoStats.packetLossRate -- video packet loss (%) after
--                                      anti-packet-loss recovery
--
-- Four new columns, matching the existing convention (one column per
-- allowed JSON key, checked by an explicit allowlist in the RPC). `quality`
-- itself is untouched and keeps its existing meaning (the audio stream's own
-- QualityType); `network_quality` is the new, separate home for the tx/rx
-- reading that used to overwrite it.
alter table public.call_quality_samples
  add column network_quality integer check (network_quality between 0 and 6),
  add column audio_loss_rate numeric,
  add column video_loss_rate numeric,
  add column audio_mos_value integer;

create or replace function public.record_call_quality_samples(
  p_call_id uuid,
  p_samples jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_call public.calls%rowtype;
  v_run uuid;
  v_sample jsonb;
  v_count integer := 0;
  v_allowed constant text[] := array[
    'capturedAtMs', 'backend', 'connectionState', 'networkTransport',
    'selectedRoute', 'relay', 'bytesSent', 'bytesReceived', 'packetsLost',
    'packetsReceived', 'jitterMs', 'rttMs', 'bitrateKbps',
    'framesPerSecond', 'frameWidth', 'frameHeight', 'framesDropped',
    'freezeDurationMs', 'nackCount', 'pliCount', 'audioConcealedSamples',
    'cpuPercent', 'rssBytes', 'thermalStatus', 'quality',
    'networkQuality', 'audioLossRate', 'videoLossRate', 'audioMosValue'
  ];
begin
  if v_uid is null or jsonb_typeof(p_samples) <> 'array'
     or jsonb_array_length(p_samples) not between 1 and 10 then
    raise exception 'Invalid quality batch' using errcode = '22023';
  end if;

  select * into v_call from public.calls
  where id = p_call_id
    and v_uid in (caller_id, callee_id)
    and status in ('ringing', 'active', 'ended', 'failed');

  if not found then
    raise exception 'Not a call participant' using errcode = 'P0001';
  end if;

  insert into public.call_quality_runs (
    call_id, user_id, backend, experiment_id, harness_run_id, role
  ) values (
    v_call.id, v_uid, v_call.media_backend, v_call.media_experiment_id,
    v_call.media_run_id,
    case when v_uid = v_call.caller_id then 'caller' else 'callee' end
  )
  on conflict (call_id, user_id) do update
    set backend = excluded.backend
  returning id into v_run;

  for v_sample in select value from jsonb_array_elements(p_samples) loop
    if jsonb_typeof(v_sample) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_sample) as key
         where key <> all(v_allowed)
       )
       or v_sample ->> 'backend' is distinct from v_call.media_backend::text
    then
      raise exception 'Invalid quality sample' using errcode = '22023';
    end if;

    insert into public.call_quality_samples (
      run_id, captured_at, connection_state, network_transport,
      selected_route, relay, bytes_sent, bytes_received, packets_lost,
      packets_received, jitter_ms, rtt_ms, bitrate_kbps, frames_per_second,
      frame_width, frame_height, frames_dropped, freeze_duration_ms, nack_count,
      pli_count, audio_concealed_samples, cpu_percent, rss_bytes, thermal_status,
      quality, network_quality, audio_loss_rate, video_loss_rate, audio_mos_value
    ) values (
      v_run,
      to_timestamp((v_sample ->> 'capturedAtMs')::double precision / 1000),
      v_sample ->> 'connectionState',
      v_sample ->> 'networkTransport',
      v_sample ->> 'selectedRoute',
      (v_sample ->> 'relay')::boolean,
      (v_sample ->> 'bytesSent')::bigint,
      (v_sample ->> 'bytesReceived')::bigint,
      (v_sample ->> 'packetsLost')::bigint,
      (v_sample ->> 'packetsReceived')::bigint,
      (v_sample ->> 'jitterMs')::numeric,
      (v_sample ->> 'rttMs')::numeric,
      (v_sample ->> 'bitrateKbps')::numeric,
      (v_sample ->> 'framesPerSecond')::numeric,
      (v_sample ->> 'frameWidth')::integer,
      (v_sample ->> 'frameHeight')::integer,
      (v_sample ->> 'framesDropped')::bigint,
      (v_sample ->> 'freezeDurationMs')::numeric,
      (v_sample ->> 'nackCount')::bigint,
      (v_sample ->> 'pliCount')::bigint,
      (v_sample ->> 'audioConcealedSamples')::bigint,
      (v_sample ->> 'cpuPercent')::numeric,
      (v_sample ->> 'rssBytes')::bigint,
      (v_sample ->> 'thermalStatus')::integer,
      (v_sample ->> 'quality')::integer,
      (v_sample ->> 'networkQuality')::integer,
      (v_sample ->> 'audioLossRate')::numeric,
      (v_sample ->> 'videoLossRate')::numeric,
      (v_sample ->> 'audioMosValue')::integer
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.record_call_quality_samples(uuid, jsonb) is
  'Batched RTC quality sample insert. quality is the audio stream''s own '
  'QualityType (onRemoteAudioStats); network_quality is the separate tx/rx '
  'signal reading (onNetworkQuality) that used to overwrite it. '
  'audio_loss_rate/video_loss_rate are frame/packet loss percentages; '
  'audio_mos_value is Agora''s raw 0-500 MOS (divide by 100 for the 0-5 '
  'score). Migration 119, 2026-09-17.';
