/**
 * A live audio/video call over WebRTC, with signalling on a Realtime channel.
 *
 * The `calls` row (server) is the authoritative record of who called whom and
 * what it cost; this is the media that row bills for. SDP offers/answers and ICE
 * candidates ride a Supabase Realtime broadcast channel keyed on the call id and
 * are never written down — they are worthless a second after the call connects,
 * exactly as the migration 011 note intended.
 *
 * The handshake, deliberately simple for a 1:1 call:
 *   1. Both peers join `call:<id>`.
 *   2. The callee announces `ready` when its channel subscribes (it only joins
 *      after answering, so `ready` doubles as "I picked up").
 *   3. The caller, on `ready`, creates the offer and sends it.
 *   4. The callee answers; ICE flows both ways as candidates are gathered.
 * The caller joins first (it is on the outgoing screen before the callee
 * accepts), so it is always listening when `ready` arrives.
 *
 * Video architecture: every call negotiates a video transceiver from the start
 * with the camera off. Toggling video uses `RTCRtpSender.replaceTrack(track|null)`
 * — never add/remove-track mid-call — so no renegotiation is required. A
 * `video_toggle` broadcast on the same channel propagates the camera state to
 * the peer so it can show/hide the remote video surface.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { alertPermissionBlocked, requestAndroidPermission } from '../lib/permissions';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCRtpSender,
  RTCRtpEncodingParameters,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ICE_SERVERS } from './calls';

export type CallConnState = 'connecting' | 'connected' | 'failed' | 'closed';

interface Session {
  connState: CallConnState;
  muted: boolean;
  toggleMute: () => void;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  videoEnabled: boolean;
  remoteVideoEnabled: boolean;
  enableVideo: () => Promise<void>;
  disableVideo: () => void;
  switchCamera: () => void;
}

/**
 * Runs the media for one call. `enabled` gates when it starts — the caller turns
 * it on as the outgoing screen appears; the callee the moment it accepts — so
 * CallScreen can call the hook unconditionally (hook rules) while media only
 * runs when there is a call to run. Disabling it (or unmounting) tears
 * everything down: tracks stopped, peer closed, channel removed. So ending a
 * call is just leaving the screen.
 */
export function useCallSession(
  callId: string | null,
  isCaller: boolean,
  enabled: boolean,
): Session {
  const [connState, setConnState] = useState<CallConnState>('connecting');
  const [muted, setMuted] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
  const facingModeRef = useRef<'user' | 'environment'>('user');

  useEffect(() => {
    if (!enabled || callId === null) {
      return;
    }
    let cancelled = false;

    const send = (event: string, payload: Record<string, unknown>) => {
      void channelRef.current?.send({ type: 'broadcast', event, payload });
    };

    (async () => {
      // On Android, calling getUserMedia without a runtime RECORD_AUDIO grant
      // throws "mic could not be started" and crashes call setup. Request it
      // here, mirroring the CAMERA request in enableVideo(). Mirror approach:
      // on iOS the system permission sheet fires automatically from getUserMedia.
      if (Platform.OS === 'android') {
        const micOutcome = await requestAndroidPermission(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone',
            message: 'Pappal needs your microphone for calls.',
            buttonPositive: 'Allow',
          },
        );
        if (micOutcome === 'never_ask_again') {
          alertPermissionBlocked('Microphone (calls)');
          setConnState('failed');
          return;
        }
        if (micOutcome !== 'granted') {
          setConnState('failed');
          return;
        }
      }

      // Audio-only initial stream; the video transceiver is added to the peer
      // connection separately so the SDP always has a video m-line.
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      if (cancelled) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      // Add only the audio track. Video starts off and is added via replaceTrack.
      stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));

      // Negotiate a video m-line from the start (direction sendrecv, camera off)
      // so the SDP is stable throughout the call and no renegotiation is needed
      // when video is toggled. The sender has no track until enableVideo().
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
      videoSenderRef.current = videoTransceiver.sender;

      // Prefer H.264 for lower CPU decoding on Android. VP8 is the fallback when
      // H.264 capabilities are not reported by the platform (rare, not fatal).
      try {
        const caps = RTCRtpSender.getCapabilities('video');
        const h264 = caps.codecs.filter(c => c.mimeType.toLowerCase().includes('h264'));
        if (h264.length > 0) {
          videoTransceiver.setCodecPreferences(h264);
        }
      } catch {
        // setCodecPreferences is a best-effort optimisation; VP8 is fine.
      }

      // Capture the remote stream. The event fires once per track, but both the
      // audio and video track of a 1:1 call arrive on the same stream.
      // @ts-expect-error react-native-webrtc's event target types lag its runtime
      pc.addEventListener('track', (e: { streams: MediaStream[] }) => {
        if (e.streams[0]) {
          setRemoteStream(e.streams[0]);
        }
      });

      // @ts-expect-error react-native-webrtc's event target types lag its runtime
      pc.addEventListener('icecandidate', (e: { candidate: RTCIceCandidate | null }) => {
        if (e.candidate) {
          send('ice', { candidate: e.candidate.toJSON() });
        }
      });

      // @ts-expect-error see above
      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        if (s === 'connected') {
          setConnState('connected');
          // Cap the video sender to a mobile-friendly bitrate once the connection
          // is live. Best-effort: a failure here does not affect audio.
          const sender = videoSenderRef.current;
          if (sender) {
            void (async () => {
              try {
                const params = sender.getParameters();
                const enc = params.encodings[0] as RTCRtpEncodingParameters | undefined;
                if (enc) {
                  enc.maxBitrate = 1_500_000;
                  enc.maxFramerate = 24;
                }
                params.degradationPreference = 'balanced';
                await sender.setParameters(params);
              } catch {
                // Bitrate cap is a best-effort optimisation.
              }
            })();
          }
        } else if (s === 'failed') {
          setConnState('failed');
        } else if (s === 'closed' || s === 'disconnected') {
          setConnState('closed');
        }
      });

      const channel = supabase.channel(`call:${callId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      channel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (isCaller || pc.signalingState === 'closed') {
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('answer', { sdp: answer });
      });

      channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (!isCaller || pc.signalingState === 'closed') {
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      });

      channel.on('broadcast', { event: 'ice' }, async ({ payload }) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // A candidate arriving before the remote description is set is normal
          // early in the handshake; the retransmit covers it.
        }
      });

      // The caller, once the callee signals it has picked up, makes the offer.
      channel.on('broadcast', { event: 'ready' }, async () => {
        if (!isCaller || pc.signalingState === 'closed') {
          return;
        }
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        send('offer', { sdp: offer });
      });

      // Remote peer's camera state changed.
      channel.on('broadcast', { event: 'video_toggle' }, ({ payload }) => {
        setRemoteVideoEnabled(Boolean(payload.enabled));
      });

      channel.subscribe(status => {
        if (status === 'SUBSCRIBED' && !isCaller) {
          // Callee has joined (i.e. answered): tell the caller to send the offer.
          send('ready', {});
        }
      });
    })();

    return () => {
      cancelled = true;
      localRef.current?.getTracks().forEach(t => t.stop());
      localRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      setVideoEnabled(false);
      setRemoteVideoEnabled(false);
      videoSenderRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [callId, isCaller, enabled]);

  const toggleMute = () => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach(t => {
      t.enabled = !next;
    });
    setMuted(next);
  };

  /**
   * Request the camera permission, acquire a video track, and replace the
   * null track on the video sender so the remote peer receives video.
   * All state changes (videoEnabled, localStream) happen after the track is
   * in place, so the RTCView is never mounted on a stream without video.
   */
  const enableVideo = useCallback(async () => {
    const camOutcome = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (camOutcome === 'never_ask_again') {
      alertPermissionBlocked('Camera (video calls)');
      return;
    }
    if (camOutcome !== 'granted') {
      return;
    }
    if (!videoSenderRef.current) {
      return;
    }
    const videoStream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    const videoTrack = videoStream.getVideoTracks()[0];
    if (!videoTrack) {
      videoStream.getTracks().forEach(t => t.stop());
      return;
    }
    facingModeRef.current = 'user';
    await videoSenderRef.current.replaceTrack(videoTrack);
    localRef.current?.addTrack(videoTrack);
    setVideoEnabled(true);
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'video_toggle',
      payload: { enabled: true },
    });
  }, []);

  /**
   * Stop the local video track and send a null track to the sender so the
   * remote peer's video surface goes black.
   */
  const disableVideo = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    tracks.forEach(t => {
      t.stop();
      localRef.current?.removeTrack(t);
    });
    void videoSenderRef.current?.replaceTrack(null);
    setVideoEnabled(false);
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'video_toggle',
      payload: { enabled: false },
    });
  }, []);

  /**
   * Toggle between the front and rear cameras using applyConstraints.
   * `_switchCamera()` is deprecated in react-native-webrtc 124.x.
   */
  const switchCamera = useCallback(() => {
    const track = (localRef.current?.getVideoTracks() ?? [])[0];
    if (track === undefined) {
      return;
    }
    const next = facingModeRef.current === 'user' ? 'environment' : 'user';
    facingModeRef.current = next;
    void track.applyConstraints({ facingMode: next });
  }, []);

  return {
    connState,
    muted,
    toggleMute,
    localStream,
    remoteStream,
    videoEnabled,
    remoteVideoEnabled,
    enableVideo,
    disableVideo,
    switchCamera,
  };
}
