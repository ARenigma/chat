import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  DEFAULT_RATES,
  formatRupees,
  formatTokens,
  PAYMENTS_ENABLED,
  RECHARGE_PACKS,
  talkMinutesLeft,
} from '../lib/rates';
import { useRechargeConfig, useKillSwitches, FALLBACK_RECHARGE } from '../api/appConfig';
import { tick } from '../lib/haptics';
import { SPRING } from '../theme/motion';
import { useStore } from '../store/useStore';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { PaymentSheet } from './PaymentSheet';

/**
 * Recharge packs — v10 layout, two hosts:
 *
 *   - Wallet pill → full page (`RechargeWalletPage`).
 *   - Chat/home paywall, talk-bar, first send → M3 Paper sheet (`RechargeScreen`).
 */
function useRechargePacks() {
  const { data: rechargeConfig = FALLBACK_RECHARGE } = useRechargeConfig();
  const { data: killSwitches } = useKillSwitches();
  const livePacks = rechargeConfig.packs_inr.length > 0 ? rechargeConfig.packs_inr : RECHARGE_PACKS;
  return {
    livePacks,
    paymentsEnabled: killSwitches?.payments_enabled ?? PAYMENTS_ENABLED,
  };
}

export function RechargeScreen() {
  const visible = useStore(s => s.refillVisible);
  const close = useStore(s => s.closeRefill);
  const { livePacks } = useRechargePacks();
  const [amount, setAmount] = useState<number>(livePacks[1] ?? 300);
  const [payOpen, setPayOpen] = useState(false);

  return (
    <>
      <Sheet
        visible={visible}
        testID="refill-sheet"
        title="Recharge"
        body="Add tokens to keep talking."
        onClose={close}
        footer={
          <RechargeSheetFooter
            amount={amount}
            onPay={() => requestAnimationFrame(() => setPayOpen(true))}
          />
        }>
        <RechargeSheetForm
          amount={amount}
          setAmount={setAmount}
          livePacks={livePacks}
        />
      </Sheet>
      <PaymentSheet visible={payOpen} amount={amount} onClose={() => setPayOpen(false)} />
    </>
  );
}

/**
 * Compact paywall sheet from the approved M3 Paper reference.
 *
 * The wallet page keeps the richer minutes/payment explanation below; the
 * interrupting sheet has one job and must fit at its resting detent without an
 * inner scroll view: current balance, four choices, exchange rate, pay.
 */
function RechargeSheetForm({
  amount,
  setAmount,
  livePacks,
}: {
  amount: number;
  setAmount: (n: number) => void;
  livePacks: readonly number[];
}) {
  const styles = useStyles(makeCompactStyles);
  const balance = useStore(s => s.balance);
  const popularAmount = livePacks[1] ?? null;

  return (
    <View style={styles.form}>
      <View style={styles.balance}>
        <View style={styles.balanceMark}>
          <Text allowFontScaling={false} style={styles.balanceMarkText}>
            ₹
          </Text>
        </View>
        <Text allowFontScaling style={styles.balanceLabel}>
          Your balance
        </Text>
        <Text allowFontScaling style={styles.balanceValue}>
          {`${formatTokens(balance)} tokens`}
        </Text>
      </View>

      <Text allowFontScaling style={styles.section}>
        Choose a pack
      </Text>
      <View style={styles.grid}>
        {livePacks.slice(0, 4).map(pack => {
          const selected = pack === amount;
          const popular = pack === popularAmount;
          return (
            <View key={pack} style={styles.cardSlot}>
              <Pressable
                onPress={() => {
                  tick();
                  setAmount(pack);
                }}
                testID={`pack-${pack}`}
                accessibilityRole="radio"
                checked={selected}
                accessibilityLabel={`${formatRupees(pack)}, ${formatTokens(pack)} tokens${popular ? ', popular' : ''}`}
                press="card"
                style={[styles.card, selected && styles.cardSelected]}>
                {popular ? (
                  <View style={styles.popular}>
                    <Text allowFontScaling={false} style={styles.popularText}>
                      Popular
                    </Text>
                  </View>
                ) : null}
                <Text allowFontScaling style={styles.amount}>
                  {formatRupees(pack)}
                </Text>
                <Text allowFontScaling style={styles.tokens}>
                  {`${formatTokens(pack)} tokens`}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RechargeSheetFooter({
  amount,
  onPay,
}: {
  amount: number;
  onPay: () => void;
}) {
  const styles = useStyles(makeCompactStyles);
  const theme = useTheme();
  return (
    <>
      <View style={styles.rate}>
        <Text
          allowFontScaling={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.rateIcon, { color: theme.color.text.tertiary }]}>
          ⓘ
        </Text>
        <Text allowFontScaling style={styles.rateText}>
          1 token = ₹1
        </Text>
      </View>
      <Pressable
        onPress={onPay}
        testID="recharge-pay"
        accessibilityLabel={`Pay ${formatRupees(amount)}`}
        press="button"
        onColor={theme.color.text.onAccent}
        style={styles.payButton}>
        <Text allowFontScaling style={styles.payButtonLabel}>
          {`Pay ${formatRupees(amount)}`}
        </Text>
      </Pressable>
    </>
  );
}

/** Full-page Recharge — wallet pill only. Same packs as the sheet. */
export function RechargeWalletPage() {
  const styles = useStyles(makePageStyles);
  const insets = useSafeAreaInsets();
  const visible = useStore(s => s.walletVisible);
  const close = useStore(s => s.closeWallet);
  const { livePacks } = useRechargePacks();
  const [amount, setAmount] = useState<number>(livePacks[1] ?? 300);
  const [payOpen, setPayOpen] = useState(false);

  if (!visible) return null;

  return (
    <Animated.View
      testID="recharge-wallet"
      entering={SlideInRight.springify()
        .damping(SPRING.gentle.damping)
        .stiffness(SPRING.gentle.stiffness)
        .mass(SPRING.gentle.mass)}
      exiting={SlideOutRight.springify()
        .damping(SPRING.smooth.damping)
        .stiffness(SPRING.smooth.stiffness)
        .mass(SPRING.smooth.mass)}
      style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={close} testID="recharge-wallet-back" style={styles.barIcon} />
        <Text allowFontScaling style={styles.barTitle}>
          Recharge
        </Text>
      </View>
      {/* Non-scrollable: with the payment-method block gone, the balance card,
          the pack grid and the note fit a single screen, so this is a plain
          View. The Pay bar stays pinned below. */}
      <View style={styles.scroll}>
        <RechargeForm amount={amount} setAmount={setAmount} livePacks={livePacks} />
      </View>
      <View style={[styles.payBar, { paddingBottom: Math.max(insets.bottom, TOKENS.space.md) }]}>
        <Button
          label={`Pay ${formatRupees(amount)}`}
          onPress={() => requestAnimationFrame(() => setPayOpen(true))}
          testID="recharge-wallet-pay"
        />
      </View>
      <PaymentSheet visible={payOpen} amount={amount} onClose={() => setPayOpen(false)} />
    </Animated.View>
  );
}

function RechargeForm({
  amount,
  setAmount,
  livePacks,
}: {
  amount: number;
  setAmount: (n: number) => void;
  livePacks: readonly number[];
}) {
  const styles = useStyles(makeStyles);
  const balance = useStore(s => s.balance);
  const chatRate = DEFAULT_RATES.chat;
  const balanceMinutes = Math.floor(talkMinutesLeft(balance, chatRate));
  const popularAmount = livePacks[1] ?? null;
  const bestValueAmount = livePacks[livePacks.length - 1] ?? null;

  return (
    <View style={styles.form}>
      <View style={styles.balanceCard}>
        <Text allowFontScaling style={styles.balanceLabel}>
          Balance
        </Text>
        <Text allowFontScaling style={styles.balanceValue}>
          {`${formatTokens(balance)} tokens`}
        </Text>
        <Text allowFontScaling style={styles.balanceHint}>
          {balance === null || balance === 0
            ? 'Add tokens to start talking.'
            : `≈ ${balanceMinutes} min of talk time`}
        </Text>
      </View>

      <Text allowFontScaling style={styles.section}>
        Add tokens
      </Text>
      <Text allowFontScaling style={styles.sectionHint}>
        Pick an amount
      </Text>

      <View style={styles.grid}>
        {livePacks.map(pack => {
          const on = pack === amount;
          const badge =
            pack === popularAmount ? 'Popular' : pack === bestValueAmount ? 'Best value' : null;
          const minutes = Math.floor(pack / chatRate);
          return (
            <View key={pack} style={styles.cardSlot}>
              <Pressable
                onPress={() => {
                  tick();
                  setAmount(pack);
                }}
                testID={`pack-${pack}`}
                accessibilityLabel={`Add ${formatTokens(pack)} tokens, about ${minutes} minutes of talk${badge ? `, ${badge}` : ''}${on ? ', selected' : ''}`}
                press="card"
                style={[styles.card, on && styles.cardOn]}>
                {badge ? (
                  <View style={[styles.ribbon, on && styles.ribbonOn]}>
                    <Text
                      allowFontScaling={false}
                      style={[styles.ribbonText, on && styles.ribbonTextOn]}>
                      {badge}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.cardRow}>
                  {/* Coin chip — the gamified token mark, same ₹ disc as the
                      balance header. Flips to a light disc on the selected coral
                      card so it stays legible. */}
                  <View style={[styles.coin, on && styles.coinOn]}>
                    <Text
                      allowFontScaling={false}
                      style={[styles.coinMark, on && styles.coinMarkOn]}>
                      ₹
                    </Text>
                  </View>
                  <View style={styles.cardText}>
                    <Text
                      allowFontScaling
                      numberOfLines={1}
                      style={[styles.cardAmount, on && styles.cardTextOn]}>
                      {formatTokens(pack)}
                    </Text>
                    <Text
                      allowFontScaling
                      numberOfLines={1}
                      style={[styles.cardUnit, on && styles.cardUnitOn]}>
                      tokens
                    </Text>
                  </View>
                </View>
                <View style={[styles.minutesTag, on && styles.minutesTagOn]}>
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[styles.minutesText, on && styles.minutesTextOn]}>
                    {`≈ ${minutes} min talk`}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* No payment-method options here: the Cashfree checkout sheet that opens
          on Pay is where UPI / cards / net-banking are chosen. Listing them here
          too was a duplicate the page had to scroll to fit. */}
      <Text allowFontScaling style={styles.rupeeNote}>
        1 token = ₹1. You are charged in rupees at checkout.
      </Text>
    </View>
  );
}

const makePageStyles = (t: Theme) =>
  StyleSheet.create({
    page: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.color.bg.base,
      zIndex: 20,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      minHeight: 52,
    },
    barIcon: {
      marginLeft: -TOKENS.space.xs,
    },
    barTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.xl,
      paddingTop: TOKENS.space.sm,
    },
    payBar: {
      paddingHorizontal: TOKENS.space.xl,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
      backgroundColor: t.color.bg.base,
    },
  });

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    form: {
      gap: TOKENS.space.sm,
    },
    balanceCard: {
      backgroundColor: t.color.bg.inverse,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      padding: TOKENS.space.lg,
      gap: 2,
    },
    balanceLabel: {
      ...TOKENS.typography.subhead,
      color: t.color.text.onInverse,
      opacity: 0.7,
    },
    balanceValue: {
      fontFamily: 'Geist-Bold',
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: 0.2,
      color: t.color.text.onInverse,
    },
    balanceHint: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.onInverse,
      opacity: 0.55,
    },
    section: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.md,
    },
    sectionHint: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
      paddingBottom: TOKENS.space.xs,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.sm,
    },
    cardSlot: {
      width: '48%',
    },
    card: {
      width: '100%',
      minHeight: 104,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
      padding: TOKENS.space.md,
      justifyContent: 'space-between',
      gap: TOKENS.space.sm,
      overflow: 'hidden',
    },
    cardOn: {
      backgroundColor: t.color.bg.accent,
      borderColor: t.color.bg.accent,
    },
    // Corner ribbon — Popular / Best value.
    ribbon: {
      position: 'absolute',
      top: 0,
      right: 0,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 3,
      borderBottomLeftRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accent,
    },
    ribbonOn: {
      backgroundColor: t.color.bg.base,
    },
    ribbonText: {
      ...TOKENS.typography.captionSmall,
      fontFamily: 'Geist-SemiBold',
      color: t.color.text.onAccent,
    },
    ribbonTextOn: {
      color: t.color.text.accent,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
    },
    // The gamified coin chip carrying the ₹ mark.
    coin: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentTint,
    },
    coinOn: {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    coinMark: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.accent,
    },
    coinMarkOn: {
      color: t.color.text.onAccent,
    },
    cardText: {
      flex: 1,
    },
    cardAmount: {
      fontFamily: 'Geist-Bold',
      fontSize: 24,
      lineHeight: 28,
      color: t.color.text.primary,
    },
    cardUnit: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.secondary,
    },
    cardUnitOn: {
      color: t.color.text.onAccent,
    },
    cardTextOn: {
      color: t.color.text.onAccent,
    },
    // Talk-time value tag along the bottom of the card.
    minutesTag: {
      alignSelf: 'flex-start',
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 3,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    minutesTagOn: {
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    minutesText: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.accent,
    },
    minutesTextOn: {
      color: t.color.text.onAccent,
    },
    rupeeNote: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
      paddingTop: TOKENS.space.xs,
    },
  });

const makeCompactStyles = (t: Theme) =>
  StyleSheet.create({
    form: {
      gap: TOKENS.space.sm,
    },
    balance: {
      minHeight: 70,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    balanceMark: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accent,
    },
    balanceMarkText: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.onAccent,
    },
    balanceLabel: {
      flex: 1,
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    balanceValue: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.primary,
    },
    section: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.xs,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.sm,
    },
    cardSlot: {
      width: '48%',
    },
    card: {
      width: '100%',
      minHeight: 104,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    cardSelected: {
      borderWidth: 2,
      borderColor: t.color.border.accent,
    },
    popular: {
      position: 'absolute',
      top: TOKENS.space.sm,
      right: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.xs,
      paddingVertical: 3,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentTint,
    },
    popularText: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.accent,
    },
    amount: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.primary,
    },
    tokens: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.xs,
    },
    rate: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    rateText: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.secondary,
    },
    rateIcon: {
      fontSize: 16,
      lineHeight: 18,
    },
    payButton: {
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
    },
    payButtonLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.onAccent,
    },
  });
