import React, { useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, gstAddedLabel, packTotalInr, MOCK_PAYMENTS, PAYMENTS_ENABLED } from '../lib/rates';
import { FALLBACK_ECONOMICS, useEconomicsConfig } from '../api/appConfig';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { RupeeAmount } from '../components/RupeeAmount';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useStore } from '../store/useStore';
import { CASHFREE_SANDBOX_CHECKOUT } from '../config';
import {
  discountedBasePaise,
  discountedTotalInr,
  productIdForPack,
  useCashfreeCheckout,
  useFirstRechargeDiscount,
} from '../api/billing';

interface Props {
  visible: boolean;
  amount: number;
  onClose: () => void;
}

/**
 * UPI chooser + success, aligned to v10 recharge frames (file 2PjJLeNz… node
 * 2024:3253) without copying stale chrome from later frames.
 *
 * Idle: brand lockups for each UPI app. Success is a contained M3 positive
 * card — consistent with the M3 Paper sheet language every overlay in this
 * app uses.
 *
 * Payment routing:
 *   - CASHFREE_SANDBOX_CHECKOUT true (non-prod): Cashfree WebCheckout via SDK.
 *   - MOCK_PAYMENTS true + sandbox false: mock_recharge RPC (dev only).
 *   - Production: gated behind PAYMENTS_ENABLED (ADR-0022).
 */
const METHODS = ['Google Pay', 'PhonePe', 'Paytm', 'BHIM'] as const;

const LOGOS: Record<(typeof METHODS)[number], { src: ImageSourcePropType; ratio: number }> = {
  'Google Pay': { src: require('../../assets/brands/gpay.png'), ratio: 330 / 60 },
  PhonePe: { src: require('../../assets/brands/phonepe.png'), ratio: 330 / 101 },
  Paytm: { src: require('../../assets/brands/paytm.png'), ratio: 330 / 108 },
  BHIM: { src: require('../../assets/brands/bhim.png'), ratio: 330 / 82 },
};

const LOGO_HEIGHT = 22;

const MOCK_SPINNER_MS = 1200;

type MockPhase = 'idle' | 'processing' | 'success' | 'error';

export function PaymentSheet({ visible, amount, onClose }: Props) {
  const { data: economics } = useEconomicsConfig();
  // The last surface the member reads before money moves, so the tax is named
  // here the same way the pack states it — base + tax, the two summing exactly
  // to the total on the button. One line rather than two: unlike a 48%-wide card
  // the sheet has the full width. Both now live in the `totalRow` below rather
  // than in the sheet's supporting subhead, at the same roles the recharge chips
  // use for the same two facts (price, then its composition).
  const gstRateBps = economics?.gst_rate_bps ?? FALLBACK_ECONOMICS.gst_rate_bps;
  // The first-recharge discount the server is holding (migration 102). `total`
  // is what Cashfree will actually capture, and it is passed to the checkout as
  // `expectedTotalInr` so `assertQuotedAmount` (billing.ts) refuses to open the
  // gateway unless the server's order matches this figure to the paise. Both
  // helpers collapse to the undiscounted values when `discountBps` is 0, so a
  // returning member's sheet is byte-for-byte what it was.
  //
  // The GST caption is computed on the DISCOUNTED base — the tax the member
  // actually pays is on ₹150, not ₹300 — matching create-order, which discounts
  // the taxable value and charges GST on top of that (ADR-0029).
  const { data: discountBps = 0, isPending: discountPending } = useFirstRechargeDiscount();
  const discountedBaseInr = discountedBasePaise(amount, discountBps) / 100;
  const gst = gstAddedLabel(discountedBaseInr, gstRateBps);
  const total = discountedTotalInr(amount, gstRateBps, discountBps);
  const wasTotal = packTotalInr(amount, gstRateBps);
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const closeRefill = useStore(s => s.closeRefill);
  const closeWallet = useStore(s => s.closeWallet);

  const [method, setMethod] = useState<string>(METHODS[0]);
  const [mockPhase, setMockPhase] = useState<MockPhase>('idle');
  const [successBalance, setSuccessBalance] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Cashfree sandbox mutation.
  const cashfreeCheckout = useCashfreeCheckout();

  useEffect(() => {
    if (!visible) {
      setMockPhase('idle');
      setSuccessBalance(null);
      setErrorMsg(null);
    }
  }, [visible]);

  const finishHome = () => {
    onClose();
    closeRefill();
    closeWallet();
  };

  const handleCashfreePay = (payMethod: 'upi' | 'web') => {
    // Never quote a price we have not confirmed. If the discount read is still
    // in flight, `total` may be the full price while the server is about to
    // grant the half — which would trip `assertQuotedAmount` and show the member
    // a "price changed" error on a price that never changed. The query is fired
    // on the RechargeScreen behind this sheet and is almost always resolved by
    // now; this guards the cold-open edge.
    if (discountPending) return;
    setMockPhase('processing');
    setErrorMsg(null);
    cashfreeCheckout.mutate(
      { productId: productIdForPack(amount), method: payMethod, expectedTotalInr: total },
      {
        onSuccess: result => {
          setSuccessBalance(result.balance ?? null);
          setMockPhase('success');
        },
        onError: (err: Error) => {
          // Dismissed / failed — do not credit.
          setErrorMsg(err.message ?? 'Payment cancelled or failed');
          setMockPhase('error');
        },
      },
    );
  };

  const handleMockPay = async () => {
    setMockPhase('processing');
    const pAmountPaise = amount * 100;
    const pTokens = amount;

    const [result] = await Promise.all([
      supabase.rpc('mock_recharge', { p_amount_paise: pAmountPaise, p_tokens: pTokens }),
      new Promise<void>(resolve => setTimeout(resolve, MOCK_SPINNER_MS)),
    ]);

    const data = result.data;
    const rpcError = result.error;

    if (rpcError || !data?.success) {
      const errCode = data?.error;
      if (errCode === 'MOCK_DISABLED') {
        setErrorMsg('Mock payments are off. Enable app_flags.mock_payments to test.');
      } else {
        setErrorMsg('Something went wrong, try again');
      }
      setMockPhase('error');
      return;
    }

    setSuccessBalance(data.new_balance ?? null);
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    setMockPhase('success');
  };

  const isCashfree = CASHFREE_SANDBOX_CHECKOUT;

  const sheetTitle =
    mockPhase === 'success'
      ? 'Done'
      : mockPhase === 'processing'
        ? 'Paying'
        : isCashfree
          ? 'Continue to Cashfree'
          : 'Pay with UPI';
  /*
   * The total is NOT in this string any more, and that is the point of this pass.
   *
   * Sheet's `body` is bodyLarge — 16dp Geist-REGULAR (ADR-0024 § 1: weight is a
   * bundled static face, and bodyLarge's face is Regular). So the rupee figure
   * the member is about to be charged was being stated in the same regular
   * supporting line as "Add ₹300", while the identical figure one surface
   * behind it — RechargeScreen's `amount` / `cardAmount` / `balanceValue` — is
   * titleLargeEmphasized, 22dp Geist-BOLD. Same number, two weights, depending
   * on whether a sheet happened to be over the screen (Amit, 2026-09-07: "the
   * type font is not consistent -- recharge screens show heavy weight but modal
   * is normal weight").
   *
   * A supporting line is the wrong slot for a money total regardless of its
   * role: M3's bottom-sheet anatomy puts the sheet's own subhead above the
   * content and the content below it, and a total is content
   * (m3.material.io/components/bottom-sheets/guidelines). It now renders as its
   * own row at the price role — see `totalValue` — and this line is back to the
   * one fact it is the only place for: what the pack adds.
   */
  const sheetBody =
    mockPhase === 'success'
      ? undefined
      : mockPhase === 'processing'
        ? `Paying via ${isCashfree ? 'Cashfree' : method}`
        : isCashfree
          ? `Add ${formatRupees(amount)}  ·  Sandbox checkout`
          : `Add ${formatRupees(amount)}`;

  if (mockPhase === 'success') {
    return (
      <Sheet
        visible={visible}
        testID="payment-success"
        title="Done"
        onClose={finishHome}
        footer={
          <Button label="Back home" onPress={finishHome} testID="payment-back-home" />
        }>
        {/*
          * Contained M3 success card on bg/positive.
          *
          * The previous success state placed an animated field inside a Sheet
          * with overflow:hidden — it produced a half-height ornament that was
          * neither a terminal completion nor a sheet component. The M3 Paper
          * language keeps the same surface hierarchy throughout: bg/raised
          * sheet, contained positive card, explicit typography. A still card
          * resolves faster and works equally on API 24+.
          */}
        <View style={styles.successCard}>
          <View style={styles.successIcon}>
            <Icon name="check" size={TOKENS.icon.lg} color={theme.color.text.positive} />
          </View>
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling style={styles.successDetail}>
            {formatRupees(amount)} added
          </Text>
          {successBalance !== null ? (
            <Text allowFontScaling style={styles.successBalance}>
              Balance {formatRupees(successBalance)}
            </Text>
          ) : null}
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      testID="refill-sheet"
      title={sheetTitle}
      body={sheetBody}
      onClose={onClose}
      onCancel={mockPhase === 'idle' || mockPhase === 'error' ? onClose : undefined}
      cancelLabel="Back">

      {/*
        * THE TOTAL, at the same role the recharge screen states it.
        *
        * `totalValue` is titleLargeEmphasized — 22dp Geist-Bold — which is
        * literally the style RechargeScreen's own price chip uses (`amount` in
        * its makeCompactStyles, and `cardAmount` on the wallet page). The chip
        * behind this sheet and the total in front of it are now one figure said
        * once, in one weight; before this pass the sheet restated it in a 16dp
        * Regular supporting line, i.e. the modal was QUIETER about the charge
        * than the screen that offered it.
        *
        * Rendered outside the phase branch on purpose: idle, error and
        * processing all show it. A member watching a spinner should still be
        * able to see what is being taken, and a payment that failed should not
        * blank the amount that failed.
        *
        * The GST split under it is bodySmall, the role the recharge chips'
        * `tokensGst` / `cardGst` already use for exactly this disclosure. It
        * moved DOWN a step here (it was riding the bodyLarge body line): the
        * base and the tax are what the total is made of, never the offer, and
        * ADR-0029 puts the pack price — this total — as the base fact.
        */}
      <View style={styles.totalRow}>
        <Text allowFontScaling style={styles.totalLabel}>
          Total
        </Text>
        <View style={styles.totalFill} />
        <View style={styles.totalFigures}>
          {/* The full total, struck through, above the discounted one — the same
              first-recharge saving the chip behind this sheet showed, restated at
              the moment money moves. First-timers only; `discountBps` is 0 for
              everyone else and this renders nothing. */}
          {discountBps > 0 ? (
            <Text allowFontScaling style={styles.totalWas} testID="payment-total-was">
              {formatRupees(wasTotal)}
            </Text>
          ) : null}
          <RupeeAmount
            value={total}
            maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
            allowFontScaling
            testID="payment-total"
            style={styles.totalValue}
          />
          {gst ? (
            <Text allowFontScaling style={styles.totalGst}>
              {gst}
            </Text>
          ) : null}
        </View>
      </View>

      {mockPhase === 'processing' ? (
        <View style={styles.centreState}>
          <LoadingIndicator size={48} color={theme.color.bg.accent} />
          <Text allowFontScaling style={styles.centreLabel}>
            {isCashfree ? 'Opening Cashfree…' : `Opening ${method}…`}
          </Text>
        </View>
      ) : (
        <>
          {mockPhase === 'error' && errorMsg !== null ? (
            <View style={styles.errorRow}>
              <Icon name="callEnd" size={TOKENS.icon.xs} color={theme.color.state.danger} />
              <Text allowFontScaling style={[styles.errorText, { color: theme.color.state.danger }]}>
                {errorMsg}
              </Text>
            </View>
          ) : null}

          {/* UPI app picker in the mock path; M3 list/selection semantics.
              accessibilityRole="radio" + accessibilityState.checked gives
              TalkBack the correct "Google Pay, radio button, checked" announcement.
              No iOS-grouped card wrapper: M3 list rows are flat surfaces on
              bg/raised, distinguished by the selection state rather than by a
              rounded container with overflow:hidden. */}
          {!isCashfree ? (
            <View style={styles.group}>
              {METHODS.map((name, index) => {
                const on = name === method;
                return (
                  <React.Fragment key={name}>
                    {index === 0 ? null : <View style={styles.separator} />}
                    <Pressable
                      onPress={() => {
                        if (mockPhase === 'idle') {
                          setMethod(name);
                        }
                      }}
                      testID={`upi-${name}`}
                      accessibilityRole="radio"
                      checked={on}
                      accessibilityLabel={name}
                      press="none"
                      highlight="dim"
                      style={[
                        styles.row,
                        index === 0 && styles.rowFirst,
                        index === METHODS.length - 1 && styles.rowLast,
                        on && styles.rowOn,
                      ]}>
                      <Image
                        source={LOGOS[name].src}
                        style={{ height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOGOS[name].ratio }}
                        resizeMode="contain"
                        accessibilityIgnoresInvertColors
                      />
                      <View style={styles.rowFill} />
                      {on ? <Icon name="check" size={TOKENS.icon.sm} color={theme.color.text.primary} /> : null}
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </View>
          ) : null}

          {isCashfree ? (
            <>
              {/* One-tap: fires the UPI intent chooser and deep-links into the
                  member's own GPay / PhonePe / Paytm (research 2026-08-30). */}
              <Button
                label={`Pay ${formatRupees(total)}  ·  UPI`}
                onPress={() => handleCashfreePay('upi')}
                disabled={discountPending}
                testID="payment-confirm"
              />
              {/* Fallback for members with no UPI app: the hosted page carries
                  cards, net-banking and wallets. */}
              <Pressable
                onPress={() => handleCashfreePay('web')}
                testID="payment-web"
                accessibilityLabel="Pay with card, net banking or wallets"
                press="none"
                highlight="dim"
                style={styles.webRow}>
                <Text allowFontScaling style={styles.webRowText}>
                  Card, Net Banking & Wallets
                </Text>
              </Pressable>
            </>
          ) : MOCK_PAYMENTS ? (
            <Button
              label={`Open ${method}`}
              onPress={() => {
                void handleMockPay();
              }}
              testID="payment-confirm"
            />
          ) : (
            <Button
              label={PAYMENTS_ENABLED ? `Open ${method}` : 'Payments open soon'}
              disabled={!PAYMENTS_ENABLED}
              onPress={onClose}
              testID="payment-confirm"
            />
          )}
          {/* Non-refundable notice at the moment money moves. This is the last
              surface before the charge, so it restates the stance the recharge
              screen already carries and the public policy fixes
              (web/refund.html: "All purchases on Pappal are final"). Same
              wording as RechargeScreen's footer so the two never drift. */}
          <Text allowFontScaling style={styles.finalNote} testID="payment-final-note">
            All purchases are final — no refunds.
          </Text>
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    group: {
      alignSelf: 'stretch',
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.base,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      minHeight: 48,
      backgroundColor: t.color.bg.base,
    },
    // Selection here was a single 17px check and nothing else. M3's selected
    // state is a tonal CONTAINER — androidx FilterChipTokens.kt
    // `FlatSelectedContainerColor = SecondaryContainer` — and the Compose chip
    // guide shows the two together ("Selected filter chip, with a check and a
    // colored background"), so the check stays: it is the non-colour indicator,
    // and the tint alone would be a 1.22:1 boundary against bg/base.
    //
    // bg/accentTint, not the deep fill the pack chips take: nothing here is
    // white-on-coral text — the row holds a brand lockup and a text/primary
    // check, which reads 13.98:1 light / 12.33:1 dark on the tint — and a full
    // coral row would compete with the Pay button directly beneath it.
    rowOn: {
      backgroundColor: t.color.bg.accentTint,
    },
    rowFirst: {
      borderTopLeftRadius: TOKENS.radius.field,
      borderTopRightRadius: TOKENS.radius.field,
    },
    rowLast: {
      borderBottomLeftRadius: TOKENS.radius.field,
      borderBottomRightRadius: TOKENS.radius.field,
    },
    rowFill: {
      flex: 1,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: TOKENS.space.md,
      backgroundColor: t.color.border.hairline,
    },
    webRow: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: TOKENS.interaction.minTarget,
      marginTop: TOKENS.space.xs,
    },
    /*
     * The total row: label on the leading edge, figure and its tax on the
     * trailing one. A row rather than a stacked block because the sheet has the
     * full width (the same reason the GST line here is one line and not two),
     * and the figure wants to sit at the reading end next to the Pay button
     * directly beneath it.
     */
    totalRow: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
      paddingBottom: TOKENS.space.xs,
    },
    totalFill: {
      flex: 1,
    },
    totalFigures: {
      alignItems: 'flex-end',
    },
    // The label beside the figure is a supporting line, so it takes the app's
    // supporting-line role (bodyLarge) rather than the 14dp bodyMedium this file
    // used to reach for. bodyMedium's documented home in ADR-0024 is "list
    // previews, timestamps" — a two-item row on a payment sheet is neither.
    totalLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    // The full total, struck through, sitting above the discounted `totalValue`
    // for a first-recharge member. bodySmall / secondary (7.41:1 light / 5.00:1
    // dark on the sheet's bg/raised): a 12sp struck figure still owes the 4.5:1
    // floor, so it takes the same readable secondary ink the chip's struck price
    // uses rather than the quieter tertiary.
    totalWas: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      textDecorationLine: 'line-through',
    },
    // 22dp Geist-Bold, byte-for-byte the role RechargeScreen's price chip uses.
    // This is the parity that __tests__/theme.test.ts now pins: if either side
    // moves without the other, the gate fails rather than a member noticing that
    // the number got lighter when the sheet opened.
    totalValue: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.primary,
    },
    // The disclosure, one step below the figure — the recharge chips' own role
    // for the base + tax line (`tokensGst`, `cardGst`), same colour too.
    totalGst: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    // The non-refundable line under the Pay options. bodySmall / tertiary — the
    // quiet disclosure role this sheet already uses for `totalGst`, and centred
    // because it is a statement about the whole purchase rather than a value on
    // a row. Reads at the 4.5:1 floor on bg/raised as tertiary does elsewhere.
    finalNote: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      textAlign: 'center',
      alignSelf: 'stretch',
      marginTop: TOKENS.space.xs,
    },
    // A text button, so it takes the app's text-button role: labelLargeEmphasized,
    // 14dp Geist-Bold. It was `TOKENS.typography.bodyMedium` — 14dp
    // Geist-REGULAR, and naming it in full here is deliberate: the gate that
    // forbids that role on this surface strips comments before matching, so this
    // line is also the proof it does. It made this the
    // only tappable text label in the app set in a regular face, against
    // ConfirmDialog's `cancel`, SettingsSheet's `rateFooterText`, CodeField's
    // `verifyLabel`, HomeTour's `skipLabel`/`nextLabel`, UpdateBanner's
    // `actionLabel`, SpotlightCard's `ctaLabel`/`notNow`, BlockedUsersScreen's
    // `unblockLabel` and Chip's `label`, which are all labelLargeEmphasized. Same
    // dp, correct face — this is a weight fix, not a size change, which is the
    // whole shape of the complaint that started this pass.
    webRowText: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.secondary,
    },
    centreState: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingVertical: TOKENS.space.lg,
      gap: TOKENS.space.sm,
    },
    // The "the app is doing something right now" line, and the app states that
    // at bodyLarge everywhere else it states it: TransactionHistoryScreen's
    // centred `hintText` ("Loading…") and NoticeBar's `text`. It was bodyMedium,
    // which also meant this sheet carried TWO supporting lines eight dp apart at
    // two different sizes — Sheet's own bodyLarge `body` above, this bodyMedium
    // below it — on one surface.
    centreLabel: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    /*
     * Contained M3 success card — bg/positive surface with positive-tinted icon.
     *
     * Replaces the previous full-bleed animated field + absolute-positioned copy.
     * The old approach used an ornamental surface inside a Sheet (two surface
     * languages on one screen). The positive card uses only surface + typography
     * tokens, consistent with every other Sheet state in the app.
     */
    successCard: {
      alignSelf: 'stretch',
      paddingVertical: TOKENS.space.xl,
      paddingHorizontal: TOKENS.space.lg,
      borderRadius: TOKENS.radius.md,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.positive,
      gap: TOKENS.space.xs,
      alignItems: 'center',
    },
    successIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.base,
      marginBottom: TOKENS.space.xs,
    },
    // The terminal figure of the whole flow — "₹5,000 added" — so it takes
    // the money/balance role, titleLargeEmphasized, the one RechargeScreen's
    // `balanceValue` uses for the same quantity on the surface behind. It was
    // titleMediumEmphasized, which is the FILLED-BUTTON role (Button.tsx line
    // 177, and ADR-0024 names it "filled-button label"): the confirmation of a
    // payment was set at the weight of a button label and one step below the
    // ₹ figure that produced it.
    successDetail: {
      ...TOKENS.typography.titleLargeEmphasized,
      color: t.color.text.positive,
    },
    // The line under that figure is a supporting line, so bodyLarge — the role
    // Sheet's own `body` uses, and the role every screen's supporting copy uses
    // (TransactionHistoryScreen `emptyBody`/`hintText`, SessionFeedbackSheet
    // `word`, SafetySheet `reasonLabel`). At bodyMedium a balance the member had
    // just paid for was the quietest text on its own success card.
    successBalance: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.positive,
    },
    errorRow: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.xs,
    },
    errorText: {
      ...TOKENS.typography.bodySmall,
      flex: 1,
    },
  });
