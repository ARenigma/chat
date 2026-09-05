import { supabase } from '../../lib/supabase';
import type { CallQualitySample } from './types';

const pending = new Map<string, CallQualitySample[]>();
const flushing = new Map<string, Promise<void>>();
const MAX_BATCH = 10;
let diagnostics: Partial<CallQualitySample> = {};

export function setCallDiagnostics(
  value: Partial<CallQualitySample>,
): void {
  diagnostics = value;
}

/**
 * Buffers two-second RTC samples so quality telemetry cannot interfere with the
 * media thread. The database RPC verifies call membership and rejects payloads
 * containing identifiers or content.
 */
export function queueCallQualitySample(
  callId: string,
  sample: CallQualitySample,
): void {
  const samples = pending.get(callId) ?? [];
  samples.push({ ...diagnostics, ...sample });
  pending.set(callId, samples);
  if (samples.length >= MAX_BATCH) {
    void flushCallQualitySamples(callId);
  }
}

export async function flushCallQualitySamples(callId: string): Promise<void> {
  const active = flushing.get(callId);
  if (active) return active;

  const operation = (async () => {
    while (true) {
      const queued = pending.get(callId);
      if (!queued || queued.length === 0) {
        pending.delete(callId);
        return;
      }

      const batch = queued.splice(0, MAX_BATCH);
      if (queued.length === 0) pending.delete(callId);
      const payload = batch.map(sample => ({ ...sample })) as Array<
        Record<string, unknown>
      >;
      const { error } = await supabase.rpc('record_call_quality_samples', {
        p_call_id: callId,
        p_samples: payload,
      });
      if (error) {
        const retry = pending.get(callId) ?? [];
        // Preserve chronology and bound memory, but never send more than the
        // server's ten-sample RPC contract in a single request.
        pending.set(
          callId,
          [...batch, ...retry].slice(0, MAX_BATCH * 3),
        );
        return;
      }
    }
  })();

  flushing.set(callId, operation);
  try {
    await operation;
  } finally {
    flushing.delete(callId);
  }
}

export function clearCallQualitySamples(callId: string): void {
  pending.delete(callId);
}
