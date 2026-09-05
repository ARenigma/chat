import type { CallMediaBackend, CallQualitySample } from './types';

type Stat = Record<string, unknown>;

function numeric(stat: Stat | undefined, key: string): number | undefined {
  const value = stat?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function reports(value: unknown): Stat[] {
  if (Array.isArray(value)) return value.filter(isStat);
  if (value && typeof value === 'object') {
    const result: Stat[] = [];
    const candidate = value as {
      forEach?: (callback: (item: unknown) => void) => void;
      values?: () => IterableIterator<unknown>;
    };
    if (typeof candidate.forEach === 'function') {
      candidate.forEach(item => {
        if (isStat(item)) result.push(item);
      });
      return result;
    }
    return Object.values(value).filter(isStat);
  }
  return [];
}

function isStat(value: unknown): value is Stat {
  return value !== null && typeof value === 'object';
}

/** Maps W3C WebRTC reports from Current/LiveKit into one vendor-neutral row. */
export function normalizeWebRtcStats(
  backend: Extract<CallMediaBackend, 'current' | 'livekit'>,
  report: unknown,
  capturedAtMs = Date.now(),
): CallQualitySample | null {
  const all = reports(report);
  const inbound = all.find(
    stat => stat.type === 'inbound-rtp' && stat.kind === 'video',
  );
  const outbound = all.find(
    stat => stat.type === 'outbound-rtp' && stat.kind === 'video',
  );
  const inboundAudio = all.find(
    stat => stat.type === 'inbound-rtp' && stat.kind === 'audio',
  );
  const pair = all.find(
    stat =>
      stat.type === 'candidate-pair' &&
      stat.state === 'succeeded' &&
      (stat.nominated === true || stat.selected === true),
  );
  const fallbackPair = pair ?? all.find(
    stat => stat.type === 'candidate-pair' && stat.state === 'succeeded',
  );
  const localCandidate = all.find(
    stat => stat.id === fallbackPair?.localCandidateId,
  );
  const remoteCandidate = all.find(
    stat => stat.id === fallbackPair?.remoteCandidateId,
  );
  if (!inbound && !outbound && !fallbackPair) return null;

  const rttSeconds = numeric(fallbackPair, 'currentRoundTripTime');
  const localType =
    typeof localCandidate?.candidateType === 'string'
      ? localCandidate.candidateType
      : undefined;
  const remoteType =
    typeof remoteCandidate?.candidateType === 'string'
      ? remoteCandidate.candidateType
      : undefined;
  const protocol =
    typeof localCandidate?.protocol === 'string'
      ? localCandidate.protocol
      : undefined;
  return {
    backend,
    capturedAtMs,
    connectionState: fallbackPair ? 'connected' : undefined,
    networkTransport: protocol,
    selectedRoute:
      localType && remoteType ? `${localType}-${remoteType}` : undefined,
    relay: localType === 'relay' || remoteType === 'relay',
    bytesSent: numeric(outbound, 'bytesSent'),
    bytesReceived: numeric(inbound, 'bytesReceived'),
    packetsLost: numeric(inbound, 'packetsLost'),
    packetsReceived: numeric(inbound, 'packetsReceived'),
    jitterMs:
      numeric(inbound, 'jitter') === undefined
        ? undefined
        : numeric(inbound, 'jitter')! * 1000,
    rttMs: rttSeconds === undefined ? undefined : rttSeconds * 1000,
    bitrateKbps:
      numeric(fallbackPair, 'availableOutgoingBitrate') === undefined
        ? undefined
        : numeric(fallbackPair, 'availableOutgoingBitrate')! / 1000,
    framesPerSecond: numeric(inbound, 'framesPerSecond'),
    frameWidth: numeric(inbound, 'frameWidth'),
    frameHeight: numeric(inbound, 'frameHeight'),
    framesDropped: numeric(inbound, 'framesDropped'),
    freezeDurationMs:
      numeric(inbound, 'totalFreezesDuration') === undefined
        ? undefined
        : numeric(inbound, 'totalFreezesDuration')! * 1000,
    nackCount: numeric(inbound, 'nackCount'),
    pliCount: numeric(inbound, 'pliCount'),
    audioConcealedSamples: numeric(inboundAudio, 'concealedSamples'),
  };
}
