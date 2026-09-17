export type CallMediaBackend = 'current' | 'livekit' | 'agora';
/**
 * `'reconnecting'` added 2026-09-17: a peer's media timing out (Agora's
 * `UserOfflineDropped`, ~20s of no packets) or the local link itself
 * dropping (`ConnectionStateReconnecting`) used to be folded into
 * `'connecting'` or `'closed'` — both wrong, both indistinguishable from a
 * real hang-up or a fresh cold start. See agora.ts's `onUserOffline` and
 * `onConnectionStateChanged` for where each is now produced, and
 * CallScreen.tsx for why it deliberately does NOT interrupt the running
 * call timer (the server keeps billing through a reconnect; freezing the
 * clock would only make the screen lie about that, not fix it).
 */
export type CallConnState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed';

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
  /**
   * Set when the SDK reports the local mic or camera stopped for a reason
   * other than the member's own mute/camera-off (L1, 2026-09-17 audit) —
   * device busy, capture failed, no permission, an interrupting phone call.
   * `null` means healthy (or muted/disabled by the member, which is not a
   * warning). CallScreen surfaces this as a notice; it is not itself UI.
   */
  mediaWarning: 'mic' | 'camera' | null;
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
