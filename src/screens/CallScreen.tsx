import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  PixelRatio,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { CallResult, ProviderSummary } from '../lib/database.types';
import type { CallMedium } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { sizedStorageImageUri } from '../lib/storageImage';
import { useConversationId, useProviders } from '../api/chat';
import { answerCall, endCall, heartbeatCall, startCall } from '../api/calls';
import { useCallSession } from '../api/callMedia';
import { CallVideoView } from '../api/callMedia/CallVideoView';
import { useSessionLease } from '../api/sessions';
import {
  startCallForegroundService,
  stopCallForegroundService,
} from '../lib/conversations';
import { useStore } from '../store/useStore';
import { CallRing } from '../components/CallRing';
import { CallingDots } from '../components/CallingDots';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { track } from '../lib/telemetry';

/** Which way the call goes. Outgoing dials; incoming rings and offers Accept. */
export type CallDirection = 'out' | 'in';

interface Props {
  /** The peer: the provider being called, or the caller ringing us. */
  providerId: string;
  direction: CallDirection;
  /** Set for an incoming call; null outgoing until `start_call` returns one. */
  callId: string | null;
  /** 'voice' for audio-only; 'video' auto-enables the camera on connect. */
  medium: CallMedium;
  /** Decline (incoming, ringing) or hang up (in call). Leaving the screen ends it. */
  onEnd: () => void;
}

/** How long between heartbeats while a call is up; the ticker reads last_seen_at. */
const HEARTBEAT_MS = 20_000;

/** start_call refusals, in words. */
const START_NOTICE: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'You need more tokens to start a call.',
  BUSY: 'One of you is already on a call.',
  BLOCKED: 'You can no longer call each other.',
  SUSPENDED: 'Your account is under review and cannot call.',
  RATE_LIMITED: 'Too many calls just now. Try again shortly.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That conversation no longer exists.',
  VOICE_CALLS_DISABLED: 'Voice calls are temporarily unavailable.',
  VIDEO_CALLS_DISABLED: 'Video calls are temporarily unavailable.',
};

type Phase = 'starting' | 'ringing' | 'connecting' | 'active' | 'incoming';

/**
 * The call, over WebRTC. One screen for both directions, driven by phase.
 *
 * Outgoing: resolves the conversation from the peer, calls `start_call`, then
 * runs the session as the offerer while it rings. Incoming: shows Accept /
 * Decline, and on Accept calls `answer_call` (which starts the meter) and runs
 * the session as the answerer. `useCallSession` carries the media; this screen
 * carries the server row (start/answer/heartbeat/end) and the UI.
 *
 * Leaving the screen ends the call: an unmount hangs up on the server if the
 * call was live, so End, Decline, and the hardware back button all resolve
 * through one path.
 *
 * Video: every call negotiates a video transceiver from the start (camera off).
 * Toggling uses RTCRtpSender.replaceTrack so no renegotiation is needed. If the
 * call was started as `medium='video'`, the camera is auto-enabled on connect.
 */
export function CallScreen({ providerId, direction, callId: incomingCallId, medium, onEnd }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);
  const { data: providers } = useProviders();
  const provider = useMemo<ProviderSummary | null>(
    () => (providers ?? []).find(p => p.id === providerId) ?? null,
    [providers, providerId],
  );
  const name = provider?.display_name ?? (direction === 'in' ? 'Incoming call' : 'Calling');
  const initial = initialOf(provider?.display_name);

  const [callId, setCallId] = useState<string | null>(incomingCallId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(direction === 'out');
  const [phase, setPhase] = useState<Phase>(direction === 'in' ? 'incoming' : 'starting');
  const [elapsed, setElapsed] = useState(0);
  /** Visual speaker pill; audio-route wiring is a follow-up (no InCallManager yet). */
  const [speakerOn, setSpeakerOn] = useState(false);

  // Outgoing needs the conversation the call belongs to; a member calling a
  // provider resolves it exactly as opening a chat does.
  const { data: openedId } = useConversationId(direction === 'out' ? providerId : null);

  // End on unmount if the call was live, so End / Decline / hardware-back all
  // hang up through one path. Refs so the cleanup sees the latest without
  // re-subscribing.
  const callIdRef = useRef<string | null>(callId);
  callIdRef.current = callId;
  useEffect(
    () => () => {
      if (callIdRef.current !== null) {
        void endCall(callIdRef.current);
      }
      stopCallForegroundService();
    },
    [],
  );

  // Outgoing: place the call once the conversation resolves.
  useEffect(() => {
    if (direction !== 'out' || callId !== null || openedId === undefined) {
      return;
    }
    let live = true;
    void startCall(openedId, medium).then((r: CallResult | null) => {
      if (!live) {
        return;
      }
      if (r && r.success && r.call_id) {
        track('call_started', {
          backend: r.media_backend ?? 'current',
          direction,
          medium,
        });
        setCallId(r.call_id);
        setSessionId(r.session_id ?? null);
        setPhase('ringing');
      } else {
        const code = r?.error;
        track('call_rejected', { reason: code ?? 'network', medium });
        setNotice(code ? (START_NOTICE[code] ?? 'Could not start the call.') : 'Could not start the call. Check your connection.');
        if (code === 'INSUFFICIENT_BALANCE') {
          openRefill();
        }
        onEnd();
      }
    });
    return () => {
      live = false;
    };
  }, [direction, openedId, callId, medium, onEnd, setNotice, openRefill]);

  useEffect(() => {
    if (callId === null) return;
    startCallForegroundService(name, direction === 'in');
    return stopCallForegroundService;
  }, [callId, name, direction]);

  const enabled = callId !== null && accepted;
  const {
    connState,
    backend,
    mediaReady,
    muted,
    toggleMute,
    localVideo,
    remoteVideo,
    videoEnabled,
    remoteVideoEnabled,
    enableVideo,
    disableVideo,
    switchCamera,
  } = useCallSession(callId, direction === 'out', enabled);
  const connectedTrackedRef = useRef(false);
  const backendRef = useRef(backend);
  const phaseRef = useRef(phase);
  backendRef.current = backend;
  phaseRef.current = phase;

  useEffect(
    () => () => {
      if (phaseRef.current === 'active') {
        track('call_ended', {
          backend: backendRef.current,
          medium,
          reason: 'hangup',
        });
      }
    },
    [medium],
  );

  useEffect(() => {
    if (callId !== null && mediaReady) {
      // Media is open, so the call is connected: always the ongoing style, even
      // if it arrived as an incoming ring.
      startCallForegroundService(name, false, true, videoEnabled);
    }
  }, [callId, mediaReady, name, videoEnabled]);

  useSessionLease(
    sessionId
      ? { id: sessionId, channel: medium === 'voice' ? 'audio' : 'video' }
      : null,
    'connected',
  );

  // Keep the latest enableVideo in a ref so the connection effect can call it
  // without becoming a dependency that changes on every render.
  const enableVideoRef = useRef(enableVideo);
  enableVideoRef.current = enableVideo;

  // Media connected → active; failed → tell the user and leave. When the call
  // was started as video, auto-enable the camera once the connection is live.
  useEffect(() => {
    if (connState === 'connected') {
      setPhase('active');
      if (!connectedTrackedRef.current) {
        connectedTrackedRef.current = true;
        track('call_answered', { backend, medium });
      }
      if (callId !== null) {
        void heartbeatCall(callId).then(result => {
          if (result?.session_id) setSessionId(result.session_id);
        });
      }
      if (medium === 'video') {
        void enableVideoRef.current();
      }
    } else if (connState === 'failed') {
      setNotice('The call could not connect.');
      onEnd();
    }
  }, [backend, callId, connState, medium, onEnd, setNotice]);

  // The in-call timer, once live.
  useEffect(() => {
    if (phase !== 'active') {
      return;
    }
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Heartbeat + settle while active. If the server ends it (out of tokens), leave.
  useEffect(() => {
    if (phase !== 'active' || callId === null) {
      return;
    }
    const id = setInterval(() => {
      void heartbeatCall(callId).then(r => {
        if (r?.session_id) setSessionId(r.session_id);
        if (r?.success && r.status === 'ended') {
          setNotice('Call ended.');
          onEnd();
        }
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [phase, callId, onEnd, setNotice]);

  const accept = useCallback(() => {
    if (callId === null) {
      return;
    }
    setAccepted(true);
    setPhase('connecting');
    void answerCall(callId).then(result => {
      if (!result?.success) {
        setNotice('This call is no longer available.');
        onEnd();
        return;
      }
      setSessionId(result.session_id ?? null);
    });
  }, [callId, onEnd, setNotice]);

  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const gradient = `linear-gradient(160deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  // Status words carry NO trailing "…": the animated CallingDots supply the
  // ellipsis for every waiting phase (user 2026-08-31, copied from the reference
  // where the dots fill in sequence). The timer phase has no dots.
  const incomingLabel = medium === 'video' ? 'Incoming video call' : 'Incoming voice call';
  const status =
    phase === 'active'
      ? timer
      : phase === 'incoming'
        ? incomingLabel
        : phase === 'ringing'
          ? 'Ringing'
          : phase === 'connecting'
            ? 'Connecting'
            : 'Calling';

  const showRemoteVideo = remoteVideoEnabled && remoteVideo !== null;
  const pulsing = phase === 'ringing' || phase === 'connecting' || phase === 'incoming' || phase === 'starting';
  /** A photo is bleeding edge-to-edge behind everything, so no centred avatar. */
  const hasBleedPhoto = !showRemoteVideo && typeof provider?.avatar_url === 'string';

  return (
    <View style={styles.root}>
      <View style={[styles.fill, { experimental_backgroundImage: gradient }]} />

      {/* Full-bleed photo (or remote video). Name + status sit on top, above the face. */}
      {showRemoteVideo ? (
        <CallVideoView
          key={`agora-${remoteVideo.uid}-${remoteVideo.local ? 'local' : 'remote'}`}
          source={remoteVideo}
          objectFit="cover"
          zOrder={0}
          style={StyleSheet.absoluteFill}
        />
      ) : provider?.avatar_url ? (
        <>
          <Image
            source={{
              uri: sizedStorageImageUri(
                provider.avatar_url,
                windowWidth,
                windowHeight,
                PixelRatio.get(),
              ),
            }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.bleedScrim} />
        </>
      ) : null}

      <View style={[styles.topMeta, { paddingTop: insets.top + TOKENS.space.md }]}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {phase === 'active' ? (
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling testID="call-status" style={styles.timer}>
            {status}
          </Text>
        ) : (
          <View style={styles.statusRow}>
            <Text allowFontScaling testID="call-status" style={styles.status}>
              {status}
            </Text>
            <CallingDots />
          </View>
        )}
      </View>

      {/*
        * The ringing halo is the fallback, not a second layer on top of the
        * bleed. When a full-bleed photo is up, the face IS the subject — putting
        * a circular crop of the same photo over it repeats the image and lands
        * squarely on her eyes. WhatsApp does the same: photo OR ringed avatar,
        * never both. The ring therefore only appears when there is no photo to
        * bleed, where it gives the initial mark something to breathe.
        */}
      {!showRemoteVideo && !hasBleedPhoto ? (
        <View style={styles.center} pointerEvents="none">
          <CallRing size={AVATAR} active={pulsing}>
            <View style={[styles.avatarFill, { backgroundColor: theme.color.state.available }]}>
              <Text allowFontScaling={false} style={styles.avatarInitial}>
                {initial}
              </Text>
            </View>
          </CallRing>
        </View>
      ) : null}

      {videoEnabled && localVideo !== null ? (
        <CallVideoView
          source={localVideo}
          objectFit="cover"
          mirror
          zOrder={1}
          style={styles.localPip}
        />
      ) : null}

      {/*
        * Control row — size, spacing, and labels match the WhatsApp outgoing
        * call capture (2026-08-30): four equal circles, End Call solid red,
        * secondary pills translucent white glass, Start Video filled white when
        * off / outlined when on. Incoming keeps Decline | Accept at the edges.
        */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + TOKENS.space.lg }]}>
        {phase === 'incoming' ? (
          <View style={styles.incomingRow}>
            <CallAction testID="call-decline" glyph="callEnd" label="Decline" tone="danger" onPress={onEnd} />
            <CallAction testID="call-accept" glyph="call" label="Accept" tone="accept" onPress={accept} />
          </View>
        ) : (
          <View style={styles.bar}>
            <BarButton
              testID="call-speaker"
              glyph="speaker"
              active={speakerOn}
              onPress={() => setSpeakerOn(v => !v)}
              label="Speaker"
            />
            <BarButton
              testID="call-video-toggle"
              glyph={videoEnabled ? 'video' : 'videoOff'}
              active={!videoEnabled}
              fill={videoEnabled ? 'ghost' : 'solid'}
              onPress={() => {
                if (videoEnabled) {
                  disableVideo();
                } else {
                  void enableVideo();
                }
              }}
              onLongPress={videoEnabled ? switchCamera : undefined}
              label={videoEnabled ? 'Camera off' : 'Start Video'}
            />
            <BarButton
              testID="call-mute"
              glyph={muted ? 'micOff' : 'mic'}
              active={muted}
              onPress={toggleMute}
              label="Mute"
            />
            <BarButton testID="call-end" glyph="callEnd" tone="danger" onPress={onEnd} label="End Call" />
          </View>
        )}
      </View>
    </View>
  );
}

/** Incoming Decline / Accept — large edge-anchored circles with captions. */
function CallAction({
  glyph,
  label,
  tone,
  onPress,
  testID,
}: {
  glyph: IconName;
  label: string;
  tone: 'danger' | 'accept';
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.actionSlot}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityLabel={label}
        press="none"
        highlight="ios"
        size={72}
        style={[styles.action, tone === 'danger' ? styles.danger : styles.accept]}>
        <Icon name={glyph} size={30} color={LIGHT.color.text.onAccent} />
      </Pressable>
      <Text allowFontScaling style={styles.actionLabel}>
        {label}
      </Text>
    </View>
  );
}

/**
 * WhatsApp outgoing control: equal ~56dp circles with captions under.
 * Secondary = translucent white glass; video "off" = solid white; End = red.
 */
function BarButton({
  glyph,
  active = false,
  tone,
  fill = 'ghost',
  onPress,
  onLongPress,
  label,
  testID,
}: {
  glyph: IconName;
  active?: boolean;
  tone?: 'danger';
  fill?: 'ghost' | 'solid';
  onPress: () => void;
  onLongPress?: () => void;
  label: string;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  const fg =
    tone === 'danger'
      ? LIGHT.color.text.onAccent
      : fill === 'solid'
        ? LIGHT.color.text.primary
        : LIGHT.color.text.onAccent;
  return (
    <View style={styles.barSlot}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        testID={testID}
        accessibilityLabel={label}
        press="none"
        highlight="ios"
        size={BTN}
        style={[
          styles.barButton,
          tone === 'danger' && styles.danger,
          tone !== 'danger' && fill === 'solid' && styles.barButtonSolid,
          tone !== 'danger' && fill === 'ghost' && styles.barButtonGhost,
          active && tone !== 'danger' && fill === 'ghost' && styles.barButtonActive,
        ]}>
        <Icon name={glyph} size={24} color={fg} />
      </Pressable>
      <Text allowFontScaling style={styles.barLabel}>
        {label}
      </Text>
    </View>
  );
}

/** Face diameter — WhatsApp capture ~140–160 logical on a tall phone. */
const AVATAR = 148;
const BTN = 56;
/** Clearance for the labelled control row + home indicator. */
const CONTROLS_CLEARANCE = 120;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.accentStrong,
    },
    fill: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    bleedScrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    topMeta: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 2,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space['2xl'],
    },
    center: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: CONTROLS_CLEARANCE,
    },
    avatarFill: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitial: {
      fontFamily: TOKENS.face.semibold,
      fontSize: 56,
      lineHeight: 64,
      color: LIGHT.color.text.onAccent,
    },
    name: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: LIGHT.color.text.onAccent,
      textAlign: 'center',
    },
    timer: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: LIGHT.color.text.onAccent,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    status: {
      ...TOKENS.typography.bodyMedium,
      color: 'rgba(255,255,255,0.85)',
      letterSpacing: 0.3,
    },
    controls: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: TOKENS.space.md,
      zIndex: 2,
    },
    incomingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    actionSlot: {
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    action: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      ...TOKENS.typography.bodySmall,
      color: LIGHT.color.text.onAccent,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-around',
    },
    barSlot: {
      alignItems: 'center',
      gap: TOKENS.space.xs,
      width: 76,
    },
    barButton: {
      width: BTN,
      height: BTN,
      borderRadius: BTN / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Translucent white glass over the photo/gradient, NOT lavender: WhatsApp's
    // secondary call controls are a frosted white, and a purple tint here read as
    // a second brand colour the palette does not have (user 2026-08-31).
    barButtonGhost: {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    // The "on" state (mute active, speaker on, camera off) lifts the same glass
    // brighter rather than switching hue.
    barButtonActive: {
      backgroundColor: 'rgba(255,255,255,0.42)',
    },
    barButtonSolid: {
      backgroundColor: LIGHT.color.bg.base,
    },
    barLabel: {
      ...TOKENS.typography.bodySmall,
      color: LIGHT.color.text.onAccent,
      textAlign: 'center',
    },
    danger: {
      backgroundColor: '#E53935',
    },
    accept: {
      backgroundColor: t.color.state.available,
    },
    localPip: {
      position: 'absolute',
      right: TOKENS.space.md,
      bottom: CONTROLS_CLEARANCE,
      width: 120,
      height: 160,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
  });
