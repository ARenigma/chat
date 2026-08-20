import React, { memo, type ReactNode } from 'react';
import { Pressable as RNPressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  /** 0.96 for cards and rows, 0.94 for the send button. */
  pressScale?: number;
}

const SPRING = {
  damping: TOKENS.motion.spring.damping,
  stiffness: TOKENS.motion.spring.stiffness,
  mass: TOKENS.motion.spring.mass,
};

/**
 * The only interactive primitive. Press feedback runs on the UI thread via
 * Reanimated, so it stays responsive while JavaScript is busy parsing a stream.
 */
function PressableView({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
  style,
  disabled = false,
  testID,
  pressScale = 0.96,
}: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: disabled ? 0.45 : 1,
  }));

  return (
    <RNPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(pressScale, SPRING);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, SPRING);
      }}
      disabled={disabled}
      hitSlop={8}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </RNPressable>
  );
}

export const Pressable = memo(PressableView);
