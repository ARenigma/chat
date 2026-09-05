#!/usr/bin/env node
/**
 * Builds machine-readable QoE/economics evidence from physical call runs.
 * Restricted samples are read with service-role access; raw user IDs, phone
 * numbers, media, SDP, IPs and message content are never selected or emitted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'artifacts', 'call-sim');
const lines = readFileSync(join(OUT, 'runs.ndjson'), 'utf8')
  .split('\n')
  .filter(Boolean);
const runs = lines.map(line => JSON.parse(line));
if (runs.length === 0) throw new Error('No call simulation runs found');

const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const harnessIds = runs.map(run => run.runId);
const { data: qualityRuns, error: runError } = await supabase
  .from('call_quality_runs')
  .select('id,harness_run_id,backend,started_at,ended_at,termination_reason')
  .in('harness_run_id', harnessIds);
if (runError) throw new Error(runError.message);
const qualityIds = (qualityRuns ?? []).map(run => run.id);
const { data: samples, error: sampleError } = qualityIds.length
  ? await supabase
      .from('call_quality_samples')
      .select(
        'run_id,captured_at,connection_state,bytes_sent,bytes_received,' +
          'frames_per_second,frame_width,frame_height,freeze_duration_ms,' +
          'rtt_ms,jitter_ms,packets_lost,packets_received',
      )
      .in('run_id', qualityIds)
      .order('captured_at')
  : { data: [], error: null };
if (sampleError) throw new Error(sampleError.message);

const qualityByHarness = new Map();
for (const qualityRun of qualityRuns ?? []) {
  const list = qualityByHarness.get(qualityRun.harness_run_id) ?? [];
  list.push({
    ...qualityRun,
    samples: (samples ?? []).filter(sample => sample.run_id === qualityRun.id),
  });
  qualityByHarness.set(qualityRun.harness_run_id, list);
}

const percentile = (values, p) => {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1)
  ];
};
const mean = values =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
const groups = new Map();
for (const run of runs) {
  const medium = run.medium ?? 'video';
  const resolution = medium === 'video' ? run.resolution ?? 'hd' : 'n/a';
  const key = `${run.backend}:${medium}:${resolution}:${run.scenario}`;
  const group = groups.get(key) ?? [];
  group.push(run);
  groups.set(key, group);
}

const rates = {
  current: Number(process.env.CALL_SIM_RATE_INR_CURRENT ?? NaN),
  livekit: Number(process.env.CALL_SIM_RATE_INR_LIVEKIT ?? NaN),
  agora: Number(process.env.CALL_SIM_RATE_INR_AGORA ?? NaN),
};

const rows = [];
for (const [key, group] of groups) {
  const [backend, medium, resolution, scenario] = key.split(':');
  const valid = group.filter(run => run.outcome === 'completed');
  const setupMs = [];
  const dataBytes = [];
  const batteryPerMinute = [];
  const rtts = [];
  const jitters = [];
  const frameHeights = [];
  let frozenDurationMs = 0;
  let sampledDurationMs = 0;
  let reconnectAttempts = 0;
  let reconnectSuccesses = 0;
  const reconnectDurationsMs = [];
  const expectsRecovery = ['wifi-cell-handoff', 'netem-300-5-outage'].includes(
    scenario,
  );

  for (const run of valid) {
    const traces = qualityByHarness.get(run.runId) ?? [];
    const sessionStart = Date.parse(run.ledger?.session?.started_at ?? '');
    const orderedSamples = traces
      .flatMap(trace => trace.samples)
      .map(sample => ({
        ...sample,
        capturedAtMs: Date.parse(sample.captured_at),
      }))
      .filter(
        sample =>
          Number.isFinite(sample.capturedAtMs) &&
          (!Number.isFinite(sessionStart) ||
            sample.capturedAtMs >= sessionStart),
      )
      .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    const firstSample = traces
      .flatMap(trace => trace.samples)
      .filter(sample => sample.connection_state === 'connected')
      .map(sample => Date.parse(sample.captured_at))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    if (Number.isFinite(sessionStart) && Number.isFinite(firstSample)) {
      setupMs.push(Math.max(0, firstSample - sessionStart));
    }
    if (expectsRecovery) {
      reconnectAttempts += 1;
      const firstConnected = orderedSamples.findIndex(
        sample => sample.connection_state === 'connected',
      );
      const reconnectStart = orderedSamples.findIndex(
        (sample, index) =>
          index > firstConnected && sample.connection_state === 'connecting',
      );
      if (firstConnected >= 0 && reconnectStart < 0) {
        // The path changed without the peer connection dropping.
        reconnectSuccesses += 1;
        reconnectDurationsMs.push(0);
      } else if (reconnectStart >= 0) {
        const recovered = orderedSamples
          .slice(reconnectStart + 1)
          .find(sample => sample.connection_state === 'connected');
        if (recovered) {
          reconnectSuccesses += 1;
          reconnectDurationsMs.push(
            recovered.capturedAtMs -
              orderedSamples[reconnectStart].capturedAtMs,
          );
        }
      }
    }

    for (const trace of traces) {
      const traceSamples = trace.samples;
      const sentCounters = traceSamples
        .map(sample => sample.bytes_sent)
        .filter(value => value != null)
        .map(Number);
      const receivedCounters = traceSamples
        .map(sample => sample.bytes_received)
        .filter(value => value != null)
        .map(Number);
      if (sentCounters.length > 1 || receivedCounters.length > 1) {
        const sent =
          sentCounters.length > 1
            ? Math.max(0, sentCounters.at(-1) - sentCounters[0])
            : 0;
        const received =
          receivedCounters.length > 1
            ? Math.max(0, receivedCounters.at(-1) - receivedCounters[0])
            : 0;
        dataBytes.push(sent + received);
      }
      const freezeSamples = traceSamples.filter(
        sample => sample.freeze_duration_ms != null,
      );
      if (freezeSamples.length > 1) {
        const first = freezeSamples[0];
        const last = freezeSamples.at(-1);
        const firstFreeze = Number(first.freeze_duration_ms);
        const lastFreeze = Number(last.freeze_duration_ms);
        frozenDurationMs += Math.max(0, lastFreeze - firstFreeze);
        sampledDurationMs += Math.max(
          0,
          Date.parse(last.captured_at) - Date.parse(first.captured_at),
        );
      }
      for (const sample of traceSamples) {
        if (sample.rtt_ms != null) rtts.push(Number(sample.rtt_ms));
        if (sample.jitter_ms != null) jitters.push(Number(sample.jitter_ms));
        if (sample.frame_height != null)
          frameHeights.push(Number(sample.frame_height));
      }
    }

    const minutes = run.durationTargetSeconds / 60;
    const batteryDelta =
      run.battery.start.caller -
      run.battery.end.caller +
      run.battery.start.callee -
      run.battery.end.callee;
    batteryPerMinute.push(batteryDelta / 2 / minutes);
  }

  const completedMinutes = valid.reduce(
    (sum, run) => sum + run.durationTargetSeconds / 60,
    0,
  );
  const attemptedMinutes = group.reduce(
    (sum, run) => sum + run.durationTargetSeconds / 60,
    0,
  );
  const rate = rates[backend];
  rows.push({
    backend,
    medium,
    resolution,
    scenario,
    attempts: group.length,
    completed: valid.length,
    successRate: valid.length / group.length,
    setupP50Ms: percentile(setupMs, 0.5),
    setupP95Ms: percentile(setupMs, 0.95),
    medianFrameHeight: percentile(frameHeights, 0.5),
    freezeRatio:
      sampledDurationMs > 0 ? frozenDurationMs / sampledDurationMs : null,
    reconnectSuccessRate:
      reconnectAttempts > 0 ? reconnectSuccesses / reconnectAttempts : null,
    reconnectP95Ms: percentile(reconnectDurationsMs, 0.95),
    meanDataMbPerCompletedMinute:
      completedMinutes > 0
        ? (dataBytes.reduce((sum, value) => sum + value, 0) * 8) /
          1_000_000 /
          completedMinutes
        : null,
    meanBatteryPointsPerDeviceMinute: mean(batteryPerMinute),
    rttP95Ms: percentile(rtts, 0.95),
    jitterP95Ms: percentile(jitters, 0.95),
    inrPerCompletedMinute:
      Number.isFinite(rate) && completedMinutes > 0
        ? (attemptedMinutes * rate) / completedMinutes
        : null,
    vendorUsageReconciled: false,
  });
}

const thresholds = {
  mediaConnectSuccess: 0.98,
  setupP95Ms: 3000,
  reconnectSuccess: 0.95,
  reconnectP95Ms: 5000,
  freezeRatio: 0.02,
};
const report = {
  generatedAt: new Date().toISOString(),
  thresholds,
  caveats: [
    'Economics remain provisional until vendor usage consoles are reconciled.',
    'Reconnect gates remain unavailable until handoff/outage samples exist.',
    'Cost inputs are read from CALL_SIM_RATE_INR_CURRENT/LIVEKIT/AGORA.',
  ],
  rows,
};
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

const columns = Object.keys(rows[0]);
const csv = [
  columns.join(','),
  ...rows.map(row =>
    columns
      .map(column => {
        const value = row[column] ?? '';
        return typeof value === 'string'
          ? `"${value.replaceAll('"', '""')}"`
          : String(value);
      })
      .join(','),
  ),
].join('\n');
writeFileSync(join(OUT, 'report.csv'), `${csv}\n`);
console.log(
  `Wrote ${rows.length} backend/scenario row(s) to artifacts/call-sim/report.{json,csv}`,
);
