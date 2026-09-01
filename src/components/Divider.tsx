/**
 * M3 Divider.
 *
 * Spec: https://m3.material.io/components/divider/specs
 *   Full-bleed: extends to both edges.
 *   Inset:      aligns with where the list item's text begins, so the rule
 *               separates rows without cutting under their leading element.
 *
 * The inset distance is a property of the list, not of the divider: an
 * avatar list starts its text at 72 dp, a settings row with a 32 dp icon
 * slot starts at 40 dp. `insetStart` carries that number so both align to
 * their own text rather than one list borrowing the other's geometry.
 *
 * Thickness: 1 dp (StyleSheet.hairlineWidth on hi-dpi, 1 on low-dpi).
 * Color: border.hairline from tokens.
 */
import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

type Variant = 'full' | 'inset';

/** M3 list inset: 16 dp side pad + 40 dp avatar + 16 dp gap. */
export const AVATAR_LIST_INSET = TOKENS.space.md + 40 + TOKENS.space.md;

interface Props {
  variant?: Variant;
  /** Leading offset for `inset`, in dp. Defaults to the avatar-list 72 dp. */
  insetStart?: number;
  testID?: string;
}

function DividerView({
  variant = 'full',
  insetStart = AVATAR_LIST_INSET,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const inset = useMemo(() => ({ marginLeft: insetStart }), [insetStart]);
  return (
    <View
      testID={testID}
      style={[styles.line, variant === 'inset' && inset]}
    />
  );
}

export const Divider = memo(DividerView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    line: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
    },
  });
