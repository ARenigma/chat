import React, { useState } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { formatRupees, formatTokens, PAYMENTS_ENABLED } from '../lib/rates';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Sheet } from '../components/Sheet';

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

export function PaymentSheet({ visible, amount, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [method, setMethod] = useState<string>(METHODS[0]);

  return (
    <Sheet
      visible={visible}
      testID="payment-sheet"
      title="Pay with UPI"
      body={`Add ${formatTokens(amount)} tokens  ·  ${formatRupees(amount)}`}
      onClose={onClose}
      onCancel={onClose}
      cancelLabel="Back">
      <View style={styles.group}>
        {METHODS.map((name, index) => {
          const on = name === method;
          return (
            <React.Fragment key={name}>
              {index === 0 ? null : <View style={styles.separator} />}
              <Pressable
                onPress={() => setMethod(name)}
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

      <Button
        label={PAYMENTS_ENABLED ? `Pay ${formatRupees(amount)}` : 'Payments open soon'}
        disabled={!PAYMENTS_ENABLED}
        onPress={onClose}
        testID="payment-confirm"
      />
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
  });
