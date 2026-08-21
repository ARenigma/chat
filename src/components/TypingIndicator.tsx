import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { DURATION } from '../theme/motion';

const CYCLE = DURATION.breath / 4;
const OFFSET = DURATION.fast;

/**
 * Deliberately a breath, not a bounce. A mechanical bounce reads as a loading
 * spinner; opacity and scale easing in and out on a sine curve reads as someone
 * on the other end. Accent-coloured — one of the five permitted accent uses.
 */
const Dot = ({ delay }: { delay: number }) => {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: CYCLE, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, t]);

  const animated = useAnimatedStyle(() => ({
    opacity: 0.35 + t.value * 0.65,
    transform: [{ scale: 0.85 + t.value * 0.15 }],
  }));

  return <Animated.View style={[styles.dot, animated]} />;
};

function TypingIndicatorView({ label = 'Typing' }: { label?: string }) {
  return (
    <View
      style={styles.host}
      testID="typing-indicator"
      accessibilityRole="progressbar"
      accessibilityLabel={label}>
      <Dot delay={0} />
      <Dot delay={OFFSET} />
      <Dot delay={OFFSET * 2} />
    </View>
  );
}

export const TypingIndicator = memo(TypingIndicatorView);

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space.xs,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: TOKENS.color.bg.accent,
  },
});
