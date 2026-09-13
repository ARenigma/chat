import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { CallRecord } from '../api/chat';
import { timeOfDay } from '../lib/datetime';
import { durationWords } from '../lib/transcript';
import { Icon } from './Icon';

/**
 * Display-only inline call log row in the chat transcript.
 *
 * Rendered after voice/video calls end (status: ended, missed, declined, failed).
 * Non-tappable by design: the row is a log entry, not a re-initiate affordance.
 * Centered pill layout, caption text, muted — matches the DayDivider visual weight.
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

function CallLogRowView({ call }: { call: CallRecord }) {
  const styles = useStyles(makeStyles);

  const isVideo = call.medium === 'video';
  const iconName = isVideo ? 'video' : 'call';
  const mediumLabel = isVideo ? 'Video' : 'Voice';

  const stamp = timeOfDay(call.created_at);
  // The separator is composed here, not inside the formatter, because a call
  // with no measurable duration (never connected, or both ends on the same
  // instant) must not leave a dangling " · " in the middle of the pill.
  const duration = formatDuration(call.started_at, call.ended_at);
  let label: string;
  switch (call.status) {
    case 'ended':
      label = `${mediumLabel} call${duration === '' ? '' : ` · ${duration}`} · ${stamp}`;
      break;
    case 'missed':
      label = `Missed ${mediumLabel.toLowerCase()} call · ${stamp}`;
      break;
    case 'declined':
      label = `Declined call · ${stamp}`;
      break;
    case 'failed':
      label = `Call failed · ${stamp}`;
      break;
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
    text: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
  });
