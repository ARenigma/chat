import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DURATION } from '../theme/motion';
import { MIN_OPACITY, SPOKES, spokeAngle, spokeMetrics, spokeOpacity } from '../lib/spinner';

interface Props {
  /** Overall diameter in points. Spoke geometry is derived from it. */
  size?: number;
  color: string;
  /** Stops the clock and leaves the ring at rest. */
  spinning?: boolean;
  testID?: string;
}

/**
 * The iOS activity indicator, drawn with eight Views.
 *
 * **One clock drives eight styles.** A shared value runs 0 to 1 on repeat and
 * every spoke derives its own opacity from it inside a worklet, so the whole
 * indicator is one animation on the UI thread rather than eight. That is the
 * difference between this being free at 120Hz and it being eight timers
 * competing for the same frame.
 *
 * **Nothing rotates.** The obvious implementation spins a parent transform, and
 * that is wrong twice: a rotating transform on eight children is more work per
 * frame than eight opacity writes, and a rotation is continuous while the real
 * indicator steps from spoke to spoke. Opacity is also the one property that
 * cannot cause a layout pass, which matters because this appears inside a button
 * that must not resize while it is busy.
 *
 * **`ReduceMotion.System`.** A user who has asked the OS to reduce motion gets a
 * static ring at its resting opacities rather than nothing at all: the control
 * still says "working", it just does not move. Removing the indicator entirely
 * would take the information away with the animation.
 */
function SpinnerView({ size = 16, color, spinning = true, testID }: Props) {
  const progress = useSharedValue(0);
  const { length, thickness, radius, inset } = spokeMetrics(size);

  useEffect(() => {
    if (!spinning) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      // Linear, and it must be: an eased revolution speeds up and slows down
      // within one turn, which reads as the indicator hesitating.
      withTiming(1, { duration: DURATION.spinnerCycle, easing: Easing.linear }),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(progress);
  }, [progress, spinning]);

  return (
    <View
      testID={testID}
      accessible={false}
      // Hidden from screen readers on purpose. The control that owns this already
      // announces its own busy state through its label, and a second
      // announcement of "loading" is noise on top of the sentence that matters.
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}>
      {Array.from({ length: SPOKES }, (_, index) => (
        <Spoke
          key={index}
          index={index}
          progress={progress}
          spinning={spinning}
          color={color}
          size={size}
          length={length}
          thickness={thickness}
          radius={radius}
          inset={inset}
        />
      ))}
    </View>
  );
}

interface SpokeProps {
  index: number;
  progress: SharedValue<number>;
  spinning: boolean;
  color: string;
  size: number;
  length: number;
  thickness: number;
  radius: number;
  inset: number;
}

function Spoke({
  index,
  progress,
  spinning,
  color,
  size,
  length,
  thickness,
  radius,
  inset,
}: SpokeProps) {
  const animated = useAnimatedStyle(() => ({
    opacity: spinning ? spokeOpacity(index, progress.value) : MIN_OPACITY * 2,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.spoke,
        {
          width: thickness,
          height: length,
          borderRadius: radius,
          backgroundColor: color,
          left: size / 2 - thickness / 2,
          top: size / 2 - inset - length,
          // Rotation about the centre of the ring rather than the centre of the
          // capsule, which is what puts each spoke on the circle instead of
          // stacking all eight on top of each other.
          transform: [
            { translateY: inset + length / 2 },
            { rotate: `${spokeAngle(index)}deg` },
            { translateY: -(inset + length / 2) },
          ],
        },
        animated,
      ]}
    />
  );
}

export const Spinner = memo(SpinnerView);

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The only static property a spoke has. Everything else is derived from the
  // requested diameter, so it cannot live in a stylesheet.
  spoke: {
    position: 'absolute',
  },
});
