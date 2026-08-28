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
 * A bar the content scrolls under, filled OPAQUE with the page colour, with a
 * single hairline for the edge.
 *
 * It was translucent `bg/chrome` for a spell, standing in for a real blur. Two
 * things killed that: `@react-native-community/blur` rendered a full-window white
 * veil on both the emulator and a real Galaxy S22 Ultra (never binds props under
 * the New Architecture), and the translucent fallback "did not look good" on
 * device (Amit, 2026-08-27). So the fill is now the opaque page colour — a clean
 * flat bar with a hairline. A real frosted blur is deferred until it can be done
 * with a custom Fabric/RenderEffect module; this component is where it would slot
 * back in behind the same bars.
 */
export function Frost({ children, style, edge, ...rest }: Props) {
  const theme = useTheme();
  return (
    <View style={style} {...rest}>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.bg.base }]}
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
