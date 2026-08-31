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
 */
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  /** Numeric count to display.  0 hides the badge entirely. */
  count: number;
  /** Counts above this render as "{max}+".  Default: 9. */
  max?: number;
  testID?: string;
}

function BadgeView({ count, max = 9, testID }: Props) {
  const theme = useTheme();

  if (count <= 0) {
    return null;
  }

  const label = count > max ? `${max}+` : String(count);

  return (
    <View
      testID={testID}
      accessibilityLabel={`${count} unread`}
      style={[
        styles.pill,
        { backgroundColor: theme.color.bg.accent },
      ]}>
      <Text style={[styles.label, { color: theme.color.text.onAccent }]}>
        {label}
      </Text>
    </View>
  );
}

export const Badge = memo(BadgeView);

const styles = StyleSheet.create({
  // M3 badge: 16 dp min-height pill, 6 dp horizontal padding.
  pill: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: TOKENS.radius.pill,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Geist-Bold',
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0,
  },
});
