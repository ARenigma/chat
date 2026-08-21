import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { isLowBalance } from '../lib/tokenLedger';
import { springTo } from '../theme/motion';
import { Pressable } from './Pressable';

interface Props {
  balance: number | null;
  onPress: () => void;
}

/**
 * The whole token economy, visible at all times.
 *
 * It is a citrus chip rather than plain text, which is the one place in the app
 * a third hue is allowed. The reason is that this number is the only thing on
 * screen that is *spent*: it has to be findable in a glance from anywhere, and it
 * must not be confused with the coral, which means "act" rather than "you have".
 * Citrus can only ever be a filled chip carrying ink — as a bare shape it
 * measures 1.3:1 against paper and would be invisible.
 *
 * Below the threshold it swaps to the coral tint and flinches once. That flinch
 * is the only moment scarcity is *felt* rather than announced, and it fires on
 * the transition rather than on every render — an effect keyed on `low` alone
 * re-runs whenever React re-mounts it, which made the pill twitch on unrelated
 * navigation.
 */
function TokenCounterView({ balance, onPress }: Props) {
  const low = isLowBalance(balance);
  const flinch = useSharedValue(0);
  const wasLow = useRef(low);

  useEffect(() => {
    if (low && !wasLow.current) {
      flinch.value = withSequence(springTo(1, 'bounce'), springTo(0, 'snap'));
    }
    wasLow.current = low;
  }, [low, flinch]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + flinch.value * 0.09 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      testID="token-badge"
      press="chip"
      accessibilityLabel={
        balance === null
          ? 'Token balance loading'
          : `${balance} tokens left. One message costs one token.`
      }
      accessibilityHint={low ? 'Opens the refill sheet' : 'Explains how tokens are spent'}>
      <Animated.View style={[styles.pill, low && styles.pillLow, animated]}>
        <Text testID="token-count" allowFontScaling style={[styles.label, low && styles.labelLow]}>
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
    backgroundColor: TOKENS.color.bg.token,
  },
  pillLow: {
    backgroundColor: TOKENS.color.bg.accentTint,
  },
  label: {
    ...TOKENS.typography.numeralMedium,
    color: TOKENS.color.text.token,
  },
  labelLow: {
    color: TOKENS.color.text.accent,
  },
});
