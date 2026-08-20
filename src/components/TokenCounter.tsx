import React, { memo, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { isLowBalance } from '../lib/tokenLedger';
import { Pressable } from './Pressable';

interface Props {
  balance: number | null;
  onPress: () => void;
}

const SPRING = {
  damping: TOKENS.motion.spring.damping,
  stiffness: TOKENS.motion.spring.stiffness,
  mass: TOKENS.motion.spring.mass,
};

/**
 * The whole token economy, visible at all times. One message costs one token and
 * the number only ever moves by one. Below the threshold it becomes an accent
 * pill and pulses once — the only moment scarcity is felt rather than announced.
 * It never blocks and never opens a sheet by itself.
 */
function TokenCounterView({ balance, onPress }: Props) {
  const low = isLowBalance(balance);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (low) {
      pulse.value = withSequence(withSpring(1.08, SPRING), withSpring(1, SPRING));
    }
  }, [low, pulse]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Pressable
      onPress={onPress}
      testID="token-badge"
      accessibilityLabel={
        balance === null
          ? 'Token balance loading'
          : `${balance} tokens left. One message costs one token.`
      }
      accessibilityHint={low ? 'Opens the refill sheet' : 'Explains how tokens are spent'}>
      <Animated.View style={[low && styles.pill, animated]}>
        <Text
          testID="token-count"
          allowFontScaling
          style={[styles.label, low && styles.labelLow]}>
          {balance === null ? '—' : `${balance} left`}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export const TokenCounter = memo(TokenCounterView);

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 5,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.bg.accentTint,
  },
  label: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
  labelLow: {
    color: TOKENS.color.text.accent,
    fontWeight: '500',
  },
});
