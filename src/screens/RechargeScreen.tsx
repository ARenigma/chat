import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, formatTokens, PAYMENTS_ENABLED, RECHARGE_PACKS } from '../lib/rates';
import { DAILY_REFILL_TOKENS } from '../lib/tokenLedger';
import { useClaimTokens } from '../api/chat';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

/**
 * Recharge — the v10 layout on the Fuse system, in rupees.
 *
 * Amit picked v10's visual over v12's: a dark balance card, a coral-selected
 * amount grid, a daily check-in strip and a single payment row. It fits the
 * system better than v12's token-pack list, and v10's own "1 token = ₹1" made
 * the move to a ₹ balance (ADR-0019) a relabel rather than a redraw.
 *
 * Rendered as a full-screen overlay off the same `refillVisible` store flag the
 * interim sheet used, so every balance pill and Recharge button already routes
 * here with no new wiring. `refill-sheet` / `refill-claim` testIDs are kept so
 * the maestro token flow still targets it.
 *
 * The Pay button is gated behind `PAYMENTS_ENABLED` (the UPI/Play rail is a
 * follow-up): it shows the packs and the total but does not pretend to charge.
 * The daily starter credit is a separate, real path and stays live.
 */
export function RechargeScreen() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const visible = useStore(s => s.refillVisible);
  const balance = useStore(s => s.balance);
  const close = useStore(s => s.closeRefill);
  const claim = useClaimTokens();
  const [amount, setAmount] = useState<number>(RECHARGE_PACKS[1] ?? 60);

  if (!visible) {
    return null;
  }

  return (
    <View testID="refill-sheet" style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header: back closes the overlay, balance pill mirrors the one that opened it. */}
      <View style={styles.bar}>
        <Pressable
          onPress={close}
          testID="recharge-back"
          accessibilityLabel="Close recharge"
          press="none"
          size={28}
          style={styles.barIcon}>
          <Icon name="chevronLeft" size={26} color={theme.color.text.primary} />
        </Pressable>
        <Text allowFontScaling style={styles.barTitle}>
          Recharge
        </Text>
        <TokenCounter balance={balance} onPress={() => {}} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}>
        {/* The dark balance card. */}
        <View style={styles.balanceCard}>
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
                  onPress={() => setAmount(pack)}
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

        {/* Daily starter credit — the one real, free path while the rail is off. */}
        <Pressable
          onPress={() => claim.mutate()}
          testID="refill-claim"
          accessibilityLabel={`Claim your daily ${formatTokens(DAILY_REFILL_TOKENS)} tokens`}
          press="chip"
          style={styles.checkin}>
          <Text allowFontScaling style={styles.checkinLabel}>
            {claim.isPending ? 'Adding tokens' : 'Daily check-in'}
          </Text>
          <Text allowFontScaling style={styles.checkinValue}>
            {`+${formatTokens(DAILY_REFILL_TOKENS)}`}
          </Text>
        </Pressable>

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
        <Button
          label={PAYMENTS_ENABLED ? `Pay ${formatRupees(amount)}` : 'Payments open soon'}
          disabled={!PAYMENTS_ENABLED}
          onPress={() => {}}
          testID="recharge-pay"
        />
      </View>
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
      flex: 1,
      textAlign: 'center',
      // Offset the back button so the title sits optically centred.
      marginLeft: -28,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xl,
    },
    balanceCard: {
      backgroundColor: t.color.bg.inverse,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      padding: TOKENS.space.lg,
      gap: 2,
      marginTop: TOKENS.space.xs,
    },
    balanceLabel: {
      ...TOKENS.typography.subhead,
      color: t.color.text.onInverse,
      opacity: 0.7,
    },
    balanceValue: {
      ...TOKENS.typography.displayLarge,
      color: t.color.text.onInverse,
    },
    balanceHint: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.onInverse,
      opacity: 0.6,
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
    checkin: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.color.bg.accentTint,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      marginTop: TOKENS.space.md,
    },
    checkinLabel: {
      ...TOKENS.typography.subhead,
      color: t.color.text.accent,
    },
    checkinValue: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.accent,
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
