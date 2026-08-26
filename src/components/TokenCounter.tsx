import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatTokens, isLowBalance } from '../lib/rates';
import { springTo } from '../theme/motion';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  /** The ₹ balance, in whole rupees. Null while loading. */
  balance: number | null;
  onPress: () => void;
}

/**
 * The balance, visible at all times, now money rather than a message count.
 *
 * ADR-0019 changed the unit from tokens-per-message to rupees-per-minute, so this
 * reads `₹460`, not `460 left`. It stays a citrus chip — the one place a third hue
 * is allowed — because this number is the only thing on screen that is *spent*: it
 * has to be findable in a glance and must not be confused with the coral, which
 * means "act" rather than "you have". The v13 pill pairs the number with a wallet
 * glyph, which also disambiguates it from a plain count.
 *
 * Below the threshold it swaps to the coral tint and flinches once. That flinch is
 * the only moment scarcity is *felt* rather than announced, and it fires on the
 * transition rather than on every render — an effect keyed on `low` alone re-runs
 * whenever React re-mounts it, which made the pill twitch on unrelated navigation.
 */
function TokenCounterView({ balance, onPress }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
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
          ? 'Balance loading'
          : `${formatTokens(balance)} tokens. Talk time is charged by the minute.`
      }
      accessibilityHint={low ? 'Opens Recharge' : 'Opens Recharge and explains rates'}>
      <Animated.View style={[styles.pill, low && styles.pillLow, animated]}>
        {/* The wallet is always the filled instance — it is the app's standing
            "you have" mark, not a toggled state, so it should never read as the
            hollow, inactive outline. */}
        <Icon
          name="wallet"
          active
          size={15}
          color={low ? theme.color.text.accent : theme.color.text.token}
        />
        <Text testID="token-count" allowFontScaling style={[styles.label, low && styles.labelLow]}>
          {balance === null ? '' : formatTokens(balance)}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export const TokenCounter = memo(TokenCounterView);

const makeStyles = (t: Theme) => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: 5,
    // radius.xs, not a capsule: a filled pill in a header band is a Material chip,
    // and iOS's equivalent is a badge. Citrus measures 1.3:1 as a fill and cannot
    // exist as a standalone shape, only as a filled chip with ink on it.
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.token,
  },
  pillLow: {
    backgroundColor: t.color.bg.accentTint,
  },
  label: {
    ...TOKENS.typography.numeralMedium,
    color: t.color.text.token,
  },
  labelLow: {
    color: t.color.text.accent,
  },
});
