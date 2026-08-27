import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { CallRecord } from '../api/chat';
import { timeOfDay } from '../lib/datetime';
import { Icon } from './Icon';

/**
 * Display-only inline call log row in the chat transcript.
 *
 * Rendered after voice/video calls end (status: ended, missed, declined, failed).
 * Non-tappable by design: the row is a log entry, not a re-initiate affordance.
 * Centered pill layout, caption text, muted — matches the DayDivider visual weight.
 */

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (startedAt === null || endedAt === null) {
    return '';
  }
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms <= 0) {
    return '';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return ` · ${minutes}:${String(seconds).padStart(2, '0')}`;
}

function CallLogRowView({ call }: { call: CallRecord }) {
  const styles = useStyles(makeStyles);

  const isVideo = call.medium === 'video';
  const iconName = isVideo ? 'video' : 'call';
  const mediumLabel = isVideo ? 'Video' : 'Voice';

  const stamp = timeOfDay(call.created_at);
  let label: string;
  switch (call.status) {
    case 'ended':
      label = `${mediumLabel} call${formatDuration(call.started_at, call.ended_at)} · ${stamp}`;
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
        <Icon name={iconName} size={11} color={styles.text.color as string} />
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
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
    },
  });
