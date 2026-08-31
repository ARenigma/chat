import React, { memo, type ReactNode } from 'react';
import {
  Pressable as RNPressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { DURATION, PRESS, springTo } from '../theme/motion';

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Layout style for the outer pressable (the flex child). Put `flex: 1` here,
   * not on `style`: equal-width pills come from the pressable stretching, and a
   * flex on the inner animated view does nothing because its parent is the
   * pressable, not the row.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** Colour of the release ripple. Rendered at low opacity, so pass a full fill. */
  rippleColor: string;
  /** Optional leading emoji; wiggles once on release (Option B). */
  emoji?: string;
  emojiStyle?: StyleProp<TextStyle>;
  /** Press-in scale target. Defaults to the chip token (0.94). */
  pressScale?: number;
  accessibilityHint?: string;
  testID?: string;
}

/**
 * The "springy tactile" engagement CTA (design decision, user 2026-08-31,
 * Option B of the CTA study). Reserved for *invitational* actions — the
 * first-move pills and the SP hero card — not the workhorse ink `Button`,
 * because animating every action is what makes press feedback stop meaning
 * anything (Neel Networks CRO 2026; our own motion restraint).
 *
 * Three coordinated beats on one tap:
 *   1. Press-in squashes to `pressScale` on the `snap` spring.
 *   2. Release springs back on the `bounce` spring (ratio 0.59), so it
 *      overshoots 1.0 once and settles — the "pop". This is the one place
 *      outside the send that borrows `bounce`, and it is deliberate.
 *   3. On release a ripple blooms from centre and the emoji wiggles once.
 *
 * Reduced motion: the press scale is kept (feedback must survive) but jumps
 * without the spring, and the ripple + wiggle are suppressed entirely. This is
 * the accessibility contract every source in the CTA study insisted on.
 */
function TactileCTAView({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
  style,
  containerStyle,
  rippleColor,
  emoji,
  emojiStyle,
  pressScale = PRESS.chip,
  testID,
}: Props) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0); // 0 = rest, 1 = pressed
  const ripple = useSharedValue(0); // 0→1 growth on release
  const rippleAlive = useSharedValue(0); // gates the ripple's presence
  const wig = useSharedValue(0); // emoji rotation, degrees

  const surface = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - pressScale) * p.value }],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: rippleAlive.value * 0.22 * (1 - ripple.value),
    transform: [{ scale: 0.2 + ripple.value * 6 }],
  }));

  const emojiAnim = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wig.value}deg` }],
  }));

  const onPressIn = () => {
    // springTo carries the token (SPRING.snap) and ReduceMotion.System, so the
    // house rule "never call withSpring directly" holds here too.
    p.value = springTo(1, 'snap');
  };

  const onPressOut = () => {
    // Release with overshoot — the tactile pop (SPRING.bounce via springTo).
    p.value = springTo(0, 'bounce');
    if (reduce) return;
    ripple.value = 0;
    rippleAlive.value = 1;
    ripple.value = withTiming(
      1,
      { duration: DURATION.slow, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) rippleAlive.value = 0;
      },
    );
    if (emoji) {
      // A single quick shake. Each beat is DURATION.instant so the timing lives
      // in the tokens, not as a raw millisecond literal (house motion rule).
      wig.value = withSequence(
        withTiming(16, { duration: DURATION.instant }),
        withTiming(-12, { duration: DURATION.instant }),
        withTiming(6, { duration: DURATION.instant }),
        withTiming(0, { duration: DURATION.instant }),
      );
    }
  };

  return (
    <RNPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={8}
      style={containerStyle}>
      <Animated.View style={[styles.clip, style, surface]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.ripple, { backgroundColor: rippleColor }, rippleStyle]}
        />
        {emoji ? (
          <Animated.Text allowFontScaling style={[emojiStyle, emojiAnim]}>
            {emoji}
          </Animated.Text>
        ) : null}
        {children}
      </Animated.View>
    </RNPressable>
  );
}

export const TactileCTA = memo(TactileCTAView);

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  ripple: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginTop: -20,
    marginLeft: -20,
    borderRadius: 999,
  },
});
