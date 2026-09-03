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
import { formatRupees, formatTokens, MOCK_PAYMENTS, PAYMENTS_ENABLED } from '../lib/rates';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useStore } from '../store/useStore';
import { CASHFREE_SANDBOX_CHECKOUT } from '../config';
import { productIdForPack, useCashfreeCheckout } from '../api/billing';

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
    setMockPhase('processing');
    setErrorMsg(null);
    cashfreeCheckout.mutate(
      { productId: productIdForPack(amount), method: payMethod },
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
  const sheetBody =
    mockPhase === 'success'
      ? undefined
      : mockPhase === 'processing'
        ? `Paying ${formatRupees(amount)} via ${isCashfree ? 'Cashfree' : method}`
        : isCashfree
          ? `Add ${formatTokens(amount)} tokens  ·  ${formatRupees(amount)}  ·  Sandbox checkout`
          : `Add ${formatTokens(amount)} tokens  ·  ${formatRupees(amount)}`;

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
            <Icon name="check" size={24} color={theme.color.text.positive} />
          </View>
          <Text allowFontScaling style={styles.successDetail}>
            {formatTokens(amount)} tokens added
          </Text>
          {successBalance !== null ? (
            <Text allowFontScaling style={styles.successBalance}>
              Balance {formatTokens(successBalance)} tokens
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
              <Icon name="callEnd" size={14} color={theme.color.state.danger} />
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
                      highlight="ios"
                      style={[
                        styles.row,
                        index === 0 && styles.rowFirst,
                        index === METHODS.length - 1 && styles.rowLast,
                      ]}>
                      <Image
                        source={LOGOS[name].src}
                        style={{ height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOGOS[name].ratio }}
                        resizeMode="contain"
                        accessibilityIgnoresInvertColors
                      />
                      <View style={styles.rowFill} />
                      {on ? <Icon name="check" size={17} color={theme.color.text.primary} /> : null}
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
                label={`Pay ${formatRupees(amount)}  ·  UPI`}
                onPress={() => handleCashfreePay('upi')}
                testID="payment-confirm"
              />
              {/* Fallback for members with no UPI app: the hosted page carries
                  cards, net-banking and wallets. */}
              <Pressable
                onPress={() => handleCashfreePay('web')}
                testID="payment-web"
                accessibilityLabel="Pay with card, net banking or wallets"
                press="none"
                highlight="ios"
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
    webRowText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    centreState: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingVertical: TOKENS.space.lg,
      gap: TOKENS.space.sm,
    },
    centreLabel: {
      ...TOKENS.typography.bodyMedium,
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
    successDetail: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.positive,
    },
    successBalance: {
      ...TOKENS.typography.bodyMedium,
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
