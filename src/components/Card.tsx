/**
 * M3 Card.
 *
 * Spec: https://m3.material.io/components/cards/specs
 *   Filled:   elevated surface, no border, shadow optional.
 *   Outlined: no elevation, 1 dp border (hairline color).
 *   Corner radius: from tokens (radius.lg = 20 dp, close to M3's 12 dp; we use
 *   the app's own system rather than overriding it — the tokens are the contract).
 *
 * The component is a layout primitive.  Pass children; the card does not own
 * its internal padding — callers choose whether to pad inside.
 *
 * Elevation: React Native has no first-class shadow that matches M3 exactly
 * across platforms, and box-shadow is web only.  Filled cards get a subtle
 * background tint (`bg.raised`) plus a thin hairline border so they separate
 * from `bg.base` without needing a shadow — iOS idiom over Material elevation.
 */
import React, { memo, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

type Variant = 'filled' | 'outlined';

interface Props {
  variant?: Variant;
  style?: ViewStyle;
  children: ReactNode;
  testID?: string;
}

function CardView({ variant = 'filled', style, children, testID }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View testID={testID} style={[styles.base, styles[variant], style]}>
      {children}
    </View>
  );
}

export const Card = memo(CardView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    base: {
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    filled: {
      backgroundColor: t.color.bg.raised,
      // Hairline so the card reads against bg.base without a shadow.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
    },
    outlined: {
      backgroundColor: t.color.bg.base,
      borderWidth: 1,
      borderColor: t.color.border.strong,
    },
  });
