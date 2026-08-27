import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props extends ViewProps {
  children: React.ReactNode;
  /**
   * Which edge carries the separating hairline. A frosted bar has no shadow —
   * a drop shadow under a translucent bar reads as a smudge — so the hairline is
   * the whole edge. `top` for a bottom-anchored bar, `bottom` for a top one.
   */
  edge?: 'top' | 'bottom';
}

/**
 * A frosted bar: a translucent `bg/chrome` pane the content scrolls under, with a
 * single hairline for the edge.
 *
 * Real Gaussian `BlurView` (`@react-native-community/blur`) was tried and pulled
 * out twice — once on the New-Architecture emulator, then confirmed on a real
 * Galaxy S22 Ultra (Amit, 2026-08-27): it rendered a full-window white veil on
 * hardware too, not a localized blur, because the library never bound its props
 * under the New Architecture. So this is the reliable half: `bg/chrome` (white/
 * black at 0.80) as a translucent fill, which over an *overlay* bar still lets the
 * content scrolling beneath read through — a genuine pane of frosted glass, just
 * without the Gaussian softening. If a real blur is ever wanted it needs a custom
 * Fabric/RenderEffect module, not that library.
 */
export function Frost({ children, style, edge, ...rest }: Props) {
  const theme = useTheme();
  return (
    <View style={style} {...rest}>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.bg.chrome }]}
      />
      {edge !== undefined ? (
        <View
          style={[
            styles.hairline,
            edge === 'top' ? styles.top : styles.bottom,
            { backgroundColor: theme.color.border.hairline },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
