import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Icon, ICON_SCALE, type IconName } from './Icon';

/**
 * A centered, muted informational row in the transcript — WhatsApp/the reference app's
 * "system message" (session boundaries, one-time notices). Display-only, never
 * tappable.
 *
 * Per the 2026-09-10 spec (m3.material.io type scale + chips, and the observed
 * WhatsApp/the reference app convention): a fully-rounded pill on bg.sunken, bodySmall in
 * text.tertiary, sentence case, centered in the column. Deliberately NOT a
 * bubble — no sender colour, no tail, never left/right aligned — so it cannot be
 * mistaken for a message from either party. Same visual weight as CallLogRow and
 * DayDivider, which it sits beside. No accessibilityRole override: TalkBack
 * reads the child Text as content, which is correct for a non-interactive line.
 */
function SystemMessageRowView({
  text,
  icon,
  emoji,
}: {
  text: string;
  icon?: IconName;
  /**
   * A literal emoji character, rendered at the same box the vector icon would
   * take (`TOKENS.icon.xs`) — for the one mark that IS an emoji rather than a
   * glyph (the session-ended row's orange heart, Amit 2026-09-18). Mutually
   * exclusive with `icon`: an emoji carries its own colour, so it does not
   * take `styles.text.color` the way the Icon glyph does.
   */
  emoji?: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      <View style={styles.pill}>
        {icon !== undefined ? (
          <Icon name={icon} size={TOKENS.icon.xs} color={styles.text.color as string} />
        ) : null}
        {emoji !== undefined ? (
          <Text allowFontScaling={false} style={styles.emoji}>
            {emoji}
          </Text>
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
      // Full-width column so the pill's maxWidth percentage resolves against the
      // transcript, not against an intrinsic shrink-wrapped parent — without a
      // definite parent width the pill grew with the string and ran off-screen
      // on long notices (provider chat, both sides share this cell).
      alignItems: 'center',
      alignSelf: 'stretch',
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space['2xs'],
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      // Allow the label to wrap onto a second line inside the pill instead of
      // stretching the row past the screen edge.
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
      // Long notices wrap and stay centered rather than run edge to edge.
      maxWidth: '100%',
      alignSelf: 'center',
    },
    text: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      textAlign: 'center',
      // Row flex children refuse to shrink below their intrinsic text width
      // unless told to — without this the pill ignores maxWidth and the
      // string paints past the screen edge.
      flexShrink: 1,
    },
    // Matches the box an Icon at `TOKENS.icon.xs` actually renders — Icon.tsx
    // multiplies `size` by its own `ICON_SCALE` before it becomes a fontSize,
    // so matching just `TOKENS.icon.xs` here would read smaller than the glyph
    // it replaced.
    //
    // `lineHeight` is deliberately NOT equal to `fontSize` — roughly a 1.2
    // ratio, which is what the app's deleted emoji grid also used (28/34) and
    // what its own measurements showed was needed. A color emoji's
    // bitmap needs more vertical room than its nominal font size to paint
    // without being clipped down to Android's monochrome tofu fallback, which
    // is what an equal 14/14 box did here (Amit, 2026-09-18, confirmed on the
    // S22: rendered as a plain grey outline heart, not the orange emoji).
    emoji: {
      fontSize: Math.round(TOKENS.icon.xs * ICON_SCALE),
      lineHeight: Math.round(TOKENS.icon.xs * ICON_SCALE * 1.2),
    },
  });
