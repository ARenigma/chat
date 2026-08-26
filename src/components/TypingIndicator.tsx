import React, { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { DURATION } from '../theme/motion';

const CYCLE = DURATION.breath / 4;
const OFFSET = DURATION.fast;

/**
 * Deliberately a breath, not a bounce. A mechanical bounce reads as a loading
 * spinner; opacity and scale easing in and out on a sine curve reads as someone
 * on the other end. Accent-coloured, one of the five permitted accent uses.
 */
const Dot = ({ delay }: { delay: number }) => {
  const styles = useStyles(makeStyles);
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

/**
 * `label` is rendered now, not only announced.
 *
 * It was passed in from PeerTyping and used for `accessibilityLabel` alone, so a
 * sighted user saw three loose coral dots with no name attached, which is the
 * one thing a two-person thread does not need to be told, and the one thing the
 * reference shows as text.
 *
 * `accessibilityRole="progressbar"` is gone with it: it maps to Android's
 * ProgressBar and has no iOS trait, and the label carries the meaning by itself.
 */
function TypingIndicatorView({ label = 'Typing' }: { label?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.host} testID="typing-indicator" accessibilityLabel={label}>
      <Dot delay={0} />
      <Dot delay={OFFSET} />
      <Dot delay={OFFSET * 2} />
      <Text allowFontScaling style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export const TypingIndicator = memo(TypingIndicatorView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space.xs,
  },
  label: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: t.color.bg.accent,
  },
});
