import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  onPress: () => void;
  disabled: boolean;
  /** Increments on each successful send, triggering one bloom. */
  bloomKey: number;
}

const SIZE = 40;

/**
 * The one accent-filled control in the app, and the most-touched element. On send
 * it emits a single soft bloom — one ring, not a particle system. Disabled drops
 * to bg/sunken rather than reducing opacity, so the glyph keeps its contrast.
 */
function SendButtonView({ onPress, disabled, bloomKey }: Props) {
  const bloom = useSharedValue(0);

  useEffect(() => {
    if (bloomKey === 0) {
      return;
    }
    // 1 -> 0, so the ring is only visible while it is expanding. Driving it the
    // other way leaves a permanent 18% halo behind an idle button.
    bloom.value = 1;
    bloom.value = withTiming(0, { duration: TOKENS.motion.duration.slow });
  }, [bloomKey, bloom]);

  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloom.value * 0.18,
    transform: [{ scale: 1 + (1 - bloom.value) * 0.8 }],
  }));

  return (
    <View style={styles.host}>
      <Animated.View pointerEvents="none" style={[styles.bloom, bloomStyle]} />
      <Pressable
        onPress={onPress}
        disabled={disabled}
        pressScale={0.94}
        testID="composer-send"
        accessibilityLabel="Send message"
        accessibilityHint="Spends one token"
        style={[styles.button, disabled && styles.buttonDisabled]}>
        <Icon
          glyph="arrow-up"
          size={20}
          color={disabled ? TOKENS.color.text.secondary : TOKENS.color.text.onAccent}
        />
      </Pressable>
    </View>
  );
}

export const SendButton = memo(SendButtonView);

const styles = StyleSheet.create({
  host: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloom: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: TOKENS.color.bg.accent,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.accent,
  },
  buttonDisabled: {
    backgroundColor: TOKENS.color.bg.sunken,
  },
});
