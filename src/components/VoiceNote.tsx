import React, { memo, useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { VOICE_BARS, clock, progressOf, type PlaybackSpeed } from '../lib/voice';
import { useStore } from '../store/useStore';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { ProgressBar } from './ProgressBar';
import { Waveform } from './Waveform';

/**
 * Visually 32 rather than the 48dp target, which `size` then guarantees with
 * hitSlop. A 48pt circle inside a bubble is bigger than the bubble's own text.
 */
const PLAY_SIZE = 32;

/**
 * Every bar the same height, and the flatness is the honest part. See the note on
 * the component: there are no stored peaks, and a fabricated waveform would be a
 * claim about content this app cannot make.
 */
const FLAT: readonly number[] = new Array(VOICE_BARS).fill(0.42);

interface Props {
  messageId: string;
  path: string;
  durationMs: number;
  /**
   * Stored waveform from migration 023. Absent on pre-023 rows; FLAT bars are
   * the fallback so older messages degrade gracefully rather than crashing.
   */
  peaks?: readonly number[];
  /** On the coral bubble, so the tint and the labels invert. */
  onAccent: boolean;
  /** Optimistic row: the audio is on disk, not in the bucket, so nothing to play. */
  pending: boolean;
  onToggle: (messageId: string, path: string, durationMs: number) => void;
  onCycleSpeed: () => void;
  speed: PlaybackSpeed;
}

/**
 * A voice note inside a bubble.
 *
 * Migration 023 added a `voice_peaks` column, so the waveform now shows the
 * sender's actual amplitude profile when peaks are present. The `peaks` prop
 * carries them here from the message row via `voiceOf()` → `VoiceBody.peaks`.
 * FLAT (every bar at 0.42) is the fallback for rows that predate 023 and for
 * the optimistic pending row (which clears in under a second anyway).
 *
 * The position is read from the store behind a selector keyed on this row's own
 * id, so the ten-times-a-second playhead updates re-render one bubble rather
 * than the list. Putting it in the list's data was the version of this that made
 * scrolling during playback stutter.
 */
function VoiceNoteView({
  messageId,
  path,
  durationMs,
  peaks,
  onAccent,
  pending,
  onToggle,
  onCycleSpeed,
  speed,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // Returns the store's own object or null, so the reference is stable between
  // updates that do not concern this row and zustand's default equality holds.
  const active = useStore(s =>
    s.playing !== null && s.playing.messageId === messageId ? s.playing : null,
  );

  // Upload fraction while a pending voice note's bytes are in flight; undefined
  // before the first progress event and after settle.  Only ever set for my own
  // pending rows (peer rows arrive already confirmed).
  const uploadFraction = useStore(s =>
    pending ? s.uploadProgress[messageId] : undefined,
  );

  const toggle = useCallback(
    () => onToggle(messageId, path, durationMs),
    [durationMs, messageId, onToggle, path],
  );

  const playing = active !== null && !active.pending;
  const progress = active === null ? 0 : progressOf(active.positionMs, active.durationMs);
  // Counts down while playing, which is what a player does: the number people
  // want mid-note is how much is left, not how far in they are.
  const label = playing
    ? clock(Math.max(0, active.durationMs - active.positionMs))
    : clock(durationMs);

  const ink = onAccent ? styles.inkOnAccent : styles.ink;
  const tint = onAccent ? theme.color.text.onAccent : theme.color.text.secondary;

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={toggle}
          disabled={pending}
          testID={`voice-play-${messageId}`}
          accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
          accessibilityHint={`${clock(durationMs)} long`}
          press="chip"
          size={PLAY_SIZE}
          onColor={tint}
          style={[styles.play, onAccent ? styles.playOnAccent : styles.playNeutral]}
        >
          {active !== null && active.pending ? (
            // Not a spinner. Signing a URL and opening a stream can take a second
            // on a bad connection, and a play button that does nothing visible in
            // that second gets tapped again, which stops what the first tap
            // started. Three dots is the smallest honest "working on it".
            <Icon name="more" size={16} color={tint} />
          ) : (
            <Icon name={playing ? 'pause' : 'play'} size={14} color={tint} />
          )}
        </Pressable>

        <Waveform
          peaks={peaks != null && peaks.length > 0 ? peaks : FLAT}
          progress={progress}
          tint={tint}
          dim={0.45}
          testID={`voice-wave-${messageId}`}
        />

        <Text allowFontScaling style={[styles.time, ink]}>
          {label}
        </Text>

        {/* The pill appears only on the row that is playing, and its slot is
            reserved on every row regardless. A control on every note is a setting
            pretending to be a per-message choice; a slot that appears with the
            control would shorten the track by a third the instant you press play,
            which is the one moment the track matters. */}
        <View style={styles.speedSlot}>
          {playing ? (
            <Pressable
              onPress={onCycleSpeed}
              testID="voice-speed"
              accessibilityLabel={`Playback speed ${speed} times. Tap to change`}
              press="chip"
              onColor={tint}
              style={[styles.speed, onAccent ? styles.speedOnAccent : styles.speedNeutral]}
            >
              <Text allowFontScaling={false} style={[styles.speedText, ink]}>
                {speed}x
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {/* M3 linear progress under the waveform row while the recording is
          uploading.  Determinate when the XHR has reported at least one byte;
          indeterminate before the first event (RN may batch early progress).
          Policy: https://m3.material.io/components/progress-indicators/guidelines
          Colour matches the row's own ink token so the bar reads as part of the
          bubble rather than importing an unrelated accent. */}
      {pending ? (
        <View
          accessible
          accessibilityLabel={
            uploadFraction !== undefined
              ? `Sending voice note, ${Math.round(uploadFraction * 100)} percent`
              : 'Sending voice note'
          }
          style={styles.uploadProgress}
        >
          <ProgressBar
            progress={uploadFraction}
            color={tint}
            trackColor={onAccent ? 'rgba(255,255,255,0.3)' : undefined}
            testID={`voice-upload-progress-${messageId}`}
          />
        </View>
      ) : null}
    </View>
  );
}

export const VoiceNote = memo(VoiceNoteView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  uploadProgress: {
    marginTop: TOKENS.space['2xs'],
  },
  play: {
    width: PLAY_SIZE,
    height: PLAY_SIZE,
    borderRadius: PLAY_SIZE / 2,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A ring rather than a fill on the coral bubble: a filled circle in
  // `text/onAccent` would be a second white shape competing with the text.
  playOnAccent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.text.onAccent,
  },
  playNeutral: {
    backgroundColor: t.color.bg.base,
  },
  ink: {
    color: t.color.text.secondary,
  },
  inkOnAccent: {
    color: t.color.text.onAccent,
  },
  time: {
    ...TOKENS.typography.numeralSmall,
  },
  // Wide enough for `1.5x` at numeralSmall, so cycling the rate does not resize
  // the row either.
  speedSlot: {
    width: 32,
    alignItems: 'flex-end',
  },
  speed: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
  },
  speedOnAccent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.text.onAccent,
  },
  speedNeutral: {
    backgroundColor: t.color.bg.base,
  },
  speedText: {
    ...TOKENS.typography.numeralSmall,
  },
});
