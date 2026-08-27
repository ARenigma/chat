import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';

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
 * A frosted bar: real Gaussian backdrop blur of whatever scrolls behind it.
 *
 * S22-TRIAL MODE (Amit, 2026-08-27). This uses `@react-native-community/blur`'s
 * `BlurView`, whose Android backend (Dimezis) applies `RenderEffect` on API 31+.
 * Research verdict: the fullscreen milky haze this produced earlier was the
 * EMULATOR's software GL failing RenderEffect — on a real S22 Ultra (Adreno,
 * hardware GPU) it renders true localized blur. So expect haze on the emulator
 * and judge this on the device.
 *
 * Caveat, also from research: this library is not migrated to the New
 * Architecture ("Could not find generated setter for BlurViewManager"), so its
 * props may not bind and the tint can fall back to the library's dark default. If
 * the blur looks right on the S22 but the tint is off, the fix is a small custom
 * Fabric/Kotlin module wrapping the same Dimezis view with proper prop binding —
 * a drop-in swap for this component. If the blur itself is bad, revert `BlurView`
 * to a plain `bg/chrome` fill (the previous, reliable translucent frost).
 *
 * A `bg/chrome` View sits BEHIND the blur as the fallback surface, so if the blur
 * fails to render anything the bar is still a translucent pane rather than
 * transparent.
 */
export function Frost({ children, style, edge, ...rest }: Props) {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  return (
    <View style={style} {...rest}>
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.bg.chrome }]}
      />
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType={isDark ? 'dark' : 'light'}
        blurAmount={16}
        overlayColor={theme.color.bg.chrome}
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
