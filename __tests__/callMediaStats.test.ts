import { normalizeWebRtcStats } from '../src/api/callMedia/stats';

describe('vendor-neutral call quality normalization', () => {
  it('normalizes selected relay video/audio reports without retaining addresses', () => {
    const sample = normalizeWebRtcStats(
      'current',
      [
        {
          id: 'in-video',
          type: 'inbound-rtp',
          kind: 'video',
          bytesReceived: 2000,
          packetsLost: 2,
          packetsReceived: 98,
          jitter: 0.012,
          framesPerSecond: 24,
          frameWidth: 1280,
          frameHeight: 720,
          framesDropped: 3,
          totalFreezesDuration: 0.5,
          nackCount: 4,
          pliCount: 1,
        },
        {
          id: 'in-audio',
          type: 'inbound-rtp',
          kind: 'audio',
          concealedSamples: 120,
        },
        {
          id: 'out-video',
          type: 'outbound-rtp',
          kind: 'video',
          bytesSent: 3000,
        },
        {
          id: 'pair',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          localCandidateId: 'local',
          remoteCandidateId: 'remote',
          currentRoundTripTime: 0.045,
          availableOutgoingBitrate: 1_500_000,
        },
        {
          id: 'local',
          type: 'local-candidate',
          candidateType: 'relay',
          protocol: 'udp',
          address: '192.0.2.10',
        },
        {
          id: 'remote',
          type: 'remote-candidate',
          candidateType: 'srflx',
          address: '198.51.100.20',
        },
      ],
      1_788_523_200_000,
    );

    expect(sample).toEqual({
      backend: 'current',
      capturedAtMs: 1_788_523_200_000,
      connectionState: 'connected',
      networkTransport: 'udp',
      selectedRoute: 'relay-srflx',
      relay: true,
      bytesSent: 3000,
      bytesReceived: 2000,
      packetsLost: 2,
      packetsReceived: 98,
      jitterMs: 12,
      rttMs: 45,
      bitrateKbps: 1500,
      framesPerSecond: 24,
      frameWidth: 1280,
      frameHeight: 720,
      framesDropped: 3,
      freezeDurationMs: 500,
      nackCount: 4,
      pliCount: 1,
      audioConcealedSamples: 120,
    });
    expect(JSON.stringify(sample)).not.toMatch(
      /192\.0\.2\.10|198\.51\.100\.20|address/,
    );
  });

  it('returns null when no media or selected-pair report exists', () => {
    expect(normalizeWebRtcStats('livekit', [{ type: 'codec' }])).toBeNull();
  });
});
