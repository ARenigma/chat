export type CallMediaBackend = 'current' | 'livekit' | 'agora';
export type CallConnState = 'connecting' | 'connected' | 'failed' | 'closed';

/**
 * Vendor-shaped video handle. Agora is the only shipped backend; other arms
 * remain in the type so a future SDK can re-enter CallVideoView without a
 * CallScreen rewrite.
 */
export type CallVideoSource = {
  backend: 'agora';
  uid: number;
  local: boolean;
};

export interface CallQualitySample {
  capturedAtMs: number;
  backend: CallMediaBackend;
  connectionState?: CallConnState;
  networkTransport?: string;
  selectedRoute?: string;
  relay?: boolean;
  bytesSent?: number;
  bytesReceived?: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitterMs?: number;
  rttMs?: number;
  bitrateKbps?: number;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesDropped?: number;
  freezeDurationMs?: number;
  nackCount?: number;
  pliCount?: number;
  audioConcealedSamples?: number;
  cpuPercent?: number;
  rssBytes?: number;
  thermalStatus?: number;
  quality?: number;
}

export interface CallMediaSession {
  backend: CallMediaBackend;
  connState: CallConnState;
  mediaReady: boolean;
  muted: boolean;
  toggleMute: () => void;
  /**
   * Audio route. `true` = built-in speaker, `false` = earpiece.
   *
   * Part of the media session rather than CallScreen state because the route is
   * the SDK's to own: an external device (wired or Bluetooth) overrides it, so a
   * local boolean in the screen would claim a route the user is not hearing.
   * https://docs.agora.io/en/video-calling/get-started/get-started-sdk
   */
  speakerOn: boolean;
  setSpeaker: (on: boolean) => void;
  localVideo: CallVideoSource | null;
  remoteVideo: CallVideoSource | null;
  videoEnabled: boolean;
  remoteVideoEnabled: boolean;
  enableVideo: () => Promise<void>;
  disableVideo: () => void;
  switchCamera: () => void;
}

export interface CallMediaCredentials {
  backend: CallMediaBackend;
  callId: string;
  expiresAt: string;
  appId?: string;
  endpoint?: string;
  token?: string;
  room?: string;
  uid?: number;
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
}
