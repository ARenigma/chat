import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { useProviders } from '../api/chat';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';

export type CallMode = 'incoming' | 'audio' | 'video';

interface Props {
  providerId: string;
  mode: CallMode;
  /** Decline (incoming) or hang up (in call). */
  onEnd: () => void;
  /** Accept an incoming call, moving it to the audio mode. */
  onAccept?: () => void;
}

/**
 * The call surfaces — incoming, voice, video — as one mode-driven screen, on the
 * Fuse system from the v12 frames (v13 did not redraw calls).
 *
 * **UI only, and gated.** `CALLS_ENABLED` is false: this screen is built and
 * wired but not reachable in a shipped build, because the media/foreground-
 * service/Telecom `ConnectionService` layer is a native follow-up (PRODUCT.md,
 * migration 011 shipped the server half). So there is no real audio/video here —
 * the controls toggle local state, the timer counts, and ending returns to the
 * profile. Photos degrade to the warm mark, same as Home and Provider detail,
 * since the data model has no `avatar_url`.
 *
 * Per-minute billing (ADR-0019) meters a live call against the ₹ balance; that
 * meter is part of the same gated backend and is not simulated here.
 */
export function CallScreen({ providerId, mode, onEnd, onAccept }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: providers } = useProviders();
  const provider = useMemo<ProviderSummary | null>(
    () => (providers ?? []).find(p => p.id === providerId) ?? null,
    [providers, providerId],
  );
  const name = provider?.display_name ?? 'Calling';
  const initial = initialOf(provider?.display_name);

  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(mode === 'video');
  const [cameraOff, setCameraOff] = useState(false);

  // The duration counter runs once a call is live (not while ringing). No real
  // media backs it; it is the honest shape of an in-call timer.
  useEffect(() => {
    if (mode === 'incoming') {
      return;
    }
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  const gradient = `linear-gradient(160deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;

  return (
    <View style={styles.root}>
      <View style={[styles.fill, { experimental_backgroundImage: gradient }]} />

      {/* Video shows the peer's camera full-bleed; with no media that is the same
          warm field carrying their mark, plus a self-view tile. */}
      {mode === 'video' ? (
        <>
          <Text allowFontScaling style={styles.videoWatermark}>
            {initial}
          </Text>
          <View style={[styles.selfView, { top: insets.top + TOKENS.space.md }]}>
            <Text allowFontScaling style={styles.selfLabel}>
              You
            </Text>
          </View>
        </>
      ) : null}

      {/* Identity. Top-left on video (over the frame), centred otherwise. */}
      {mode === 'video' ? (
        <View style={[styles.videoHead, { top: insets.top + TOKENS.space.sm }]}>
          <Text allowFontScaling numberOfLines={1} style={styles.videoName}>
            {name}
          </Text>
          <Text allowFontScaling style={styles.videoTimer}>
            {timer}
          </Text>
        </View>
      ) : (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <View style={styles.avatarRings}>
            {mode === 'incoming' ? <View style={styles.ring} /> : null}
            <View style={styles.avatar}>
              <Text allowFontScaling={false} style={styles.avatarInitial}>
                {initial}
              </Text>
            </View>
          </View>
          <Text allowFontScaling numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          {mode === 'incoming' ? (
            <Text allowFontScaling style={styles.status}>
              Incoming voice call…
            </Text>
          ) : (
            <>
              <Text allowFontScaling style={styles.timer}>
                {timer}
              </Text>
              <Text allowFontScaling style={styles.status}>
                VOICE CALL
              </Text>
            </>
          )}
        </View>
      )}

      {/* Controls. */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + TOKENS.space.lg }]}>
        {mode === 'incoming' ? (
          <View style={styles.incomingRow}>
            <CallAction
              testID="call-decline"
              glyph="callEnd"
              label="Decline"
              tone="danger"
              onPress={onEnd}
            />
            <CallAction
              testID="call-accept"
              glyph="call"
              label="Accept"
              tone="accept"
              onPress={onAccept ?? onEnd}
            />
          </View>
        ) : (
          <View style={styles.bar}>
            <BarButton
              testID="call-mute"
              glyph={muted ? 'micOff' : 'mic'}
              active={muted}
              onPress={() => setMuted(m => !m)}
              label={muted ? 'Unmute' : 'Mute'}
            />
            {mode === 'video' ? (
              <BarButton
                testID="call-camera"
                glyph={cameraOff ? 'videoOff' : 'video'}
                active={cameraOff}
                onPress={() => setCameraOff(c => !c)}
                label={cameraOff ? 'Camera on' : 'Camera off'}
              />
            ) : null}
            <BarButton
              testID="call-speaker"
              glyph="speaker"
              active={speaker}
              onPress={() => setSpeaker(s => !s)}
              label="Speaker"
            />
            <BarButton
              testID="call-end"
              glyph="callEnd"
              tone="danger"
              onPress={onEnd}
              label="End call"
            />
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
  const theme = useTheme();
  const fg = tone === 'danger' ? '#FFFFFF' : active ? theme.color.text.primary : '#FFFFFF';
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
      backgroundColor: 'rgba(255,255,255,0.24)',
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
    videoWatermark: {
      position: 'absolute',
      alignSelf: 'center',
      top: '32%',
      fontFamily: TOKENS.typography.displayLarge.fontFamily,
      fontSize: 220,
      lineHeight: 250,
      color: 'rgba(255,255,255,0.16)',
    },
    videoHead: {
      position: 'absolute',
      left: TOKENS.space.lg,
    },
    videoName: {
      ...TOKENS.typography.headline,
      color: '#FFFFFF',
    },
    videoTimer: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.8)',
    },
    selfView: {
      position: 'absolute',
      right: TOKENS.space.md,
      width: 96,
      height: 132,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      backgroundColor: 'rgba(0,0,0,0.35)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    selfLabel: {
      ...TOKENS.typography.captionSmall,
      color: 'rgba(255,255,255,0.85)',
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
    // The dark control pill, from v12.
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
