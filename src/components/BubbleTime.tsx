import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

/**
 * WhatsApp-style clock nested at the end of the bubble body.
 *
 * Inline (not absolute): absolute corner clocks clipped short one-line messages
 * ("How was your day?" → "How was"). Nested Text keeps the full body and sits
 * the stamp on the last line like WhatsApp.
 */
function BubbleTimeView({
  stamp,
  onAccent,
}: {
  stamp: string;
  onAccent: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Text
      allowFontScaling={false}
      style={[styles.time, onAccent ? styles.timeOnAccent : styles.timePeer]}>
      {stamp}
    </Text>
  );
}

export const BubbleTime = memo(BubbleTimeView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    time: {
      ...TOKENS.typography.bodySmall,
      fontSize: 11,
      lineHeight: 16,
    },
    timePeer: {
      color: t.color.text.tertiary,
    },
    timeOnAccent: {
      color: 'rgba(255,255,255,0.72)',
    },
  });
