import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

/**
 * A centered, muted informational row in the transcript — WhatsApp/Telegram's
 * "system message" (session boundaries, one-time notices). Display-only, never
 * tappable.
 *
 * Per the 2026-09-10 spec (m3.material.io type scale + chips, and the observed
 * WhatsApp/Telegram convention): a fully-rounded pill on bg.sunken, bodySmall in
 * text.tertiary, sentence case, centered in the column. Deliberately NOT a
 * bubble — no sender colour, no tail, never left/right aligned — so it cannot be
 * mistaken for a message from either party. Same visual weight as CallLogRow and
 * DayDivider, which it sits beside. No accessibilityRole override: TalkBack
 * reads the child Text as content, which is correct for a non-interactive line.
 */
function SystemMessageRowView({ text, icon }: { text: string; icon?: IconName }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.pill}>
        {icon !== undefined ? (
          <Icon name={icon} size={TOKENS.icon.xs} color={styles.text.color as string} />
        ) : null}
        <Text allowFontScaling style={styles.text}>
          {text}
        </Text>
      </View>
    </View>
  );
}

export const SystemMessageRow = memo(SystemMessageRowView);

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
      // Long notices wrap and stay centered rather than run edge to edge.
      maxWidth: '82%',
    },
    text: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      textAlign: 'center',
    },
  });
