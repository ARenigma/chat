import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, walletTone, type WalletTone } from '../lib/rates';
import { springTo } from '../theme/motion';
import { Icon } from './Icon';
import { RupeeAmount } from './RupeeAmount';
import { Pressable } from './Pressable';

interface Props {
  /** The token balance (members) or earnings total (providers). Null while loading. */
  balance: number | null;
  onPress: () => void;
  /**
   * Members buy talk time; providers are paid for it. Same pill, different number
   * and destination — recharge vs earnings ledger. Default keeps every existing
   * call site on the member path.
   */
  variant?: 'balance' | 'earnings';
}

/**
 * The balance, visible at all times.
 *
 * Tone is talk-time, not a raw token count (2026-08-29): deep green when an hour
 * or more remains at the chat rate, red under ten minutes, lime yellow otherwise.
 * The flinch still fires only on the transition into critical so navigation
 * remounts do not twitch the pill. Earnings never flinch: a zero payout is not
 * an urgent wallet state.
 */
function TokenCounterView({ balance, onPress, variant = 'balance' }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const earnings = variant === 'earnings';
  const tone = earnings ? 'healthy' : walletTone(balance);
  const critical = !earnings && tone === 'critical';
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
  /*
   * `formatRupees` ALREADY PREPENDS ITS OWN "₹" — this was rendering "₹₹5,278"
   * on the earnings variant, a double glyph nobody would have caught by
   * reading the string in code, only by looking at the pill. Found while
   * auditing every price display for the ₹ glyph sweep (Amit, 2026-09-08).
   * The two variants render the identical figure; there was never a reason for
   * one to differ.
   */

  return (
    <Pressable
      onPress={onPress}
      testID="token-badge"
      press="chip"
      accessibilityLabel={
        balance === null
          ? earnings
            ? 'Earnings loading'
            : 'Balance loading'
          : earnings
            ? `${formatRupees(balance)} rupees earned. Opens your earnings by session.`
            : `${formatRupees(balance)}. Talk time is charged by the minute.`
      }
      accessibilityHint={
        earnings
          ? 'Opens earnings by session'
          : critical
            ? 'Opens Recharge'
            : 'Opens Recharge and explains rates'
      }>
      <Animated.View style={[styles.pill, pillStyle(tone, theme), animated]}>
        <Icon name="wallet" active size={TOKENS.icon.xs} color={ink} />
        {balance === null ? null : (
          <RupeeAmount
            value={balance}
            testID="token-count"
            allowFontScaling
            style={[styles.label, { color: ink }]}
          />
        )}
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
