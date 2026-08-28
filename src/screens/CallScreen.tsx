import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { CallResult, ProviderSummary } from '../lib/database.types';
import type { CallMedium } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { useConversationId, useProviders } from '../api/chat';
import { answerCall, endCall, heartbeatCall, startCall } from '../api/calls';
import { useCallSession } from '../api/callSession';
import { useStore } from '../store/useStore';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';

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
  const [accepted, setAccepted] = useState(direction === 'out');
  const [phase, setPhase] = useState<Phase>(direction === 'in' ? 'incoming' : 'starting');
  const [elapsed, setElapsed] = useState(0);

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
        setCallId(r.call_id);
        setPhase('ringing');
      } else {
        const code = r?.error;
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

  const enabled = callId !== null && accepted;
  const {
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
  } = useCallSession(callId, direction === 'out', enabled);

  // Keep the latest enableVideo in a ref so the connection effect can call it
  // without becoming a dependency that changes on every render.
  const enableVideoRef = useRef(enableVideo);
  enableVideoRef.current = enableVideo;

  // Media connected → active; failed → tell the user and leave. When the call
  // was started as video, auto-enable the camera once the connection is live.
  useEffect(() => {
    if (connState === 'connected') {
      setPhase('active');
      if (medium === 'video') {
        void enableVideoRef.current();
      }
    } else if (connState === 'failed') {
      setNotice('The call could not connect.');
      onEnd();
    }
  }, [connState, medium, onEnd, setNotice]);

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
        if (r && r.success && r.status && r.status !== 'active') {
          setNotice(r.status === 'ended' ? 'Call ended.' : 'The call ran out of tokens.');
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
    void answerCall(callId);
  }, [callId]);

  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const gradient = `linear-gradient(160deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  const incomingLabel = medium === 'video' ? 'Incoming video call…' : 'Incoming voice call…';
  const status =
    phase === 'active'
      ? timer
      : phase === 'incoming'
        ? incomingLabel
        : phase === 'ringing'
          ? 'Ringing…'
          : phase === 'connecting'
            ? 'Connecting…'
            : 'Calling…';

  const showRemoteVideo = remoteVideoEnabled && remoteStream !== null;

  return (
    <View style={styles.root}>
      <View style={[styles.fill, { experimental_backgroundImage: gradient }]} />

      {/* Remote video fills the screen when the peer's camera is on. */}
      {showRemoteVideo ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          objectFit="cover"
          zOrder={0}
          style={StyleSheet.absoluteFill}
        />
      ) : provider?.avatar_url ? (
        /* Big poster: provider photo full-bleed with a dark bottom scrim so the
           name and status sit legibly over the lower portion. Falls back to the
           coral gradient + monogram when there is no photo. */
        <>
          <Image
            source={{ uri: provider.avatar_url }}
            resizeMode="cover"
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.posterScrim} />
          <View style={styles.posterMeta}>
            <View testID="call-medium-cue" style={styles.mediumCue}>
              <Icon name={medium === 'video' ? 'video' : 'mic'} size={14} color="rgba(255,255,255,0.8)" />
              <Text allowFontScaling style={styles.mediumLabel}>
                {medium === 'video' ? 'Video call' : 'Voice call'}
              </Text>
            </View>
            <Text allowFontScaling numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text allowFontScaling style={phase === 'active' ? styles.timer : styles.status}>
              {status}
            </Text>
          </View>
        </>
      ) : (
        /* Fallback: coral gradient (already rendered by styles.fill) + centred monogram
           with name/status anchored above the controls via an absolute centerMeta block. */
        <>
          <View style={[styles.center, { paddingTop: insets.top }]}>
            <View style={styles.avatarRings}>
              {phase === 'incoming' ? <View style={styles.ring} /> : null}
              <View style={styles.avatar}>
                <Text allowFontScaling={false} style={styles.avatarInitial}>
                  {initial}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.centerMeta}>
            <View testID="call-medium-cue" style={styles.mediumCue}>
              <Icon name={medium === 'video' ? 'video' : 'mic'} size={14} color="rgba(255,255,255,0.8)" />
              <Text allowFontScaling style={styles.mediumLabel}>
                {medium === 'video' ? 'Video call' : 'Voice call'}
              </Text>
            </View>
            <Text allowFontScaling numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text allowFontScaling style={phase === 'active' ? styles.timer : styles.status}>
              {status}
            </Text>
          </View>
        </>
      )}

      {/* Local camera preview (picture-in-picture), bottom-right. Only shown
          when our own camera is on; zOrder=1 places it above the remote feed. */}
      {videoEnabled && localStream !== null ? (
        <RTCView
          streamURL={localStream.toURL()}
          objectFit="cover"
          mirror
          zOrder={1}
          style={styles.localPip}
        />
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + TOKENS.space.lg }]}>
        {phase === 'incoming' ? (
          <View style={styles.incomingRow}>
            <CallAction testID="call-decline" glyph="callEnd" label="Decline" tone="danger" onPress={onEnd} />
            <CallAction testID="call-accept" glyph="call" label="Accept" tone="accept" onPress={accept} />
          </View>
        ) : (
          <View style={styles.bar}>
            <BarButton
              testID="call-mute"
              glyph={muted ? 'micOff' : 'mic'}
              active={muted}
              onPress={toggleMute}
              label={muted ? 'Unmute' : 'Mute'}
            />
            <BarButton
              testID="call-video-toggle"
              glyph={videoEnabled ? 'video' : 'videoOff'}
              active={videoEnabled}
              onPress={() => {
                if (videoEnabled) {
                  disableVideo();
                } else {
                  void enableVideo();
                }
              }}
              label={videoEnabled ? 'Camera off' : 'Camera on'}
            />
            {videoEnabled ? (
              <BarButton
                testID="call-camera-flip"
                glyph="camera"
                onPress={switchCamera}
                label="Flip camera"
              />
            ) : null}
            <BarButton testID="call-end" glyph="callEnd" tone="danger" onPress={onEnd} label="End call" large />
          </View>
        )}
      </View>
    </View>
  );
}

/** A big labelled round button for the incoming screen. */
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
        press="chip"
        size={64}
        style={[styles.action, tone === 'danger' ? styles.danger : styles.accept]}>
        <Icon name={glyph} size={28} color="#FFFFFF" />
      </Pressable>
      <Text allowFontScaling style={styles.actionLabel}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A round control in the in-call bar.
 *
 * `active` fills white (on), `tone="danger"` fills the danger red.
 * `large` makes the button 64×64 instead of 56×56 — used exclusively for the
 * end-call button so it reads as THE primary action vs the neutral/translucent
 * peers around it (WhatsApp / Instagram call UI convention).
 */
function BarButton({
  glyph,
  active = false,
  tone,
  onPress,
  label,
  testID,
  large = false,
}: {
  glyph: IconName;
  active?: boolean;
  tone?: 'danger';
  onPress: () => void;
  label: string;
  testID: string;
  large?: boolean;
}) {
  const styles = useStyles(makeStyles);
  // The call screen is a FIXED coral surface, not a themed one, so these colours
  // are fixed literals rather than tokens: white on the coral for idle/danger,
  // and a dark ink on the white "on" pill (`barButtonOn`). This used
  // `theme.color.text.primary` for the active icon, which flips to light in dark
  // mode and rendered light-on-white — invisible.
  const fg = tone === 'danger' ? '#FFFFFF' : active ? '#1C1C1E' : '#FFFFFF';
  return (
    <View style={styles.barSlot}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityLabel={label}
        press="chip"
        size={large ? 64 : 56}
        style={[
          styles.barButton,
          large && styles.barButtonLarge,
          tone === 'danger' && styles.danger,
          active && tone !== 'danger' && styles.barButtonOn,
        ]}>
        <Icon name={glyph} size={large ? 28 : 24} color={fg} />
      </Pressable>
    </View>
  );
}

const AVATAR = 120;
/** Approximate height of the in-call bar + padding, to keep the PiP clear. */
const CONTROLS_CLEARANCE = 108;

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
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space['2xl'],
    },
    avatarRings: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: TOKENS.space.lg,
    },
    ring: {
      position: 'absolute',
      width: AVATAR + 56,
      height: AVATAR + 56,
      borderRadius: (AVATAR + 56) / 2,
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    avatar: {
      width: AVATAR,
      height: AVATAR,
      borderRadius: AVATAR / 2,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.24)',
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarInitial: {
      fontFamily: TOKENS.typography.displayLarge.fontFamily,
      fontSize: 48,
      lineHeight: 56,
      color: '#FFFFFF',
    },
    name: {
      ...TOKENS.typography.displaySmall,
      color: '#FFFFFF',
    },
    timer: {
      ...TOKENS.typography.titleMedium,
      color: '#FFFFFF',
    },
    status: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.8)',
      letterSpacing: 0.5,
    },
    controls: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: TOKENS.space.lg,
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
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      ...TOKENS.typography.subhead,
      color: '#FFFFFF',
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
    },
    barSlot: {
      alignItems: 'center',
    },
    barButton: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.16)',
    },
    barButtonLarge: {
      width: 64,
      height: 64,
      borderRadius: 32,
    },
    barButtonOn: {
      backgroundColor: '#FFFFFF',
    },
    danger: {
      backgroundColor: t.color.state.danger,
    },
    accept: {
      backgroundColor: t.color.state.available,
    },
    /** Full-bleed bottom gradient scrim over the poster photo. */
    posterScrim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      experimental_backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 55%)',
    },
    /** Name + status anchored above the controls bar when a photo poster is shown. */
    posterMeta: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: CONTROLS_CLEARANCE + TOKENS.space.sm,
      paddingHorizontal: TOKENS.space['2xl'],
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /** Name + status anchored above the controls bar for the no-avatar layout.
     *  Sits a little higher than posterMeta to clear the monogram avatar. */
    centerMeta: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: CONTROLS_CLEARANCE + TOKENS.space.lg,
      paddingHorizontal: TOKENS.space['2xl'],
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /** Pill row indicating call medium — icon + label — above the peer name. */
    mediumCue: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    mediumLabel: {
      ...TOKENS.typography.captionSmall,
      color: 'rgba(255,255,255,0.8)',
      letterSpacing: 1,
    },
    /** Local camera PiP: bottom-right, above the controls bar. */
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
