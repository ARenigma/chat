import React, { memo, useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { DURATION, EASE_BREATHE } from '../theme/motion';
import { useStyles } from '../theme/ThemeProvider';
import { useScreenFocused } from '../hooks/useScreenFocused';

interface Props {
  width?: ViewStyle['width'];
  height?: number;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * A single placeholder block that breathes while content loads.
 *
 * The modern loading idiom is a skeleton of the thing arriving, not a spinner in
 * the middle of nothing: it holds the layout so the real content does not jump in,
 * and it reads as "this specific screen is coming" rather than "something is
 * happening". One shared value drives an opacity pulse on the UI thread (like
 * `Spinner`), and `ReduceMotion.System` leaves it at rest — still a legible
 * placeholder — when the OS flag is set.
 */
function SkeletonView({ width = '100%', height = 12, radius, style }: Props) {
  const styles = useStyles(makeStyles);
  const pulse = useSharedValue(0.5);
  // Stopped while its screen is covered (native-stack keeps it mounted,
  // nav-migration §5); true outside a navigator.
  const screenFocused = useScreenFocused();

  useEffect(() => {
    if (!screenFocused) {
      cancelAnimation(pulse);
      return;
    }
    pulse.value = withRepeat(
      // EASE_BREATHE (a true sinusoid) rather than the weaker
      // `Easing.inOut(Easing.ease)` this used to hand-type: a shimmer is a
      // breathe, and sine has zero velocity at both turning points so the pulse
      // has no tick at the reversal. Same curve Avatar's presence breathe uses.
      withTiming(1, { duration: DURATION.spinnerCycle, easing: EASE_BREATHE }),
      -1,
      true,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(pulse);
  }, [pulse, screenFocused]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.block,
        { width, height, borderRadius: radius ?? TOKENS.radius.xs },
        animated,
        style as ViewStyle,
      ]}
    />
  );
}

export const Skeleton = memo(SkeletonView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    block: {
      backgroundColor: t.color.bg.sunken,
    },
  });
