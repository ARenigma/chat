import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  AudioProfileType,
  AudioScenarioType,
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  DegradationPreference,
  ErrorCodeType,
  UserOfflineReasonType,
  VideoCodecType,
  createAgoraRtcEngine,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';
import {
  alertPermissionBlocked,
  requestAndroidPermission,
} from '../../lib/permissions';
import { getCallMediaCredentials } from './credentials';
import { flushCallQualitySamples, queueCallQualitySample } from './quality';
import { getVideoCaptureProfile } from './profile';
import type {
  CallMediaCredentials,
  CallMediaSession,
  CallQualitySample,
  CallVideoSource,
} from './types';

const VIDEO_UID_LOCAL = 0;

/**
 * Agora RTC adapter. Product ringing, paid-session leases and FCM stay in
 * Supabase; Agora owns only media transport.
 *
 * https://docs.agora.io/en/video-calling/get-started/get-started-sdk
 * https://docs.agora.io/en/realtime-media/video/build/manage-connection-and-quality/in-call-quality-monitoring/android
 */
export function useAgoraCallSession(
  callId: string | null,
  enabled: boolean,
  credentials?: CallMediaCredentials,
  defaultToSpeaker = false,
): CallMediaSession {
  const [connState, setConnState] =
    useState<CallMediaSession['connState']>('connecting');
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(defaultToSpeaker);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const engineRef = useRef<IRtcEngine | null>(null);
  // In a ref, not the effect's deps: the route default is fixed for the life of
  // a call, and re-running the join effect would drop the channel.
  const defaultSpeakerRef = useRef(defaultToSpeaker);
  defaultSpeakerRef.current = defaultToSpeaker;
  const remotePresentRef = useRef(false);
  const connectionStateRef =
    useRef<CallMediaSession['connState']>('connecting');
  const latestQualityRef = useRef<Partial<CallQualitySample>>({});

  useEffect(() => {
    if (!enabled || callId === null || credentials?.backend !== 'agora') return;
    if (
      !credentials.appId ||
      !credentials.token ||
      !credentials.room ||
      !credentials.uid
    ) {
      setConnState('failed');
      return;
    }
    const appId = credentials.appId;
    const token = credentials.token;
    const room = credentials.room;
    const localUid = credentials.uid;
    let cancelled = false;
    let eventHandler: IRtcEngineEventHandler | undefined;
    const updateConnectionState = (state: CallMediaSession['connState']) => {
      connectionStateRef.current = state;
      if (!cancelled) {
        setConnState(state);
        queueCallQualitySample(callId, {
          backend: 'agora',
          capturedAtMs: Date.now(),
          connectionState: state,
        });
      }
    };

    const join = (engine: IRtcEngine, nextToken: string) =>
      engine.joinChannel(nextToken, room, localUid, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
        publishMicrophoneTrack: true,
        publishCameraTrack: false,
        autoSubscribeAudio: true,
        autoSubscribeVideo: true,
      });

    const renewToken = async (engine: IRtcEngine, rejoin: boolean) => {
      try {
        const next = await getCallMediaCredentials(callId);
        if (next.backend !== 'agora' || !next.token)
          throw new Error('Invalid Agora renewal');
        if (rejoin) {
          engine.leaveChannel();
          if (join(engine, next.token) < 0)
            throw new Error('Agora rejoin failed');
        } else if (engine.renewToken(next.token) < 0) {
          throw new Error('Agora token renewal failed');
        }
      } catch {
        if (!cancelled) setConnState('failed');
      }
    };

    void (async () => {
      if (Platform.OS === 'android') {
        const outcome = await requestAndroidPermission(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone',
            message: 'Pappal needs your microphone for calls.',
            buttonPositive: 'Allow',
          },
        );
        if (outcome === 'never_ask_again') {
          alertPermissionBlocked('Microphone (calls)');
        }
        if (outcome !== 'granted') {
          setConnState('failed');
          return;
        }
      }
      if (cancelled) return;

      const engine = createAgoraRtcEngine();
      engineRef.current = engine;
      const handler: IRtcEngineEventHandler = {
        onUserJoined: (_connection, remoteUserUid) => {
          if (cancelled) return;
          remotePresentRef.current = true;
          setRemoteUid(remoteUserUid);
          updateConnectionState('connected');
        },
        onUserOffline: (_connection, _remoteUserUid, reason) => {
          remotePresentRef.current = false;
          /*
           * The reason is now READ, not discarded (2026-09-17 audit).
           * `UserOfflineQuit` is a real goodbye — the peer actually left,
           * `'closed'` and CallScreen's terminal handling are correct.
           * `UserOfflineDropped` is Agora's own timeout for "no packets from
           * the other party for ~20 s" — exactly a network blip, not a
           * hang-up, and reporting it as one ended a still-continuing call
           * the moment a lift or a patchy handover interrupted it. Mapped to
           * `'reconnecting'` instead: CallScreen keeps the screen (and the
           * running timer — the server keeps billing through a reconnect,
           * so freezing the clock would only make the screen understate what
           * is being charged) and gives the media a bounded recovery window
           * before giving up for real.
           */
          updateConnectionState(
            reason === UserOfflineReasonType.UserOfflineDropped
              ? 'reconnecting'
              : 'closed',
          );
        },
        onUserMuteVideo: (_connection, remoteUserUid, isMuted) => {
          if (!cancelled) {
            setRemoteUid(remoteUserUid);
            setRemoteVideoEnabled(!isMuted);
          }
        },
        onFirstRemoteVideoDecoded: (_connection, remoteUserUid) => {
          if (!cancelled) {
            setRemoteUid(remoteUserUid);
            setRemoteVideoEnabled(true);
          }
        },
        onConnectionStateChanged: (_connection, state) => {
          if (cancelled) return;
          if (state === ConnectionStateType.ConnectionStateConnected) {
            // Joining Agora's edge is not the same as the other endpoint
            // answering. Billing/UI become active only after onUserJoined.
            updateConnectionState(
              remotePresentRef.current ? 'connected' : 'connecting',
            );
          } else if (state === ConnectionStateType.ConnectionStateConnecting) {
            updateConnectionState('connecting');
          } else if (state === ConnectionStateType.ConnectionStateReconnecting) {
            /*
             * Was folded into the same 'connecting' as a cold start
             * (2026-09-17 audit): the LOCAL link dropping mid-call (a lift,
             * a Wi-Fi/cellular handover) looked identical to the call still
             * dialling for the first time, so nothing on screen could ever
             * say "your own connection just hiccupped" as opposed to "we are
             * still setting up". See onUserOffline above for the matching
             * fix on the PEER's side of the same problem.
             */
            updateConnectionState('reconnecting');
          } else if (state === ConnectionStateType.ConnectionStateFailed) {
            updateConnectionState('failed');
          }
        },
        onNetworkQuality: (_connection, _uid, txQuality, rxQuality) => {
          latestQualityRef.current.quality = Math.max(txQuality, rxQuality);
        },
        onRemoteAudioStats: (_connection, stats) => {
          latestQualityRef.current = {
            ...latestQualityRef.current,
            jitterMs: stats.jitterBufferDelay,
            quality: stats.quality,
          };
        },
        onLocalVideoStats: (_connection, _source, stats) => {
          latestQualityRef.current = {
            ...latestQualityRef.current,
            bitrateKbps: stats.sentBitrate,
            framesPerSecond: stats.sentFrameRate,
            frameWidth: stats.encodedFrameWidth,
            frameHeight: stats.encodedFrameHeight,
          };
        },
        onRemoteVideoStats: (_connection, stats) => {
          latestQualityRef.current = {
            ...latestQualityRef.current,
            bitrateKbps: stats.receivedBitrate,
            framesPerSecond: stats.rendererOutputFrameRate,
            frameWidth: stats.width,
            frameHeight: stats.height,
            freezeDurationMs: stats.totalFrozenTime,
          };
        },
        // Agora requires fetching a fresh server-minted token and passing it to
        // renewToken when this callback fires 30 seconds before expiration.
        // https://docs.agora.io/en/realtime-media/video/build/authenticate-users/authentication-workflow/react-native
        onTokenPrivilegeWillExpire: () => {
          const currentEngine = engineRef.current;
          if (currentEngine) void renewToken(currentEngine, false);
        },
        // Once privilege has expired Agora documents a full token-backed rejoin.
        onRequestToken: () => {
          const currentEngine = engineRef.current;
          if (currentEngine) void renewToken(currentEngine, true);
        },
        onRtcStats: (_connection, stats) => {
          queueCallQualitySample(callId, {
            ...latestQualityRef.current,
            backend: 'agora',
            capturedAtMs: Date.now(),
            connectionState: connectionStateRef.current,
            bytesSent: stats.txBytes,
            bytesReceived: stats.rxBytes,
            bitrateKbps:
              latestQualityRef.current.bitrateKbps ?? stats.txKBitRate,
            // Agora documents this as last-mile edge latency, not peer RTT.
            rttMs: stats.lastmileDelay,
            cpuPercent: stats.cpuAppUsage,
            rssBytes:
              stats.memoryAppUsageInKbytes === undefined
                ? undefined
                : stats.memoryAppUsageInKbytes * 1024,
          });
        },
        /*
         * Three codes excluded from the blanket 'failed' mapping
         * (2026-09-17 audit, scoped down from the original finding after
         * checking the installed SDK's own docblocks — the fuller proposal
         * to delete the leave+rejoin renewal fallback and raise the token
         * TTL was NOT taken; see renewToken above for why).
         *
         * ErrTokenExpired (109) / ErrInvalidToken (110): both carry a
         * DEPRECATED tag in this SDK version pointing at
         * onConnectionStateChanged's ConnectionStateTokenExpired /
         * ConnectionStateInvalidToken instead (AgoraBase.ts:288-296) — the
         * lifecycle these two numbers describe is already owned by
         * onTokenPrivilegeWillExpire (pre-emptive renewal, 30s early) and
         * onRequestToken (the post-expiry rejoin) below. Excluded so that
         * IF this SDK ever still emits them as a legacy compatibility
         * path, they cannot double-report a lifecycle those two callbacks
         * already handle.
         *
         * ErrJoinChannelRejected (17): the documented consequence of
         * `renewToken`'s own leave+rejoin branch below — `leaveChannel()`
         * is asynchronous ("the channel has not actually been left" the
         * instant the call returns, IAgoraRtcEngine.ts:3422) and the very
         * next line calls `join()`, which can race the still-in-progress
         * leave and get rejected. That is a known artifact of a
         * vendor-sanctioned recovery path (IAgoraRtcEngine.ts:2088-2091
         * documents leave+rejoin as one of the two supported post-expiry
         * remedies), not evidence the call itself failed.
         *
         * Every other code still ends the call: this is a narrow
         * exclusion list, not a general "ignore errors" policy.
         */
        onError: err => {
          if (
            err === ErrorCodeType.ErrTokenExpired ||
            err === ErrorCodeType.ErrInvalidToken ||
            err === ErrorCodeType.ErrJoinChannelRejected
          ) {
            return;
          }
          updateConnectionState('failed');
        },
      };
      eventHandler = handler;

      engine.initialize({ appId });
      engine.registerEventHandler(handler);
      engine.setChannelProfile(
        ChannelProfileType.ChannelProfileCommunication1v1,
      );
      /*
       * Speech profile + low-latency scenario, set before joining. Without this,
       * Communication1v1 defaults to AudioProfileDefault / AudioScenarioDefault,
       * which routes VoIP through the MUSIC pipeline: wider codec, bigger buffers,
       * and the "very laggy audio" reported on device. SpeechStandard is 16 kHz
       * mono Opus tuned for voice; GameStreaming is Agora's low-latency scenario
       * with hardware echo cancellation / noise suppression. The video encoder
       * below is configured explicitly for the same reason — the audio encoder was
       * the only leg left on defaults.
       * https://docs.agora.io/en/video-calling/develop/audio-and-voice-effects
       */
      engine.setAudioProfile(
        AudioProfileType.AudioProfileSpeechStandard,
        AudioScenarioType.AudioScenarioGameStreaming,
      );
      /*
       * The default audio route, set before joining so the first second of
       * audio already comes out of the right place: earpiece for a voice call
       * (it is held to the ear), speaker for video (it is held at arm's length).
       *
       * `setDefaultAudioRouteToSpeakerphone` is the channel default;
       * `setEnableSpeakerphone` below overrides it for this channel only when
       * the member taps Speaker. Agora's own note says NOT to mix either with
       * `setRouteInCommunicationMode`, so that API is deliberately unused.
       * https://docs.agora.io/en/video-calling/get-started/get-started-sdk
       */
      engine.setDefaultAudioRouteToSpeakerphone(defaultSpeakerRef.current);
      const profile = getVideoCaptureProfile();
      engine.setVideoEncoderConfiguration({
        codecType: VideoCodecType.VideoCodecH264,
        dimensions: { width: profile.width, height: profile.height },
        frameRate: profile.maxFramerate,
        // Agora's bitrate is kbps; the shared profile stores bps.
        bitrate: Math.round(profile.maxBitrate / 1000),
        degradationPreference: DegradationPreference.MaintainBalanced,
      });
      const result = join(engine, token);
      if (result < 0) updateConnectionState('failed');
    })();

    return () => {
      cancelled = true;
      void flushCallQualitySamples(callId);
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        engine.leaveChannel();
        if (eventHandler) engine.unregisterEventHandler(eventHandler);
        engine.release();
      }
      setRemoteUid(null);
      remotePresentRef.current = false;
      setVideoEnabled(false);
      setRemoteVideoEnabled(false);
    };
  }, [callId, credentials, enabled]);

  const toggleMute = useCallback(() => {
    setMuted(previous => {
      const next = !previous;
      engineRef.current?.muteLocalAudioStream(next);
      return next;
    });
  }, []);

  /*
   * THE SPEAKER BUTTON. Until 2026-09-08 this was `setSpeakerOn(v => !v)` in
   * CallScreen and nothing else — the pill lit up and the audio route never
   * moved (the comment there said "audio-route wiring is a follow-up (no
   * InCallManager yet)"). Reported from a device by Amit: "speaker button not
   * working in audio call and /or video call".
   *
   * No new dependency: the Agora engine already owns the route, so asking it is
   * both correct and one call. `setEnableSpeakerphone` affects the current
   * channel only, which is what a per-call toggle means.
   */
  const setSpeaker = useCallback((on: boolean) => {
    // Only claim the new state if the SDK accepted it; a negative return is a
    // failure and leaving the pill lit would lie about where the audio is.
    if ((engineRef.current?.setEnableSpeakerphone(on) ?? -1) < 0) return;
    setSpeakerOn(on);
  }, []);

  const enableVideo = useCallback(async () => {
    const outcome = await requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    if (outcome === 'never_ask_again') {
      alertPermissionBlocked('Camera (video calls)');
      return;
    }
    if (outcome !== 'granted' || !engineRef.current) return;
    engineRef.current.enableVideo();
    engineRef.current.startPreview();
    engineRef.current.updateChannelMediaOptions({ publishCameraTrack: true });
    engineRef.current.muteLocalVideoStream(false);
    setVideoEnabled(true);
  }, []);

  const disableVideo = useCallback(() => {
    engineRef.current?.muteLocalVideoStream(true);
    engineRef.current?.updateChannelMediaOptions({ publishCameraTrack: false });
    engineRef.current?.stopPreview();
    setVideoEnabled(false);
  }, []);

  const switchCamera = useCallback(() => {
    engineRef.current?.switchCamera();
  }, []);

  const localVideo: CallVideoSource | null = videoEnabled
    ? { backend: 'agora', uid: VIDEO_UID_LOCAL, local: true }
    : null;
  const remoteVideo: CallVideoSource | null =
    remoteVideoEnabled && remoteUid !== null
      ? { backend: 'agora', uid: remoteUid, local: false }
      : null;

  return {
    backend: 'agora',
    connState,
    mediaReady: connState === 'connected',
    muted,
    toggleMute,
    speakerOn,
    setSpeaker,
    localVideo,
    remoteVideo,
    videoEnabled,
    remoteVideoEnabled,
    enableVideo,
    disableVideo,
    switchCamera,
  };
}
