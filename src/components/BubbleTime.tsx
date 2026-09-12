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
  onMedia,
}: {
  stamp: string;
  /*
   * Named `onMedia`, not `onAccent`, and the rename is the fix rather than
   * tidying: the only caller is the overlay pinned to a photo, so the flag
   * never meant "on the accent fill" even before the outgoing bubble stopped
   * being the accent. The old name is what kept a second, staler copy of the
   * timestamp decision alive next to the tokenised one in Turn's MetaRow.
   */
  onMedia: boolean;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Text
      allowFontScaling={false}
      style={[styles.time, onMedia ? styles.timeOnMedia : styles.timePeer]}>
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
    timeOnMedia: {
      color: t.color.media.meta,
    },
  });
