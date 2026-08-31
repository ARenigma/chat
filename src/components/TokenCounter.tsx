import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatTokens, walletTone, type WalletTone } from '../lib/rates';
import { springTo } from '../theme/motion';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  /** The token balance. Null while loading. */
  balance: number | null;
  onPress: () => void;
}

/**
 * The balance, visible at all times.
 *
 * Tone is talk-time, not a raw token count (2026-08-29): deep green when an hour
 * or more remains at the chat rate, red under ten minutes, lime yellow otherwise.
 * The flinch still fires only on the transition into critical so navigation
 * remounts do not twitch the pill.
 */
function TokenCounterView({ balance, onPress }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const tone = walletTone(balance);
  const critical = tone === 'critical';
  const flinch = useSharedValue(0);
  const wasCritical = useRef(critical);

  useEffect(() => {
    if (critical && !wasCritical.current) {
      flinch.value = withSequence(springTo(1, 'bounce'), springTo(0, 'snap'));
    }
    wasCritical.current = critical;
  }, [critical, flinch]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + flinch.value * 0.09 }],
  }));

  const ink = inkForTone(tone, theme);

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
      accessibilityHint={critical ? 'Opens Recharge' : 'Opens Recharge and explains rates'}>
      <Animated.View style={[styles.pill, pillStyle(tone, theme), animated]}>
        <Icon name="wallet" active size={15} color={ink} />
        <Text
          testID="token-count"
          allowFontScaling
          style={[styles.label, { color: ink }]}>
          {balance === null ? '' : formatTokens(balance)}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function inkForTone(tone: WalletTone, theme: Theme): string {
  if (tone === 'ok') {
    return theme.color.text.token;
  }
  return theme.color.text.onTokenStrong;
}

function pillStyle(tone: WalletTone, theme: Theme) {
  if (tone === 'healthy') {
    return { backgroundColor: theme.color.bg.tokenHealthy };
  }
  if (tone === 'critical') {
    return { backgroundColor: theme.color.bg.tokenCritical };
  }
  return { backgroundColor: theme.color.bg.token };
}

export const TokenCounter = memo(TokenCounterView);

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 5,
      // radius.xs, not a capsule: a filled pill in a header band is a Material chip.
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
    },
    label: {
      ...TOKENS.typography.numeralMedium,
    },
  });
