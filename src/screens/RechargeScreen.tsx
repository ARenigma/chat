import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, formatTokens, PAYMENTS_ENABLED, RECHARGE_PACKS } from '../lib/rates';
import { tick } from '../lib/haptics';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { PaymentSheet } from './PaymentSheet';

/**
 * Recharge — the v10 layout on the Fuse system, in rupees.
 *
 * Amit picked v10's visual over v12's: a dark balance card, a coral-selected
 * amount grid and a single payment row. It fits the system better than v12's
 * token-pack list, and v10's own "1 token = ₹1" made the move to a ₹ balance
 * (ADR-0019) a relabel rather than a redraw.
 *
 * The daily check-in strip that v10 carried is gone (Amit's call): a paid
 * marketplace does not hand out a free daily credit, and the strip was the last
 * of the free-token idiom from the AI-companion build. Recharge is now purely
 * "add tokens", which is all a payment screen should be.
 *
 * Rendered as a full-screen overlay off the same `refillVisible` store flag the
 * interim sheet used, so every balance pill and Recharge button already routes
 * here with no new wiring. The `refill-sheet` testID is kept so the maestro flow
 * still targets it.
 *
 * The Pay button is gated behind `PAYMENTS_ENABLED` (the UPI/Play rail is a
 * follow-up): it shows the packs and the total but does not pretend to charge.
 */
export function RechargeScreen() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = useStore(s => s.refillVisible);
  const balance = useStore(s => s.balance);
  const close = useStore(s => s.closeRefill);
  const [amount, setAmount] = useState<number>(RECHARGE_PACKS[1] ?? 60);
  const [payOpen, setPayOpen] = useState(false);

  if (!visible) {
    return null;
  }

  return (
    <View
      testID="refill-sheet"
      // A modal overlay must hide everything under it from TalkBack, or a swipe
      // lands on the Home controls behind it.
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header: back closes the overlay, balance pill mirrors the one that opened it. */}
      <View style={styles.bar}>
        <BackButton
          onPress={close}
          testID="recharge-back"
          accessibilityLabel="Close recharge"
          style={styles.barIcon}
        />
        {/* Centred in the space BETWEEN the back button and the balance pill, not
            across the whole bar. The old title used `marginLeft: -28` to centre
            over the full width, which pushed its flex box left over the back
            button; as a later sibling it then won the hit-test there and ate the
            tap that closes the screen (and neither `pointerEvents` on the Text nor
            an absolute overlay stops Android RN from swallowing it). Sitting
            in-flow after the button, it cannot overlap, and the slight rightward
            counterweight of the pill keeps it reading as balanced. */}
        <Text allowFontScaling numberOfLines={1} style={styles.barTitle}>
          Recharge
        </Text>
        <TokenCounter balance={balance} onPress={() => {}} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={styles.scroll}>
        {/* The balance banner (#13, Amit): a warm gradient field in the same
            language as the onboarding/hero surfaces, built from the accent tokens
            (not raw hex) so it follows a theme change and stays inside the accent
            budget. */}
        <View
          style={[
            styles.balanceCard,
            {
              experimental_backgroundImage: `linear-gradient(140deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`,
            },
          ]}>
          <Text allowFontScaling style={styles.balanceLabel}>
            Balance
          </Text>
          <Text allowFontScaling style={styles.balanceValue}>
            {`${formatTokens(balance)} tokens`}
          </Text>
          <Text allowFontScaling style={styles.balanceHint}>
            Talk time is charged by the minute.
          </Text>
        </View>

        <Text allowFontScaling style={styles.section}>
          Add tokens
        </Text>
        <Text allowFontScaling style={styles.sectionHint}>
          Pick an amount
        </Text>

        <View style={styles.grid}>
          {RECHARGE_PACKS.map(pack => {
            const on = pack === amount;
            return (
              // width lives on this wrapper View; a `width: '48%'` on the
              // Pressable reaches an inner view while the touchable hugs content,
              // which collapsed each card to one character wide.
              <View key={pack} style={styles.cardSlot}>
                <Pressable
                  onPress={() => {
                    tick();
                    setAmount(pack);
                  }}
                  testID={`pack-${pack}`}
                  accessibilityLabel={`Add ${formatTokens(pack)} tokens${on ? ', selected' : ''}`}
                  press="card"
                  style={[styles.card, on && styles.cardOn]}>
                  <Text allowFontScaling style={[styles.cardAmount, on && styles.cardTextOn]}>
                    {formatTokens(pack)}
                  </Text>
                  <Text allowFontScaling style={[styles.cardMinutes, on && styles.cardTextOn]}>
                    {/* At the chat/call rate (22/min) this many minutes. Honest,
                        derived, and the whole point of a per-minute balance. */}
                    {`~${Math.floor(pack / 22)} min`}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <Text allowFontScaling style={styles.section}>
          Payment
        </Text>
        <View style={styles.payment}>
          <View style={styles.payIcon}>
            <Icon name="wallet" active size={20} color={theme.color.text.accent} />
          </View>
          <View style={styles.payText}>
            <Text allowFontScaling style={styles.payName}>
              UPI
            </Text>
            <Text allowFontScaling style={styles.paySub}>
              {PAYMENTS_ENABLED ? 'Instant' : 'Opening soon'}
            </Text>
          </View>
        </View>
        {/* The one place the ₹ mark belongs: the real-money step. */}
        <Text allowFontScaling style={styles.rupeeNote}>
          1 token = ₹1. You are charged in rupees at checkout.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.sm }]}>
        {/* Continue raises the UPI chooser (PaymentSheet) rather than charging
            directly, which is where the real-money step and its ₹ mark belong.
            Not gated here: the sheet is reachable so the flow can be seen and
            tested; the gate lives on the sheet's own confirm. */}
        <Button
          label={`Continue ${formatRupees(amount)}`}
          onPress={() => setPayOpen(true)}
          testID="recharge-pay"
        />
      </View>

      <PaymentSheet visible={payOpen} amount={amount} onClose={() => setPayOpen(false)} />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // A full-screen overlay above everything, so it reads as a modal recharge
    // rather than a tab.
    root: {
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
      minHeight: 44,
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
    },
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      // Takes the slack between the back button and the balance pill and centres
      // within it. No negative margin, so the box never reaches back over the
      // button to swallow its tap.
      flex: 1,
      textAlign: 'center',
    },
    scroll: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xl,
    },
    balanceCard: {
      // Fallback fill under the gradient (older paint paths); the warm coral
      // gradient is applied inline in the component from the accent tokens.
      backgroundColor: t.color.bg.accentStrong,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      padding: TOKENS.space.lg,
      gap: 2,
      marginTop: TOKENS.space.xs,
    },
    balanceLabel: {
      ...TOKENS.typography.subhead,
      color: t.color.text.onAccent,
      opacity: 0.8,
    },
    balanceValue: {
      ...TOKENS.typography.displayLarge,
      color: t.color.text.onAccent,
    },
    balanceHint: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.onAccent,
      opacity: 0.7,
    },
    section: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      paddingTop: TOKENS.space.lg,
    },
    sectionHint: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
      paddingBottom: TOKENS.space.sm,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.sm,
    },
    // Two per row: (100% - one gap) / 2. RN has no calc(), so the slot is 48%
    // and the row's gap makes up the rest.
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
    cardAmount: {
      ...TOKENS.typography.titleMedium,
      color: t.color.text.primary,
    },
    cardMinutes: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.secondary,
    },
    cardTextOn: {
      color: t.color.text.onAccent,
    },
    payment: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      backgroundColor: t.color.bg.sunken,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      padding: TOKENS.space.md,
    },
    payIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentTint,
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
    rupeeNote: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
      paddingTop: TOKENS.space.sm,
    },
    footer: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.sm,
    },
  });
