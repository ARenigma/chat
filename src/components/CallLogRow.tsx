import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { CallRecord } from '../api/chat';
import { timeOfDay } from '../lib/datetime';
import { durationWords } from '../lib/transcript';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

/**
 * Inline call-log row in the chat transcript.
 *
 * A call that CONNECTED and then ended is a muted, non-tappable log line —
 * centered pill, caption text, DayDivider weight. A call the other side never
 * accepted (missed / declined / failed) is the loud entry WhatsApp makes it
 * (Amit, 2026-09-13, "show missed audio/video calls like whatsapp when any party
 * doesnt accept"): danger-tinted, and tappable to call back — the "Click to call
 * back" affordance in his reference screenshot. voice vs video is carried in
 * every state by the glyph (call / video) and the word.
 */

/**
 * Talk time, worded by the transcript's one duration formatter.
 *
 * This row used to print its own `mm:ss` ("Voice call · 4:32 · 3:55 pm"), which
 * put a duration and a clock time in the same shape on the same line; see
 * `durationWords` for why the words won and why the running call timer keeps the
 * digits. Sharing the formatter — rather than each row wording its own — is what
 * keeps the call row and the chat-session row reading as one history.
 *
 * Still measured off `started_at`/`ended_at`, which for a call is the time the
 * two were connected. (The chat-session row deliberately shows billed minutes
 * instead; the reason is on `sessionEndedLabel`.)
 */
function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (startedAt === null || endedAt === null) {
    return '';
  }
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return durationWords(Math.round(ms / 1000));
}

function CallLogRowView({
  call,
  onCallBack,
}: {
  call: CallRecord;
  /**
   * Re-dial this peer. Passed only when the caller (ChatScreen) can currently
   * start a call of this medium — undefined disables the call-back affordance,
   * so a missed row stays informative but non-tappable when calling is off.
   */
  onCallBack?: (medium: 'voice' | 'video') => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  const isVideo = call.medium === 'video';
  const iconName = isVideo ? 'video' : 'call';
  const mediumLabel = isVideo ? 'Video' : 'Voice';

  const stamp = timeOfDay(call.created_at);
  // The separator is composed here, not inside the formatter, because a call
  // with no measurable duration (never connected, or both ends on the same
  // instant) must not leave a dangling " · " in the middle of the pill.
  const duration = formatDuration(call.started_at, call.ended_at);

  // A call the other side never accepted. WhatsApp makes these the loud entry
  // (red + tap to call back); a connected call that simply ended stays muted.
  const unconnected = call.status !== 'ended';

  let label: string;
  switch (call.status) {
    case 'ended':
      label = `${mediumLabel} call${duration === '' ? '' : ` · ${duration}`} · ${stamp}`;
      break;
    case 'missed':
      label = `Missed ${mediumLabel.toLowerCase()} call · ${stamp}`;
      break;
    case 'declined':
      label = `Declined ${mediumLabel.toLowerCase()} call · ${stamp}`;
      break;
    case 'failed':
      label = `${mediumLabel} call failed · ${stamp}`;
      break;
  }

  if (unconnected) {
    const tint = theme.color.state.danger;
    const canCallBack = onCallBack !== undefined;
    // Both lines live INSIDE the pill (on bg/sunken, a known background) rather
    // than on the patterned chat wallpaper, and the call-back hint takes neutral
    // text/secondary (5.90:1 light / 4.55:1 dark on bg/sunken) — not the coral
    // accent, which the accent budget (theme.test.ts) reserves for elsewhere.
    const body = (
      <View style={[styles.pill, styles.pillMissed]}>
        <Icon name={iconName} size={TOKENS.icon.xs} color={tint} />
        <View style={styles.missedText}>
          <Text allowFontScaling style={[styles.text, styles.textMissed]}>
            {label}
          </Text>
          {canCallBack ? (
            <Text allowFontScaling style={styles.callBack}>
              Tap to call back
            </Text>
          ) : null}
        </View>
      </View>
    );
    if (!canCallBack) {
      return <View style={styles.row}>{body}</View>;
    }
    return (
      <View style={styles.row}>
        <Pressable
          onPress={() => onCallBack?.(call.medium)}
          testID="call-back"
          accessibilityRole="button"
          accessibilityLabel={`${label}. Tap to call back.`}
          press="none"
          highlight="dim"
          style={styles.missedTap}>
          {body}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.pill}>
        <Icon name={iconName} size={TOKENS.icon.xs} color={styles.text.color as string} />
        <Text allowFontScaling style={styles.text}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export const CallLogRow = memo(CallLogRowView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      alignItems: 'center',
      paddingVertical: TOKENS.space['2xs'],
    },
    // The tappable target wraps the missed pill; press feedback is `highlight`.
    missedTap: {
      alignItems: 'center',
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    // The missed pill goes a touch taller to seat the two stacked lines; a
    // rounder radius suits the taller shape. Same bg/sunken surface.
    pillMissed: {
      alignItems: 'center',
      borderRadius: TOKENS.radius.md,
    },
    // Column holding the missed label over the call-back hint.
    missedText: {
      alignItems: 'flex-start',
    },
    text: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    // Danger tint on the missed label (7.25:1 light / 6.14:1 dark on bg/sunken).
    textMissed: {
      color: t.color.state.danger,
    },
    // The "Click to call back" line from the reference — neutral secondary
    // (5.90:1 / 4.55:1 on bg/sunken), one step quieter than the red label so the
    // row leads with what happened, then how to act. NOT the accent (budget).
    callBack: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
  });
