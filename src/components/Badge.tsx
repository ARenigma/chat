/**
 * M3 Badge.
 *
 * Spec: https://m3.material.io/components/badges/specs
 *   Small badge (count > 0): 16 dp pill, filled coral, white text.
 *   Large badge (count > max): shows "9+" or similar.
 *
 * Attached via absolute positioning over a parent that has position: 'relative'.
 * The badge sits at the top-right corner of its anchor.
 *
 * Constraints: no SVG, no external deps. Pure View + Text.
 *
 * The fill and the ink are BOTH in `makeStyles` rather than half of each being
 * an inline `{ backgroundColor: theme.color... }` on the JSX, which is how they
 * were written until 2026-09-07. Every other themed component in src/components
 * goes through `useStyles`, and the split mattered for more than tidiness: the
 * pairing gate in `__tests__/walletTone.test.ts` slices `StyleSheet.create`
 * blocks by name, so a fill living in the JSX was a fill the gate could not see
 * — and this is the one badge in the app, so it is the widest-reach surface the
 * gate was blind to.
 */
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

interface Props {
  /** Numeric count to display.  0 hides the badge entirely. */
  count: number;
  /** Counts above this render as "{max}+".  Default: 9. */
  max?: number;
  testID?: string;
}

function BadgeView({ count, max = 9, testID }: Props) {
  const styles = useStyles(makeStyles);

  if (count <= 0) {
    return null;
  }

  const label = count > max ? `${max}+` : String(count);

  return (
    <View testID={testID} accessibilityLabel={`${count} unread`} style={styles.pill}>
      {/* The pill is a fixed 16dp height with a fixed lineHeight; unbounded font
          scaling clips the count. The geometry is deliberate, so the count does
          not scale with it. (2026-09-09 audit) */}
      <Text allowFontScaling={false} style={styles.label}>{label}</Text>
    </View>
  );
}

export const Badge = memo(BadgeView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /*
     * accentStrong, NOT accent — and this is the widest-reach instance of that
     * rule in the app, because this component is every unread count there is.
     *
     * `label` below is `text/onAccent` at 10dp Bold, the smallest type in the
     * product. developer.android.com/guide/topics/ui/accessibility/apps
     * ("Increase text visibility"): "If the text is smaller than 18sp, or if the
     * text is bold and smaller than 14sp, use foreground and background colors
     * that result in a color contrast ratio of at least 4.5:1." 10dp Bold
     * satisfies BOTH halves of that sentence, so there is no reading of it that
     * lets this label off 4.5:1. `bg/accent` measured 3.44:1 light and 2.59:1
     * dark under it; `bg/accentStrong` is 5.19:1 and 6.13:1.
     *
     * The fill moves rather than the label, as on the six surfaces fixed in
     * aba2c13: the coral is what makes an unread count read as unread, and the
     * only ink that would work is `text/primary`, which is 4.95:1 light but
     * 2.70:1 dark — in dark `text/primary` IS white, so it is not an answer,
     * just the same failure spelled differently.
     *
     * design/tokens.json names this exact surface on the token: bg/accentStrong
     * is "the user's own message bubble, THE UNREAD COUNT, and every filled
     * accent affordance that carries a label". The badge was the one thing in
     * that sentence that was not doing it.
     *
     * M3 badge: 16 dp min-height pill, 6 dp horizontal padding.
     */
    pill: {
      position: 'absolute',
      top: -4,
      right: -6,
      minWidth: 16,
      height: 16,
      borderRadius: TOKENS.radius.pill,
      paddingHorizontal: TOKENS.space['2xs'],
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
    },
    label: {
      fontFamily: 'Geist-Bold',
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0,
      color: t.color.text.onAccent,
    },
  });
