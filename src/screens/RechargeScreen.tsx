import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import {
  DEFAULT_RATES,
  formatRupees,
  formatTokens,
  PAYMENTS_ENABLED,
  RECHARGE_PACKS,
  talkMinutesLeft,
} from '../lib/rates';
import { CASHFREE_SANDBOX_CHECKOUT } from '../config';
import { useRechargeConfig, useKillSwitches, FALLBACK_RECHARGE } from '../api/appConfig';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
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
  const { livePacks, paymentsEnabled } = useRechargePacks();
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
          <Button
            label={`Pay ${formatRupees(amount)}`}
            onPress={() => requestAnimationFrame(() => setPayOpen(true))}
            testID="recharge-pay"
          />
        }>
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          nestedScrollEnabled
          contentContainerStyle={{ paddingBottom: TOKENS.space.sm }}>
          <RechargeForm
            amount={amount}
            setAmount={setAmount}
            livePacks={livePacks}
            paymentsEnabled={paymentsEnabled}
          />
        </ScrollView>
      </Sheet>
      <PaymentSheet visible={payOpen} amount={amount} onClose={() => setPayOpen(false)} />
    </>
  );
}

/** Full-page Recharge — wallet pill only. Same packs as the sheet. */
export function RechargeWalletPage() {
  const styles = useStyles(makePageStyles);
  const insets = useSafeAreaInsets();
  const visible = useStore(s => s.walletVisible);
  const close = useStore(s => s.closeWallet);
  const { livePacks, paymentsEnabled } = useRechargePacks();
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
      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 72 },
        ]}>
        <RechargeForm
          amount={amount}
          setAmount={setAmount}
          livePacks={livePacks}
          paymentsEnabled={paymentsEnabled}
        />
      </ScrollView>
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
  paymentsEnabled,
}: {
  amount: number;
  setAmount: (n: number) => void;
  livePacks: readonly number[];
  paymentsEnabled: boolean;
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
                <View style={styles.badgeSlot}>
                  {badge ? (
                    <View style={[styles.badge, on && styles.badgeOn]}>
                      <Text
                        allowFontScaling
                        style={[styles.badgeText, on && styles.badgeTextOn]}>
                        {badge}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  allowFontScaling
                  style={[styles.cardAmount, on && styles.cardAmountOn, on && styles.cardTextOn]}>
                  {formatTokens(pack)}
                </Text>
                <Text allowFontScaling style={[styles.cardMinutes, on && styles.cardTextOn]}>
                  {`≈ ${minutes} min talk`}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Text allowFontScaling style={styles.sectionTight}>
        Pay with
      </Text>
      <View style={styles.payment}>
        <Image
          source={require('../../assets/brands/upi.png')}
          style={styles.payIconImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <View style={styles.payText}>
          <Text allowFontScaling style={styles.payName}>
            UPI
          </Text>
          <Text allowFontScaling style={styles.paySub}>
            {CASHFREE_SANDBOX_CHECKOUT
              ? 'GPay · PhonePe · Paytm · Sandbox'
              : paymentsEnabled
                ? 'GPay · PhonePe · Paytm & more'
                : 'Opening soon'}
          </Text>
        </View>
        <View style={styles.oneTap}>
          <Text allowFontScaling style={styles.oneTapText}>
            One tap
          </Text>
        </View>
      </View>
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
    sectionTight: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.lg,
      paddingBottom: TOKENS.space.xs,
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
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.hairline,
      paddingVertical: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.md,
      gap: 2,
    },
    cardOn: {
      backgroundColor: t.color.bg.accent,
      borderColor: t.color.bg.accent,
    },
    badgeSlot: {
      height: 18,
      justifyContent: 'center',
      alignItems: 'flex-end',
      marginBottom: 2,
    },
    badge: {
      alignSelf: 'flex-end',
      backgroundColor: t.color.bg.accent,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeOn: {
      backgroundColor: t.color.bg.base,
    },
    badgeText: {
      ...TOKENS.typography.captionSmall,
      fontFamily: 'Geist-SemiBold',
      color: t.color.text.onAccent,
    },
    badgeTextOn: {
      color: t.color.text.accent,
    },
    cardAmount: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.primary,
    },
    cardAmountOn: {
      fontFamily: 'Geist-Bold',
      fontSize: 26,
      lineHeight: 32,
    },
    cardMinutes: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.accent,
    },
    cardTextOn: {
      color: t.color.text.onAccent,
    },
    payment: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      padding: TOKENS.space.md,
    },
    payIconImage: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    payText: {
      flex: 1,
    },
    payName: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    paySub: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.secondary,
    },
    oneTap: {
      backgroundColor: t.color.bg.accentTint,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    oneTapText: {
      ...TOKENS.typography.captionSmall,
      fontFamily: 'Geist-SemiBold',
      color: t.color.text.accent,
    },
    rupeeNote: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
      paddingTop: TOKENS.space.xs,
    },
  });
