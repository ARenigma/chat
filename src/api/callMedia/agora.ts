import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  ChannelProfileType,
  ClientRoleType,
  ConnectionStateType,
  DegradationPreference,
  VideoCodecType,
  createAgoraRtcEngine,
  type IRtcEngine,
  type IRtcEngineEventHandler,
} from 'react-native-agora';
import { alertPermissionBlocked, requestAndroidPermission } from '../../lib/permissions';
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
): CallMediaSession {
  const [connState, setConnState] = useState<CallMediaSession['connState']>('connecting');
  const [muted, setMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const engineRef = useRef<IRtcEngine | null>(null);
  const remotePresentRef = useRef(false);
  const connectionStateRef = useRef<CallMediaSession['connState']>('connecting');
  const latestQualityRef = useRef<Partial<CallQualitySample>>({});

  useEffect(() => {
    if (!enabled || callId === null || credentials?.backend !== 'agora') return;
    if (!credentials.appId || !credentials.token || !credentials.room || !credentials.uid) {
      setConnState('failed');
      return;
    }
    const appId = credentials.appId;
    const token = credentials.token;
    const room = credentials.room;
    const localUid = credentials.uid;
    let cancelled = false;
    let eventHandler: IRtcEngineEventHandler | undefined;
    const updateConnectionState = (
      state: CallMediaSession['connState'],
    ) => {
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
        if (next.backend !== 'agora' || !next.token) throw new Error('Invalid Agora renewal');
        if (rejoin) {
          engine.leaveChannel();
          if (join(engine, next.token) < 0) throw new Error('Agora rejoin failed');
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
        onUserOffline: () => {
          remotePresentRef.current = false;
          updateConnectionState('closed');
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
          } else if (
            state === ConnectionStateType.ConnectionStateConnecting ||
            state === ConnectionStateType.ConnectionStateReconnecting
          ) {
            updateConnectionState('connecting');
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
        onError: () => {
          updateConnectionState('failed');
        },
      };
      eventHandler = handler;

      engine.initialize({ appId });
      engine.registerEventHandler(handler);
      engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication1v1);
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

  const enableVideo = useCallback(async () => {
    const outcome = await requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
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

  const localVideo: CallVideoSource | null =
    videoEnabled ? { backend: 'agora', uid: VIDEO_UID_LOCAL, local: true } : null;
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
    localVideo,
    remoteVideo,
    videoEnabled,
    remoteVideoEnabled,
    enableVideo,
    disableVideo,
    switchCamera,
  };
}
