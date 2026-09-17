import { useEffect, useState } from 'react';
import { useAgoraCallSession } from './agora';
import { getCallMediaCredentials } from './credentials';
import { useCallDiagnostics } from './diagnostics';
import type {
  CallMediaCredentials,
  CallMediaSession,
} from './types';

export type {
  CallConnState,
  CallMediaBackend,
  CallMediaSession,
  CallQualitySample,
  CallVideoSource,
} from './types';

const noop = () => undefined;
const noopAsync = async () => undefined;

const pendingSession: CallMediaSession = {
  backend: 'agora',
  connState: 'connecting',
  mediaReady: false,
  muted: false,
  mediaWarning: null,
  toggleMute: noop,
  speakerOn: false,
  setSpeaker: noop,
  localVideo: null,
  remoteVideo: null,
  videoEnabled: false,
  remoteVideoEnabled: false,
  enableVideo: noopAsync,
  disableVideo: noop,
  switchCamera: noop,
};
const failedSession: CallMediaSession = {
  ...pendingSession,
  connState: 'failed',
};

/**
 * Vendor boundary for call media.
 *
 * Production ships Agora only. The `CallMediaSession` contract and
 * `CallVideoView` stay vendor-shaped so LiveKit or DIY WebRTC can be re-added
 * as a second hook behind `enabled && credentials.backend === '…'` without
 * touching CallScreen. Server assignment still speaks the full enum.
 */
export function useCallSession(
  callId: string | null,
  _isCaller: boolean,
  enabled: boolean,
  /**
   * Video calls default to the speaker, voice calls to the earpiece — the
   * distinction is how the phone is held, so it belongs to the caller of this
   * hook rather than to the adapter.
   */
  defaultToSpeaker = false,
): CallMediaSession {
  const [credentialState, setCredentialState] = useState<{
    callId: string;
    value: CallMediaCredentials;
  }>();
  const credentials =
    credentialState?.callId === callId ? credentialState.value : undefined;
  const [failedCallId, setFailedCallId] = useState<string>();
  const credentialFailed = failedCallId === callId;
  useCallDiagnostics(enabled && callId !== null);

  useEffect(() => {
    if (!enabled || callId === null) {
      setCredentialState(undefined);
      setFailedCallId(undefined);
      return;
    }
    let live = true;
    setFailedCallId(undefined);
    void getCallMediaCredentials(callId)
      .then(value => {
        if (live) setCredentialState({ callId, value });
      })
      .catch(() => {
        if (live) setFailedCallId(callId);
      });
    return () => {
      live = false;
    };
  }, [callId, enabled]);

  const agoraEnabled =
    enabled && credentials?.backend === 'agora' && !credentialFailed;
  const agora = useAgoraCallSession(
    callId,
    agoraEnabled,
    credentials,
    defaultToSpeaker,
  );

  if (credentialFailed) return failedSession;
  if (!enabled || !credentials) return pendingSession;
  if (credentials.backend !== 'agora') {
    // Assigned a backend this binary does not ship. Fail loud rather than
    // inventing a silent fallback that would disagree with the peer.
    return failedSession;
  }
  return agora;
}
