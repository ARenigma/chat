/**
 * M3 Divider.
 *
 * Spec: https://m3.material.io/components/divider/specs
 *   Full-bleed: extends to both edges.
 *   Inset:      starts at 72 dp from the leading edge (after icon + gap),
 *               matching the M3 list avatar inset.
 *
 * Thickness: 1 dp (StyleSheet.hairlineWidth on hi-dpi, 1 on low-dpi).
 * Color: border.hairline from tokens.
 */
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

type Variant = 'full' | 'inset';

interface Props {
  variant?: Variant;
  testID?: string;
}

function DividerView({ variant = 'full', testID }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View testID={testID} style={[styles.line, variant === 'inset' && styles.inset]} />
  );
}

export const Divider = memo(DividerView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    line: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
    },
    // M3 list inset: 72 dp from leading (16 side pad + 40 avatar + 16 gap).
    inset: {
      marginLeft: TOKENS.space.md + 40 + TOKENS.space.md,
    },
  });
