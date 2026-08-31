/**
 * M3 Contained Loading Indicator (Expressive variant).
 *
 * Spec: https://m3.material.io/components/loading-indicator/overview
 * MDC: https://github.com/material-components/material-components-android/blob/master/docs/components/LoadingIndicator.md
 *   Container: 48 dp, rounded circle.
 *   Active indicator: 38 dp (ratio 38/48), morphing rounded shape.
 *   Colors: indicatorColor = primary/accent, containerColor = surface-container.
 *
 * Policy (docs/android-audit.md): Contained LoadingIndicator = indeterminate
 * short waits. Linear ProgressBar = determinate uploads / under-bar waits.
 * Do not use circular ProgressIndicator or RN ActivityIndicator.
 *
 * Implementation constraints:
 *   - No SVG library (project ban; the popular SVG lib throws
 *     synchronouslyUpdateUIProps inside Reanimated views, killing touch on the
 *     subtree). The arc is drawn with a bordered View, not an SVG path.
 *   - All animation on the UI thread via react-native-reanimated.
 *   - ReduceMotion.System: the arc completes one revolution and stops instead
 *     of looping, matching the OS reduce-motion setting without a JS-side check.
 *
 * DEVIATION from M3 Expressive (deliberate, user 2026-08-31, verified frame by
 * frame). The Expressive loading indicator morphs a filled shape through a
 * 7-shape sequence while rotating. Reproducing that needs SVG path morphing,
 * which is banned here (see above), and the borderRadius circle↔square fake we
 * shipped instead read as a *wobble*, not a morph — the single thing the user
 * flagged as "fucked up". So this is the M3 circular *progress* indicator's
 * indeterminate form instead: a fixed ~180° arc rotating at a steady rate over
 * a faint track. That is a real, in-spec Material shape
 * (https://m3.material.io/components/progress-indicators/guidelines) and it
 * reads as clean rotation with no wobble. Determinate work still uses the linear
 * ProgressBar; this covers short indeterminate in-place waits.
 *
 * Replaces Spinner throughout the app. Pass containerColor="transparent" in
 * contexts where the 48 dp pill container is unwanted (e.g. in-button use).
 */
import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DURATION } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { indicatorSize, indicatorBorderWidth } from '../lib/loadingIndicator';

/** Container diameter at the M3 canonical size. */
export const LOADING_CONTAINER_SIZE = 48;

/** Active indicator diameter at the M3 canonical size. */
export const LOADING_INDICATOR_SIZE = 38;

interface Props {
  /**
   * Container diameter in dp. The active indicator scales proportionally
   * (indicator = size × 38/48).  Default: 48 (M3 canonical).
   */
  size?: number;
  /**
   * Arc colour.  Defaults to the theme accent (coral).
   */
  color?: string;
  /**
   * Container fill.  Pass `'transparent'` for inline use where the pill is
   * unwanted (e.g. inside a Button busy slot).  Defaults to theme bg.sunken
   * (M3 surface-container).
   */
  containerColor?: string;
  /** When false the arc is at rest (useful for controlled pausing). Default true. */
  spinning?: boolean;
  testID?: string;
}

function LoadingIndicatorView({
  size = LOADING_CONTAINER_SIZE,
  color: colorProp,
  containerColor: containerColorProp,
  spinning = true,
  testID,
}: Props) {
  const theme = useTheme();

  // Default: neutral secondary — callers that want the accent pass it explicitly.
  // The arc colour is a semantic choice (action vs. state) that the owning
  // surface, not this primitive, is positioned to make.
  const color = colorProp ?? theme.color.text.secondary;
  const containerColor = containerColorProp ?? theme.color.bg.sunken;

  const indSize = indicatorSize(size);
  const borderWidth = indicatorBorderWidth(indSize);

  // Arc rotation: full revolution per cycle, linear. No shape morph — a steady
  // rotating arc (see the deviation note in the header).
  const rot = useSharedValue(0);

  useEffect(() => {
    if (!spinning) {
      cancelAnimation(rot);
      rot.value = 0;
      return;
    }

    rot.value = 0;
    rot.value = withRepeat(
      withTiming(360, { duration: DURATION.spinnerCycle, easing: Easing.linear }),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );

    return () => {
      cancelAnimation(rot);
    };
  }, [rot, spinning]);

  const arcStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  return (
    <View
      testID={testID}
      accessible={false}
      // Hidden from screen readers: the owning control announces its busy state.
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: containerColor,
        },
      ]}>
      {/* Faint track ring — always visible so the component reads as "working"
          even when Reduce Motion stops the arc. */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.track,
          {
            width: indSize,
            height: indSize,
            borderRadius: indSize / 2,
            borderWidth,
            borderColor: color,
          },
        ]}
      />
      {/* Rotating arc: the top and right borders are coloured and the bottom and
          left are cleared, so on a full-circle radius the painted edge is a
          ~180° arc. Rotating it at a steady rate is the indeterminate circular
          progress shape (no morph — see header). */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.arcSides,
          {
            width: indSize,
            height: indSize,
            borderRadius: indSize / 2,
            borderWidth,
            borderTopColor: color,
            borderRightColor: color,
          },
          arcStyle,
        ]}
      />
    </View>
  );
}

export const LoadingIndicator = memo(LoadingIndicatorView);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
  // Top + right borders are painted (set inline); clearing bottom + left leaves
  // a ~180° arc on a full-circle radius — a single stroke without an SVG path.
  arcSides: {
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  // Track ring: faint background circle behind the arc.
  track: {
    opacity: 0.2,
  },
});
