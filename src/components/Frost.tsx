import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { BlurView, type BlurViewProps } from '@sbaiahmed1/react-native-blur';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';

/**
 * The BlurView forwards extra props to its native view (`{...props}`) and lays
 * its children out with Yoga, but its prop TYPE omits `ViewProps`; widen it so a
 * Frost can still take `onLayout`, `testID`, etc.
 *
 * This cast is load-bearing for the whole approach: the lib does a SOFTWARE
 * backdrop capture and skips its own subtree, so any content that is a CHILD of
 * the blur is excluded from the capture, while a SIBLING drawn over it gets baked
 * into the blurred bitmap as a ghost copy — the coral halo that appeared around
 * the pills and icons the first time. Making the bar's content the BlurView's
 * children is what removes the halo. (`ReactNativeBlurView.kt`: capture-root
 * redirect + Yoga child layout; `ReactNativeProgressiveBlurViewManager.kt`: the
 * "hoisted as siblings … ghost copy" note.)
 */
const FrostBlur = BlurView as unknown as React.ComponentType<
  BlurViewProps & ViewProps
>;

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
 * A fixed bar the content scrolls UNDER, filled with a real frosted backdrop
 * blur of whatever passes behind it, with a single hairline for its edge. The
 * one place a blur lives, so every dock — nav bar, chat header, composer dock —
 * frosts identically.
 *
 * **History, because it reversed.** This was translucent `bg/chrome` standing in
 * for a blur, then flat opaque `bg/base`: `@react-native-community/blur` rendered
 * a full-window white veil on the emulator AND a real Galaxy S22 Ultra because it
 * never binds its props under the New Architecture, and the translucent fallback
 * "did not look good" on device (Amit, 2026-08-27). The docstring said a real
 * blur was deferred "until it can be done with a custom Fabric/RenderEffect
 * module." That module now exists: `@sbaiahmed1/react-native-blur` is
 * New-Architecture-native and uses Android's `RenderEffect` (API 31+, a
 * translucent-tint fallback below), so the real frost slots back in here behind
 * the same bars. Verified on the S22, 2026-09-03.
 *
 * The tint is `bg/glass` — a ~55% surface wash, more translucent than `bg/chrome`
 * so the blurred content shows through instead of reading as a plate. `blurType`
 * tracks the app's light/dark mode. `overflow: hidden` clips the blur to the bar;
 * the children render above the blur (and are excluded from its capture — see
 * `FrostBlur`), so any text or icons over the bar stay crisp with no ghost halo.
 */
export function Frost({ children, style, edge, ...rest }: Props) {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  return (
    <FrostBlur
      {...rest}
      style={[style, styles.clip]}
      blurType={isDark ? 'dark' : 'light'}
      blurAmount={18}
      overlayColor={theme.color.bg.glass}>
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
    </FrostBlur>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
