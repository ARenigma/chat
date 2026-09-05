import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  DEFAULT_RATES,
  formatRupees,
  formatTokens,
  gstIncludedLabel,
  gstPercentLabel,
  PAYMENTS_ENABLED,
  RECHARGE_PACKS,
  talkMinutesLeft,
} from '../lib/rates';
import {
  useRechargeConfig,
  useKillSwitches,
  useEconomicsConfig,
  FALLBACK_RECHARGE,
  FALLBACK_ECONOMICS,
} from '../api/appConfig';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { screenOut, setNavDirection, useScreenEnter } from '../theme/motion';
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
  const { data: economics } = useEconomicsConfig();
  const livePacks = rechargeConfig.packs_inr.length > 0 ? rechargeConfig.packs_inr : RECHARGE_PACKS;
  return {
    livePacks,
    paymentsEnabled: killSwitches?.payments_enabled ?? PAYMENTS_ENABLED,
    // Admin-set (ADR-0021). 0 for a seller without a GSTIN, and every GST line
    // on this screen goes with it — see `gstIncludedLabel`.
    gstRateBps: economics?.gst_rate_bps ?? FALLBACK_ECONOMICS.gst_rate_bps,
  };
}

export function RechargeScreen() {
  const visible = useStore(s => s.refillVisible);
  const close = useStore(s => s.closeRefill);
  const { livePacks, gstRateBps } = useRechargePacks();
  const [amount, setAmount] = useState<number>(livePacks[1] ?? 300);
  const [payOpen, setPayOpen] = useState(false);

  return (
    <>
      <Sheet
        visible={visible}
        testID="refill-sheet"
        title="Recharge"
        body="Add tokens to keep talking."
        // The 72% `auto` cap was already too low for this content on a 774dp
        // window (Redmi Note 7 Pro): the body shrank and the rate row painted
        // INSIDE the bottom pair of cards — unnoticed while the cards' lower
        // third was empty, obvious once the GST line filled it. `large` lifts
        // the cap to 90%; the sheet still wraps its content, so on a tall phone
        // nothing changes and on a short one it has the room it needs.
        detents="large"
        onClose={close}
        footer={
          <RechargeSheetFooter
            amount={amount}
            gstRateBps={gstRateBps}
            onPay={() => requestAnimationFrame(() => setPayOpen(true))}
          />
        }>
        <RechargeSheetForm
          amount={amount}
          setAmount={setAmount}
          livePacks={livePacks}
          gstRateBps={gstRateBps}
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
  gstRateBps,
}: {
  amount: number;
  setAmount: (n: number) => void;
  livePacks: readonly number[];
  gstRateBps: number;
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
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={styles.balanceValue}>
          {`${formatTokens(balance)} tokens`}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.section}>
        Choose a pack
      </Text>
      <View style={styles.grid}>
        {livePacks.slice(0, 4).map(pack => {
          const selected = pack === amount;
          const popular = pack === popularAmount;
          const gst = gstIncludedLabel(pack, gstRateBps);
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
                accessibilityLabel={`${formatRupees(pack)}, ${formatTokens(pack)} tokens${gst ? `, ${gst}` : ''}${popular ? ', popular' : ''}`}
                press="card"
                style={[styles.card, selected && styles.cardSelected]}>
                {popular ? (
                  <View style={styles.popular}>
                    <Text allowFontScaling={false} style={styles.popularText}>
                      Popular
                    </Text>
                  </View>
                ) : null}
                <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={styles.amount}>
                  {formatRupees(pack)}
                </Text>
                <Text allowFontScaling style={styles.tokens}>
                  {`${formatTokens(pack)} tokens`}
                </Text>
                {gst ? (
                  <Text allowFontScaling numberOfLines={1} style={styles.tokensGst}>
                    {gst}
                  </Text>
                ) : null}
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
  gstRateBps,
  onPay,
}: {
  amount: number;
  gstRateBps: number;
  onPay: () => void;
}) {
  const styles = useStyles(makeCompactStyles);
  const theme = useTheme();
  const gst = gstIncludedLabel(amount, gstRateBps);
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
          {/* The pay button under this row names the total, so the row names
              the tax inside it — the same figure the invoice will print. */}
          {gst ? `1 token = ₹1 · ${gst} (${gstPercentLabel(gstRateBps)})` : '1 token = ₹1'}
        </Text>
      </View>
      <Pressable
        onPress={onPay}
        testID="recharge-pay"
        accessibilityLabel={`Pay ${formatRupees(amount)}`}
        press="button"
        onColor={theme.color.text.onAccent}
        style={styles.payButton}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.payButtonLabel}>
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
  const { livePacks, gstRateBps } = useRechargePacks();
  const [amount, setAmount] = useState<number>(livePacks[1] ?? 300);
  const [payOpen, setPayOpen] = useState(false);

  // A pushed page: it always enters from the right (a forward push) and its back
  // leaves to the right, so it uses the shared screen builders. The direction is
  // set on the not-visible → visible transition, in render and thus before the
  // mount commits and `screenIn` reads it, so a preceding pop cannot leave the
  // page entering from the wrong side. The ref keeps it to that one transition.
  const wasVisible = useRef(false);
  if (visible && !wasVisible.current) {
    setNavDirection('forward');
  }
  wasVisible.current = visible;

  if (!visible) return null;

  const closeBack = () => {
    setNavDirection('back');
    close();
  };

  return (
    <WalletLayer style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={closeBack} testID="recharge-wallet-back" style={styles.barIcon} />
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.barTitle}>
          Recharge
        </Text>
      </View>
      {/* A ScrollView, not the plain View it used to be. "The balance card, the
          grid and the note fit a single screen" was only true of one screen
          height: on a 774dp window (Redmi Note 7 Pro) the note already slid
          under the Pay bar, and the GST line on each card made it obvious. A
          pinned footer over a body that cannot scroll is an overlap waiting for
          a shorter phone; here the body scrolls and the Pay bar stays put. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        {...SCROLL_PHYSICS}>
        <RechargeForm
          amount={amount}
          setAmount={setAmount}
          livePacks={livePacks}
          gstRateBps={gstRateBps}
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
    </WalletLayer>
  );
}

/** The wallet page's pushed layer: effect-driven entrance, layout-animation exit (motion.ts). */
function WalletLayer({ style, children }: { style: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const enter = useScreenEnter();
  return (
    <Animated.View
      testID="recharge-wallet"
      style={[style, enter.style]}
      onLayout={enter.onLayout}
      exiting={screenOut}>
      {children}
    </Animated.View>
  );
}

function RechargeForm({
  amount,
  setAmount,
  livePacks,
  gstRateBps,
}: {
  amount: number;
  setAmount: (n: number) => void;
  livePacks: readonly number[];
  gstRateBps: number;
}) {
  const styles = useStyles(makeStyles);
  const balance = useStore(s => s.balance);
  const chatRate = DEFAULT_RATES.chat;
  const balanceMinutes = Math.floor(talkMinutesLeft(balance, chatRate));
  const popularAmount = livePacks[1] ?? null;
  const bestValueAmount = livePacks[livePacks.length - 1] ?? null;
  const selectedGst = gstIncludedLabel(amount, gstRateBps);

  return (
    <View style={styles.form}>
      <View style={styles.balanceCard}>
        <Text allowFontScaling style={styles.balanceLabel}>
          Balance
        </Text>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={styles.balanceValue}>
          {`${formatTokens(balance)} tokens`}
        </Text>
        <Text allowFontScaling style={styles.balanceHint}>
          {balance === null || balance === 0
            ? 'Add tokens to start talking.'
            : `≈ ${balanceMinutes} min of talk time`}
        </Text>
      </View>

      <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.section}>
        Add tokens
      </Text>

      <View style={styles.grid}>
        {livePacks.map(pack => {
          const on = pack === amount;
          const badge =
            pack === popularAmount ? 'Popular' : pack === bestValueAmount ? 'Best value' : null;
          const minutes = Math.floor(pack / chatRate);
          const gst = gstIncludedLabel(pack, gstRateBps);
          return (
            <View key={pack} style={styles.cardSlot}>
              <Pressable
                onPress={() => {
                  tick();
                  setAmount(pack);
                }}
                testID={`pack-${pack}`}
                accessibilityLabel={`Add ${formatTokens(pack)} tokens, ${formatRupees(pack)}${gst ? ` ${gst}` : ''}, about ${minutes} minutes of talk${badge ? `, ${badge}` : ''}${on ? ', selected' : ''}`}
                press="card"
                style={[styles.card, on && styles.cardOn]}>
                {/* Corner ribbon — flush to the top-right corner (folded-tab
                    look), not a floating chip. The card's paddingTop reserves the
                    strip it sits in, so it never overlaps the amount below. */}
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
                    <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
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
                {/* The tax inside this price, on the card itself (Amit,
                    2026-09-05: "GST on recharge chips"). The rupee total is the
                    token count — 1 token = ₹1 — so the card names only the part
                    of it that is not a token. Full card width, last: beside the
                    coin the text column is ~70dp and "incl. ₹762.71 GST" was
                    ellipsised on every card; and it is a disclosure, so it
                    reads after the offer (amount → unit → talk time → tax). */}
                {gst ? (
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[styles.cardGst, on && styles.cardUnitOn]}>
                    {gst}
                  </Text>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* No payment-method options here: the Cashfree checkout sheet that opens
          on Pay is where UPI / cards / net-banking are chosen. Listing them here
          too was a duplicate the page had to scroll to fit. */}
      <Text allowFontScaling style={styles.rupeeNote}>
        {selectedGst
          ? `1 token = ₹1. Price ${selectedGst} (${gstPercentLabel(gstRateBps)}). You are charged in rupees at checkout.`
          : '1 token = ₹1. You are charged in rupees at checkout.'}
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
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: TOKENS.space.xl,
      paddingTop: TOKENS.space.sm,
      // Room under the rupee note so its last line never kisses the Pay bar's
      // hairline when the content is exactly one screen tall.
      paddingBottom: TOKENS.space.lg,
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
      gap: TOKENS.space.hair,
    },
    balanceLabel: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.onInverse,
      opacity: 0.7,
    },
    balanceValue: {
      fontFamily: 'Geist-Bold',
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
      color: t.color.text.onInverse,
    },
    balanceHint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.onInverse,
      opacity: 0.55,
    },
    section: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.md,
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
      // Extra top padding reserves the strip the corner ribbon sits in, so the
      // amount below never collides with it.
      paddingTop: TOKENS.space.lg,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.md,
      justifyContent: 'space-between',
      gap: TOKENS.space.sm,
      overflow: 'hidden',
    },
    cardOn: {
      backgroundColor: t.color.bg.accent,
      borderColor: t.color.bg.accent,
    },
    // Corner ribbon flush to the top-right corner (folded-tab look): the outer
    // corner matches the card radius, the inner corner is rounded. Not a chip.
    ribbon: {
      position: 'absolute',
      top: 0,
      right: 0,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 3,
      borderTopRightRadius: TOKENS.radius.md,
      borderBottomLeftRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accent,
    },
    ribbonOn: {
      backgroundColor: t.color.bg.base,
    },
    ribbonText: {
      ...TOKENS.typography.bodySmall,
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
      ...TOKENS.typography.titleLargeEmphasized,
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
      // Tabular figures + tight tracking, the app's numeral treatment: without
      // tabular-nums the pack amounts (1,000 / 2,500) render with uneven widths
      // and read as ragged. Matches TOKENS.typography.numeral*.
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
      color: t.color.text.primary,
    },
    cardUnit: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    cardUnitOn: {
      color: t.color.text.onAccent,
    },
    // One step quieter than the unit line: the tax is a disclosure, not the
    // offer. Shares `cardUnitOn` when the card is selected so it stays legible
    // on the accent fill.
    cardGst: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      // The card's own `gap` already separates this from the talk-time tag; a
      // negative nudge pulls it back to the tag's rhythm rather than a full step.
      marginTop: -TOKENS.space['2xs'],
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
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.accent,
    },
    minutesTextOn: {
      color: t.color.text.onAccent,
    },
    rupeeNote: {
      ...TOKENS.typography.bodySmall,
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
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.onAccent,
    },
    balanceLabel: {
      flex: 1,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    balanceValue: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.primary,
    },
    section: {
      ...TOKENS.typography.bodyLarge,
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
      ...TOKENS.typography.bodySmall,
      color: t.color.text.accent,
    },
    amount: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.primary,
    },
    tokens: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.xs,
    },
    tokensGst: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      paddingTop: TOKENS.space['2xs'],
    },
    rate: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    rateText: {
      ...TOKENS.typography.bodySmall,
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
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.onAccent,
    },
  });
