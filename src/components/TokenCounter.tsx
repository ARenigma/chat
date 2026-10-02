import React, { memo, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, walletTone, type WalletTone } from '../lib/rates';
import { springTo } from '../theme/motion';
import { Icon } from './Icon';
import { RupeeAmount } from './RupeeAmount';
import { Pressable, PressLayer } from './Pressable';

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
 * or more remains at the chat rate, red under ten minutes, and NEUTRAL between
 * (Amit, 2026-09-26): the page colour, a 1dp border/strong outline and primary
 * ink. The lime fill it replaced was a third wallet hue that meant nothing the
 * number did not already say; only the two ends are states worth a colour.
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
      /* The 30dp pill is what shows; the target is the 48dp row it sits in,
         the same box the search button beside it has. A hitSlop would widen
         the touch but not the accessibility node, which TalkBack measures
         (B7, S22 audit 2026-09-29). */
      style={styles.target}
      // The light belongs on the pill, not on the 48dp row around it.
      layer="child"
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
        <PressLayer />
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
    return theme.color.text.primary;
  }
  return theme.color.text.onTokenStrong;
}

/*
 * Every tone draws the same 1dp border (see `pill`); only its colour changes.
 * The filled tones paint it in their own fill so it disappears into them, which
 * keeps the box the same size in all three states: a stroke that existed only
 * on the neutral pill would shift the figure by a dp each time the balance
 * crossed a threshold, and in a header that re-renders on every charge.
 */
function pillStyle(tone: WalletTone, theme: Theme) {
  if (tone === 'healthy') {
    return {
      backgroundColor: theme.color.bg.tokenHealthy,
      borderColor: theme.color.bg.tokenHealthy,
    };
  }
  if (tone === 'critical') {
    return {
      backgroundColor: theme.color.bg.tokenCritical,
      borderColor: theme.color.bg.tokenCritical,
    };
  }
  return {
    backgroundColor: theme.color.bg.base,
    borderColor: theme.color.border.strong,
  };
}

export const TokenCounter = memo(TokenCounterView);

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    target: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      // 4 + the 1dp border = the 5dp this pill always had, so the neutral
      // outline did not make the header band taller.
      paddingVertical: TOKENS.space['2xs'],
      borderWidth: 1,
      // radius.xs, not a capsule: a filled pill in a header band is a Material chip.
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
      // Clips the press layer to the pill.
      overflow: 'hidden',
    },
    label: {
      ...TOKENS.typography.numeralMedium,
    },
  });
