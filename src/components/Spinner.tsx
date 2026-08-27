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
import { ringBorderWidth } from '../lib/spinner';

interface Props {
  /** Overall diameter in points. Border width is derived from it. */
  size?: number;
  color: string;
  /** Stops the ring and leaves it at rest. */
  spinning?: boolean;
  testID?: string;
}

/**
 * A smooth rotating ring (Fuse / SwiftUI ProgressView look).
 *
 * **One shared value drives one transform.** A single `rotate` on the UI thread
 * replaces the eight-spoke opacity cascade. The ring never blocks on the JS
 * thread, so it keeps spinning during OAuth hand-offs and heavy renders.
 *
 * **Two concentric views, no SVG.**
 * - A static `View` with `opacity: 0.2` is the faint track.
 * - An `Animated.View` with only `borderTopColor` set is the bright arc; it
 *   rotates via `useAnimatedStyle`. Putting the opacity on the track view rather
 *   than the border colour avoids any need to parse or modify the colour string
 *   that the caller supplies.
 *
 * **`ReduceMotion.System`.** Passing `ReduceMotion.System` to `withRepeat` means
 * the OS's Reduce Motion flag is respected without any JS-side check: the loop
 * simply does not restart after the first revolution, leaving a static ring that
 * still communicates "working". `cancelAnimation` on unmount prevents a dangling
 * loop from accumulating on the UI runtime.
 */
function SpinnerView({ size = 16, color, spinning = true, testID }: Props) {
  const rot = useSharedValue(0);
  const borderWidth = ringBorderWidth(size);

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
    return () => cancelAnimation(rot);
  }, [rot, spinning]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value}deg` }],
  }));

  return (
    <View
      testID={testID}
      accessible={false}
      // Hidden from screen readers on purpose. The control that owns this already
      // announces its busy state through its label; a second announcement is noise.
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}>
      {/* Faint track ring: always visible so the control reads as "working" even
          when Reduce Motion is on and the arc is static. */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.track,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderColor: color,
          },
        ]}
      />
      {/* Rotating arc: only the top border is coloured; the other three sides are
          transparent, producing the single-stroke arc that spins. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.arc,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth,
            borderTopColor: color,
          },
          animated,
        ]}
      />
    </View>
  );
}

export const Spinner = memo(SpinnerView);

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
  // Faint circular track behind the arc. opacity + color = ~20% tint without
  // needing to know the color format the caller passes.
  track: {
    opacity: 0.2,
  },
  // The arc itself: only borderTopColor is populated; the other three sides are
  // transparent so only one stroke is visible as the ring rotates.
  arc: {
    borderColor: 'transparent',
  },
});
