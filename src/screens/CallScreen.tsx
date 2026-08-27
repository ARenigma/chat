import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { CallResult, ProviderSummary } from '../lib/database.types';
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
 * through one path. Audio only for now; video is a follow-up.
 */
export function CallScreen({ providerId, direction, callId: incomingCallId, onEnd }: Props) {
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
    void startCall(openedId, 'voice').then((r: CallResult | null) => {
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
  }, [direction, openedId, callId, onEnd, setNotice, openRefill]);

  const enabled = callId !== null && accepted;
  const { connState, muted, toggleMute } = useCallSession(callId, direction === 'out', enabled);

  // Media connected → active; failed → tell the user and leave.
  useEffect(() => {
    if (connState === 'connected') {
      setPhase('active');
    } else if (connState === 'failed') {
      setNotice('The call could not connect.');
      onEnd();
    }
  }, [connState, onEnd, setNotice]);

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
  const status =
    phase === 'active'
      ? timer
      : phase === 'incoming'
        ? 'Incoming voice call…'
        : phase === 'ringing'
          ? 'Ringing…'
          : phase === 'connecting'
            ? 'Connecting…'
            : 'Calling…';

  return (
    <View style={styles.root}>
      <View style={[styles.fill, { experimental_backgroundImage: gradient }]} />

      <View style={[styles.center, { paddingTop: insets.top }]}>
        <View style={styles.avatarRings}>
          {phase === 'incoming' ? <View style={styles.ring} /> : null}
          <View style={styles.avatar}>
            {/* The caller's photo, not their initial (#2). Falls back to the
                monogram only when there is no avatar. */}
            {provider?.avatar_url ? (
              <Image source={{ uri: provider.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text allowFontScaling={false} style={styles.avatarInitial}>
                {initial}
              </Text>
            )}
          </View>
        </View>
        <Text allowFontScaling numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text allowFontScaling style={phase === 'active' ? styles.timer : styles.status}>
          {status}
        </Text>
      </View>

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
            <BarButton testID="call-end" glyph="callEnd" tone="danger" onPress={onEnd} label="End call" />
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

/** A round control in the in-call bar. `active` fills white (on), `danger` red. */
function BarButton({
  glyph,
  active = false,
  tone,
  onPress,
  label,
  testID,
}: {
  glyph: IconName;
  active?: boolean;
  tone?: 'danger';
  onPress: () => void;
  label: string;
  testID: string;
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
        size={56}
        style={[
          styles.barButton,
          tone === 'danger' && styles.danger,
          active && tone !== 'danger' && styles.barButtonOn,
        ]}>
        <Icon name={glyph} size={24} color={fg} />
      </Pressable>
    </View>
  );
}

const AVATAR = 120;

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
    barButtonOn: {
      backgroundColor: '#FFFFFF',
    },
    danger: {
      backgroundColor: t.color.state.danger,
    },
    accept: {
      backgroundColor: t.color.state.available,
    },
  });
