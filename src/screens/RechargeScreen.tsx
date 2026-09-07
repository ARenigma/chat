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
  gstAddedLabel,
  gstAddedSpoken,
  packTotalInr,
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
    // on this screen goes with it — see `gstExclusiveParts`.
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
  const theme = useTheme();
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
          const gst = gstAddedLabel(pack, gstRateBps);
          const gstSpoken = gstAddedSpoken(pack, gstRateBps);
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
                accessibilityLabel={`${formatRupees(pack)}, ${formatTokens(pack)} tokens${gstSpoken ? `, ${gstSpoken}` : ''}${popular ? ', popular' : ''}`}
                press="card"
                // The M3 pressed state layer is the container's ON colour at 10%
                // (androidx StateTokens.kt `PressedStateLayerOpacity = 0.1f`,
                // mirrored by TOKENS.interaction.statePressed). Pressable.tsx
                // falls back to `text.primary` — dark ink — which on the now
                // filled coral chip would flash DARKER on press instead of
                // lighter, reading as a different component.
                onColor={selected ? theme.color.text.onAccent : undefined}
                style={[styles.card, selected && styles.cardSelected]}>
                {popular ? (
                  <View style={[styles.popular, selected && styles.popularOn]}>
                    <Text allowFontScaling={false} style={styles.popularText}>
                      Popular
                    </Text>
                  </View>
                ) : null}
                <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={[styles.amount, selected && styles.amountOn]}>
                  {formatRupees(pack)}
                </Text>
                <Text allowFontScaling style={[styles.tokens, selected && styles.tokensOn]}>
                  {`${formatTokens(pack)} tokens`}
                </Text>
                {/* The SUPPORTING line under the price: what the ₹300 above is
                    made of. The price stays the headline — a store card that
                    shows only a base and a tax names a number nobody is charged
                    (₹254.24), which is what the wallet card next door did until
                    this pass. Two Texts, not one wrapped Text — see
                    gstExclusiveParts in src/lib/rates.ts for the width
                    arithmetic and the Android numberOfLines caveat that rules
                    the wrapped form out.

                    No `numberOfLines`: with the break already chosen by the
                    design (base on one Text, tax on the next) a wrap can only
                    happen INSIDE one of them, and there it breaks at the space
                    before "GST" rather than truncating the word. "+ ₹762.71
                    GST" is 87dp at bodySmall against 116dp of card on a 360dp
                    window, so it wraps only above ~1.3 font scale — and
                    developer.android.com/about/versions/14/features
                    #non-linear-font-scaling asks for testing to 200%, where
                    truncating a tax figure is worse than two lines. */}
                {gst ? (
                  <Text
                    allowFontScaling
                    style={[styles.tokensGst, selected && styles.tokensGstOn]}>
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

function RechargeSheetFooter({ amount, gstRateBps, onPay }: { amount: number; gstRateBps: number; onPay: () => void }) {
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
          {/* NO GST in this row, of any wording (Amit, 2026-09-06: "remove inc
              xxx gst from footer"). The tax moved onto the chips, where each
              pack names its own base and its own tax — so the footer is back to
              the two facts it is the only place for: what a token costs, and
              that the charge is in rupees.

              This is not a dropped disclosure. ADR-0021 ("Recharge pack pricing
              (GST-inclusive)") requires the tax to be derivable and INVOICED —
              "Axionix Technologies issues the GST invoice for Cashfree-path
              purchases" — and the screen still names the base and the tax on
              every chip and again on the pay step before money moves. What is
              gone is a second, weaker statement of the same fact in a footer,
              which is what was asked for. `gstRateBps` is no longer read here
              at all, so this row cannot drift from the chips. */}
          1 token = ₹1 · you are charged in rupees at checkout
        </Text>
      </View>
      <Pressable
        onPress={onPay}
        testID="recharge-pay"
        accessibilityLabel={`Pay ${formatRupees(packTotalInr(amount, gstRateBps))}`}
        press="button"
        onColor={theme.color.text.onAccent}
        style={styles.payButton}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.payButtonLabel}>
          {`Pay ${formatRupees(packTotalInr(amount, gstRateBps))}`}
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
          label={`Pay ${formatRupees(packTotalInr(amount, gstRateBps))}`}
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
  const theme = useTheme();
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
          const gst = gstAddedLabel(pack, gstRateBps);
          const gstSpoken = gstAddedSpoken(pack, gstRateBps);
          return (
            <View key={pack} style={styles.cardSlot}>
              <Pressable
                onPress={() => {
                  tick();
                  setAmount(pack);
                }}
                testID={`pack-${pack}`}
                // The label is the card read aloud, in the card's own order:
                // price, then tokens, then talk time, then the base and the tax.
                // It used to lead with "Add 5,000 tokens" and then speak a
                // ₹5,000 that was nowhere on the card, so TalkBack and a sighted
                // user were told different prices — the defect
                // developer.android.com/guide/topics/ui/accessibility/apps
                // rules out under "Describe each UI element" ("Use descriptions
                // to convey the purpose and result of the interaction, not the
                // visual details" — and never a figure the screen does not
                // show). Commas between the parts, so the price and its
                // composition do not run together as one long number.
                //
                // ", selected" is NOT in the label: state travels as
                // accessibilityState via `checked` below, which is what
                // Pressable.tsx documents and what the compact chip already
                // does. The same page tells you to expose the TYPE through the
                // role rather than the text, so this is `radio`, and TalkBack
                // says "radio button, checked" in the user's own language
                // instead of an English word baked into our string.
                accessibilityRole="radio"
                checked={on}
                accessibilityLabel={`${formatRupees(pack)}, ${formatTokens(pack)} tokens, about ${minutes} minutes of talk${gstSpoken ? `, ${gstSpoken}` : ''}${badge ? `, ${badge}` : ''}`}
                press="card"
                // Same M3 state-layer reason as the compact chip above:
                // StateTokens.kt `PressedStateLayerOpacity = 0.1f` over the
                // container's ON colour, not over Pressable's `text.primary`
                // default, which would darken the coral fill on press.
                onColor={on ? theme.color.text.onAccent : undefined}
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
                {/* THE PRICE, and the card's headline figure. It went missing:
                    this card's biggest number was a token count with no ₹ mark,
                    so once the tax split arrived the only rupee figures on it
                    were ₹4,237.29 and ₹762.71 — a base and a tax, neither of
                    which is what leaves the member's account. A store card
                    shows what it costs.

                    Same style, same order and now the same type role as the
                    compact chip in this file (price → tokens → base + tax), so
                    the two grids are one control read twice. */}
                <View style={styles.cardHead}>
                  <Text
                    maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
                    allowFontScaling
                    numberOfLines={1}
                    style={[styles.cardAmount, on && styles.cardAmountOn]}>
                    {formatRupees(pack)}
                  </Text>
                  <Text allowFontScaling style={[styles.cardUnit, on && styles.cardUnitOn]}>
                    {`${formatTokens(pack)} tokens`}
                  </Text>
                </View>
                {/* Talk-time pill: page colour + accent ink whether the card is
                    selected or not, so the label needs no `On` variant. */}
                <View style={[styles.minutesTag, on && styles.minutesTagOn]}>
                  <Text allowFontScaling numberOfLines={1} style={styles.minutesText}>
                    {`≈ ${minutes} min talk`}
                  </Text>
                </View>
                {/* What the price above is MADE of (Amit, 2026-09-06: "GST
                    exclusive on the chips") — the supporting line, never the
                    substitute. These two add back up to the ₹5,000 headline to
                    the paisa: 4,23,729 + 76,271 = 5,00,000 paise, the same
                    integer split generate-invoice prints.

                    Last, and full width: it is a disclosure, so it reads after
                    the offer (price → tokens → talk time → tax). No
                    `numberOfLines`, for the reason given on the compact chip. */}
                {gst ? (
                  <Text allowFontScaling style={[styles.cardGst, on && styles.cardUnitOn]}>
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
      {/* Two sentences, no tax, no rate branch (Amit, 2026-09-06: "remove inc
          xxx gst from footer"). The previous pass took the literal string out
          and put three sentences of GST copy back in its place, which grew the
          footer rather than clearing it.

          Nothing here has to carry the tax any more: every card names its own
          base and its own tax, the pay step names them again, and ADR-0021 puts
          the legal instrument on the invoice Axionix issues. The clause that
          WAS load-bearing — "the pack price, not the base, is what leaves your
          account" — is load-bearing no longer, because the pack price is now
          the largest figure on the card instead of being absent from it. */}
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
    // The selected card is a FILLED tonal container, and the fill is the deep
    // step, not the bright one.
    //
    // M3 puts the fill here: androidx FilterChipTokens.kt has
    // `FlatSelectedContainerColor = SecondaryContainer` with
    // `SelectedLabelTextColor = OnSecondaryContainer`, and
    // `FlatSelectedOutlineWidth = 0.0.dp` — the outline belongs to the
    // UNSELECTED chip, the container colour to the selected one.
    //
    // Which fill is not a preference. developer.android.com/guide/topics/ui/
    // accessibility/apps: "If the text is smaller than 18sp, or if the text is
    // bold and smaller than 14sp, use foreground and background colors that
    // result in a color contrast ratio of at least 4.5:1. For all other text,
    // set the color contrast ratio to at least 3:1." cardUnit and cardGst are
    // 12sp, so 4.5:1 is the floor here regardless of what the 22px bold price
    // above them would be allowed on its own. bg/accent measures 3.44:1 light
    // and 2.59:1 dark against text/onAccent and fails both — it fails 3:1 in
    // dark for the price too, and no ink in this palette rescues it (text/
    // primary on bg/accent is 4.95:1 light but 2.70:1 dark). design/tokens.json
    // says
    // so on the token itself ("must NEVER sit under small white text; that is
    // what bg/accentStrong is for") and theme.test.ts records it as a fact.
    // bg/accentStrong is 5.19:1 / 6.13:1 — the same fill the message bubble and
    // the Pay button already use.
    cardOn: {
      backgroundColor: t.color.bg.accentStrong,
      borderColor: t.color.bg.accentStrong,
    },
    // Corner ribbon flush to the top-right corner (folded-tab look): the outer
    // corner matches the card radius, the inner corner is rounded. Not a chip.
    //
    // Same fill as `cardOn` above, and for the same reason spelled out there:
    // `ribbonText` is 12dp on this ribbon, and the Android rule quoted above
    // puts anything under 18sp at 4.5:1. The card moved to bg/accentStrong in an
    // earlier pass and this ribbon was left on bg/accent (3.44:1 light / 2.59:1
    // dark), which is the same defect one view up — "Popular" / "Best value" is
    // the whole content of the ribbon, so if the word is not readable the ribbon
    // is doing nothing but tinting a corner.
    ribbon: {
      position: 'absolute',
      top: 0,
      right: 0,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 3,
      borderTopRightRadius: TOKENS.radius.md,
      borderBottomLeftRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
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
    // The price and what it buys are one statement, so the pair sits tighter
    // than the card's own 12dp `gap` would put them.
    cardHead: {
      gap: TOKENS.space.hair,
    },
    // The price. The ₹ coin disc that used to lead this row is gone, and the
    // reason is arithmetic rather than taste: on a 360dp window this card has
    // 115.8dp of inner width (312dp of content, halved at 48%, less a 1dp
    // border and 16dp of padding a side), a 40dp disc plus its 12dp gap left
    // 63.8dp for the text, and "₹5,000" needs 74.4dp. The price cannot share a
    // row with the disc on the narrowest phone we support without being
    // ellipsised — and it was the disc's ₹ glyph that was standing in for the
    // missing currency mark in the first place, so once the headline IS a rupee
    // figure the disc is a duplicate of it.
    //
    // titleLargeEmphasized (22px Geist-Bold) rather than the bespoke 24px this
    // slot carried while it held a token count: 24px puts "₹5,000" at 81.4dp,
    // and at the 1.5 title cap at 123.3dp against 115.8dp of card, i.e. the
    // PRICE would ellipsise on a large-text phone.
    // developer.android.com/about/versions/14/features#non-linear-font-scaling
    // ("you should still perform UI testing with the maximum font size enabled
    // (200%)") is the reason that is not acceptable. At 22px it is 74.4dp, and
    // 111.6dp at the cap — inside the card at every scale the cap allows. It is
    // also the role the compact chip's price already uses, so both grids state
    // a price the same way.
    //
    // Tabular figures + tight tracking, the app's numeral treatment: without
    // tabular-nums the prices (₹1,000 / ₹2,500) render with uneven widths and
    // read as ragged down a two-column grid. Matches TOKENS.typography.numeral*.
    cardAmount: {
      ...TOKENS.typography.titleLargeEmphasized,
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
      color: t.color.text.primary,
    },
    cardAmountOn: {
      color: t.color.text.onAccent,
    },
    // What the price buys, under it. One line ("5,000 tokens", 77.6dp of the
    // card's 115.8dp) rather than the number-over-noun pair the coin row held,
    // because the number is now the price above and repeating it at 24px made
    // two headline figures out of one fact.
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
    },
    // The nudge moved off the line and onto the block: two lines now, and a
    // negative margin on each would have closed the gap between them as well as
    // the gap above. The card's own `gap` already separates this from the
    // talk-time tag; this pulls it back to the tag's rhythm, not a full step.
    cardGstBlock: {
      marginTop: -TOKENS.space['2xs'],
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
    // Same inset-pill rule as `ribbonOn` and the compact chip's `popularOn`:
    // anything inset into a selected card takes the page colour and accent ink.
    // The old translucent white measured 2.81:1 light / 2.12:1 dark under a
    // 12sp label — the worst-failing pair on the screen, and this label is the
    // talk time, which is the offer. bg/base + text/accent is 8.17:1 / 7.54:1.
    minutesTagOn: {
      backgroundColor: t.color.bg.base,
    },
    minutesText: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.accent,
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
    // The ₹ disc, and the ₹ is TEXT, not an icon: `balanceMarkText` is
    // labelMediumEmphasized (12dp Bold) with `allowFontScaling={false}`, so the
    // 4.5:1 floor applies at a fixed 12dp — developer.android.com/guide/topics/
    // ui/accessibility/apps, "If the text is smaller than 18sp ... at least
    // 4.5:1". A glyph disc could have kept the bright coral at the 3:1 non-text
    // minimum in light; a glyph disc with a character in it cannot, and it
    // measured 3.44:1 light / 2.59:1 dark. bg/accentStrong is 5.19:1 / 6.13:1.
    balanceMark: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
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
      // Real vertical padding, not slack borrowed from `minHeight`.
      //
      // This chip had neither: 104dp of minHeight against 96dp of content left
      // 8dp of slack, centred, so the price line began 4dp below the border —
      // and the `popular` pill is absolutely positioned at top 12dp and is a
      // fixed 22dp tall (bodySmall's 16dp line plus 3dp a side, with
      // allowFontScaling={false}), i.e. it owns the band from 12dp to 34dp. The
      // price ran straight under it. At the 1.3 font scale this shows on any
      // pack: "₹300" grows from 57.6dp to 74.9dp and reaches the pill's left
      // edge at 74.9dp from the card's inner left.
      //
      // So the strip the pill sits in is RESERVED, exactly as the wallet card
      // reserves its ribbon strip: 32dp of paddingTop puts the price's cap
      // height at about 38dp, clear of the pill's 34dp bottom edge, and the
      // clearance only grows with the font scale because the padding does not
      // scale with it (m3.material.io/foundations/layout/understanding-layout/
      // spacing — spacing is preserved as text scales, so a container grows by
      // its text and never by its padding). paddingBottom balances it at the
      // step below.
      paddingTop: TOKENS.space['2xl'],
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.md,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    // Was outline-only while the wallet card next door was filled; the two
    // grids are the same control and now read the same way (Amit, 2026-09-06:
    // "money chips should have a fill like the recharge screen when selected").
    //
    // M3 says the fill, not the outline, is the selected state: androidx
    // FilterChipTokens.kt gives the flat chip
    // `FlatSelectedContainerColor = SecondaryContainer` and
    // `FlatSelectedOutlineWidth = 0.0.dp`, with `FlatUnselectedOutlineColor`
    // existing only for the unselected chip. The old `borderWidth: 2` went with
    // it for a second reason: `card` already sets borderWidth 1, so 1→2 shifted
    // every child of the chip by a dp on selection.
    //
    // bg/accentStrong rather than bg/accent for the same reason as `cardOn`:
    // this chip carries bodyLarge 16sp and bodySmall 12sp, both under the 18sp
    // line at which developer.android.com drops the requirement to 3:1.
    cardSelected: {
      backgroundColor: t.color.bg.accentStrong,
      borderColor: t.color.bg.accentStrong,
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
    // Inset pill on a selected chip: page colour, accent ink — the same rule the
    // wallet card's ribbon and talk-time tag follow. accentTint on the deep
    // coral would have been 4.26:1 light but 1.93:1 dark, i.e. invisible.
    popularOn: {
      backgroundColor: t.color.bg.base,
    },
    popularText: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.accent,
    },
    amount: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.primary,
    },
    // M3 pairs the selected container with its guaranteed on-colour
    // (FilterChipTokens.kt `SelectedLabelTextColor = OnSecondaryContainer`);
    // ours is text/onAccent, 5.19:1 light and 6.13:1 dark on bg/accentStrong.
    amountOn: {
      color: t.color.text.onAccent,
    },
    tokens: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.xs,
    },
    tokensOn: {
      color: t.color.text.onAccent,
    },
    tokensGst: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    // The step above the pair, not above each line — see `cardGstBlock`.
    tokensGstBlock: {
      paddingTop: TOKENS.space['2xs'],
    },
    tokensGstOn: {
      color: t.color.text.onAccent,
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
