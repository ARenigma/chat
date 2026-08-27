import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, formatTokens, MOCK_PAYMENTS, PAYMENTS_ENABLED } from '../lib/rates';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';
import { useStore } from '../store/useStore';

interface Props {
  visible: boolean;
  amount: number;
  onClose: () => void;
}

/**
 * The v10 UPI chooser, as a slide-up.
 *
 * Recharge itself is a full-screen surface; the payment step is the sliding
 * modal v10 had and Amit asked back for. Tapping Pay raises this sheet over the
 * screen, which is the shape a UPI hand-off wants: pick the app, confirm the
 * amount, leave to the PSP. It rides the same draggable `Sheet` every other
 * modal in the app uses, so it tracks the finger and throws to dismiss for free.
 *
 * It is honest about being gated. `PAYMENTS_ENABLED` is false until the UPI/Play
 * rail is proven, so the rows and the amount are real but the confirm says
 * "opening soon" rather than pretending to launch an intent that goes nowhere.
 * When the rail lands, the selected `method` is the app to deep-link into and
 * the confirm becomes the live "Pay" — no other change here.
 *
 * When `MOCK_PAYMENTS` is true (non-production builds), the Pay button is enabled
 * and drives a real ledger write via `mock_recharge`, which requires the server
 * flag `app_flags.mock_payments = true` to be flipped by an operator.
 */
const METHODS = ['Google Pay', 'PhonePe', 'Paytm', 'BHIM'] as const;

/**
 * Each method's official brand lockup and its natural aspect ratio.
 *
 * The mark is the app's own trademarked logo (Google Identity, NPCI/BHIM, each
 * PSP's brand file), shipped as bundled art rather than redrawn — a wallet glyph
 * standing in for four distinct brands read as a placeholder, which is exactly
 * what #3 called out. The lockup already carries the name, so the row drops the
 * text label and sizes the image by `ratio` at a fixed height: no crop, no
 * stretch, left-aligned like a real UPI chooser.
 */
const LOGOS: Record<(typeof METHODS)[number], { src: ImageSourcePropType; ratio: number }> = {
  'Google Pay': { src: require('../../assets/brands/gpay.png'), ratio: 330 / 60 },
  PhonePe: { src: require('../../assets/brands/phonepe.png'), ratio: 330 / 101 },
  Paytm: { src: require('../../assets/brands/paytm.png'), ratio: 330 / 108 },
  BHIM: { src: require('../../assets/brands/bhim.png'), ratio: 330 / 82 },
};

const LOGO_HEIGHT = 22;

/** Minimum time the processing spinner stays visible, in milliseconds. */
const MOCK_SPINNER_MS = 1200;
/** Delay before auto-closing the success state, in milliseconds. */
const MOCK_SUCCESS_CLOSE_MS = 1600;

type MockPhase = 'idle' | 'processing' | 'success' | 'error';

export function PaymentSheet({ visible, amount, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const closeRefill = useStore(s => s.closeRefill);

  const [method, setMethod] = useState<string>(METHODS[0]);
  const [mockPhase, setMockPhase] = useState<MockPhase>('idle');
  const [successBalance, setSuccessBalance] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset mock state whenever the sheet closes so next open starts fresh.
  useEffect(() => {
    if (!visible) {
      setMockPhase('idle');
      setSuccessBalance(null);
      setErrorMsg(null);
    }
  }, [visible]);

  const handleMockPay = async () => {
    setMockPhase('processing');
    const pAmountPaise = amount * 100;
    const pTokens = amount; // 1 token = 1 rupee

    // Enforce a minimum visible-spinner duration so the flow feels intentional.
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
    // Refresh the balance pill in the nav and the recharge screen.
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    setMockPhase('success');

    // Auto-close after the success moment has registered.
    setTimeout(() => {
      onClose();
      closeRefill();
    }, MOCK_SUCCESS_CLOSE_MS);
  };

  const sheetTitle =
    mockPhase === 'success' ? 'Payment successful' : 'Pay with UPI';
  const sheetBody =
    mockPhase === 'success'
      ? `${formatTokens(amount)} tokens added`
      : `Add ${formatTokens(amount)} tokens  ·  ${formatRupees(amount)}`;

  return (
    <Sheet
      visible={visible}
      testID="payment-sheet"
      title={sheetTitle}
      body={sheetBody}
      onClose={onClose}
      onCancel={mockPhase !== 'success' ? onClose : undefined}
      cancelLabel={mockPhase !== 'success' ? 'Back' : undefined}>

      {/* ── Processing state ─────────────────────────────────────────────── */}
      {mockPhase === 'processing' ? (
        <View style={styles.centreState}>
          <ActivityIndicator size="large" color={theme.color.text.accent} />
          <Text allowFontScaling style={styles.centreLabel}>
            Processing payment…
          </Text>
        </View>
      ) : mockPhase === 'success' ? (
        /* ── Success state ───────────────────────────────────────────────── */
        <View style={styles.centreState}>
          <View style={[styles.successCircle, { backgroundColor: theme.color.bg.accentStrong }]}>
            <Icon name="check" size={32} color="#FFFFFF" />
          </View>
          <Text allowFontScaling style={styles.successTitle}>
            {formatTokens(amount)} tokens added
          </Text>
          {successBalance !== null ? (
            <Text allowFontScaling style={styles.successBalance}>
              New balance: {formatTokens(successBalance)} tokens
            </Text>
          ) : null}
        </View>
      ) : (
        /* ── Idle / Error state — UPI chooser ───────────────────────────── */
        <>
          {mockPhase === 'error' && errorMsg !== null ? (
            <View style={styles.errorRow}>
              <Icon name="callEnd" size={14} color={theme.color.state.danger} />
              <Text allowFontScaling style={[styles.errorText, { color: theme.color.state.danger }]}>
                {errorMsg}
              </Text>
            </View>
          ) : null}

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
                    accessibilityLabel={on ? `${name}, selected` : name}
                    press="none"
                    highlight="ios"
                    style={[styles.row, index === 0 && styles.rowFirst, index === METHODS.length - 1 && styles.rowLast]}>
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

          {MOCK_PAYMENTS ? (
            <Button
              label={`Pay ${formatRupees(amount)}`}
              onPress={() => { void handleMockPay(); }}
              testID="payment-confirm"
            />
          ) : (
            <Button
              label={PAYMENTS_ENABLED ? `Pay ${formatRupees(amount)}` : 'Payments open soon'}
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
    // One inset-grouped table of UPI apps. Same idiom as the settings groups so
    // the two selectable-list surfaces in the app read as one system.
    group: {
      alignSelf: 'stretch',
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.sunken,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      minHeight: 48,
      backgroundColor: t.color.bg.sunken,
    },
    rowFirst: {
      borderTopLeftRadius: TOKENS.radius.field,
      borderTopRightRadius: TOKENS.radius.field,
    },
    rowLast: {
      borderBottomLeftRadius: TOKENS.radius.field,
      borderBottomRightRadius: TOKENS.radius.field,
    },
    // Pushes the selected check to the trailing edge; the brand lockup sits at
    // the leading edge and carries its own name.
    rowFill: {
      flex: 1,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: TOKENS.space.md,
      backgroundColor: t.color.border.hairline,
    },
    // Centred layout shared by the processing spinner and the success confirmation.
    centreState: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingVertical: TOKENS.space.xl,
      gap: TOKENS.space.sm,
    },
    centreLabel: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
    },
    // The coral confirmation circle — payment-success is an action-affirming
    // moment, which is exactly what the accent budget reserves the coral for.
    successCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
    },
    successTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    successBalance: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
    },
    // Error inline banner above the UPI list.
    errorRow: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.xs,
    },
    errorText: {
      ...TOKENS.typography.captionSmall,
      flex: 1,
    },
  });
