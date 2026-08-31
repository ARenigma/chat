import React, { memo, useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { DURATION } from '../theme/motion';
import { useStyles } from '../theme/ThemeProvider';

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

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: DURATION.spinnerCycle, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

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
