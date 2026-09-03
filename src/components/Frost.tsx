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
   * Omit it for a bar that should read as nothing at all.
   */
  edge?: 'top' | 'bottom';
  /**
   * The surface wash over the blur. `glass` (default) is the ~55% bar plate.
   * `none` leaves the blur untinted, for a bar that is meant to be a lens rather
   * than a surface — the chat composer, whose dock carries no fill of its own.
   */
  tint?: 'glass' | 'none';
  /**
   * Blur radius. Defaults to the standard bar frost. Pass 0 to make the bar
   * vanish entirely while keeping this component mounted — which matters,
   * because the children must stay CHILDREN of the BlurView (see `FrostBlur`);
   * swapping the wrapper out for a plain View to hide the bar would re-parent
   * them into a sibling and bake the ghost halo back in.
   */
  blurAmount?: number;
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
export function Frost({
  children,
  style,
  edge,
  tint = 'glass',
  blurAmount = 18,
  ...rest
}: Props) {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  return (
    <FrostBlur
      {...rest}
      style={[style, styles.clip]}
      blurType={isDark ? 'dark' : 'light'}
      blurAmount={blurAmount}
      /*
       * Two passes, not the library's default five.
       *
       * `blurRounds` is how many times the blur kernel is run, and these bars
       * are permanently on screen over content that moves — every scrolled
       * frame and every tab cross-fade re-runs all of them. Five was costing
       * roughly twice the GPU work of two for a difference that cannot be seen
       * at this radius on a 1080p panel, and it was showing up as dropped
       * frames on tab switches (Amit, 2026-09-04).
       */
      blurRounds={2}
      overlayColor={tint === 'none' ? 'transparent' : theme.color.bg.glass}>
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
