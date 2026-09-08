import React, { memo } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { formatRupees } from '../lib/rates';
import { TOKENS } from '../theme/tokens';

interface Props {
  /** Rupees, or `null` while the figure has not loaded. */
  value: number | null;
  /** The numeral's own style — whatever headline/label role the caller needs. */
  style?: StyleProp<TextStyle>;
  allowFontScaling?: boolean;
  maxFontSizeMultiplier?: number;
  numberOfLines?: number;
  testID?: string;
}

/**
 * A rupee amount with the ₹ glyph in a LIGHTER weight than the number beside it.
 *
 * Amit, 2026-09-08: "add inr glyph to wheerever we mention prices with light
 * weight". Every price in the app already carries the glyph — `formatRupees`
 * has prepended it since the currency sweep (ea25b11) — so this is not about
 * adding the mark, it is about how it sits next to a BOLD headline figure.
 * "₹5,278" in one uniform Geist-Bold reads as the symbol shouting the number's
 * own volume; the convention this follows (Cred, PhonePe, every Indian banking
 * app) sets the mark in the regular weight and lets the digits carry the
 * emphasis, so the eye lands on the number rather than on the symbol in front
 * of it.
 *
 * `Geist-Regular` rather than a true light face, because the type system has
 * no lighter weight than Regular (`TOKENS.face`: regular / medium / semibold /
 * bold — no `light`) and RULE 5 is that a new one is not free: adding a weight
 * means shipping another font file for a single glyph. Regular next to Bold is
 * already the two-step contrast the convention asks for.
 *
 * SPLITS ON THE FIRST CHARACTER of `formatRupees`'s own output rather than
 * composing "₹" and the grouped digits separately, so there is exactly one
 * function in the app that knows how a rupee figure is formatted (locale,
 * grouping, the `null` case) and this component only ever restyles its result.
 * ₹ (U+20B9) is a single UTF-16 code unit, so `.slice(0, 1)` / `.slice(1)` is
 * safe here — not a general-purpose grapheme split, but correct for this one
 * fixed prefix.
 */
function RupeeAmountView({
  value,
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier,
  numberOfLines,
  testID,
}: Props) {
  const formatted = formatRupees(value);
  const glyph = formatted.slice(0, 1);
  const digits = formatted.slice(1);
  return (
    <Text
      testID={testID}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      numberOfLines={numberOfLines}
      style={style}>
      <Text style={styles.glyph}>{glyph}</Text>
      {digits}
    </Text>
  );
}

export const RupeeAmount = memo(RupeeAmountView);

const styles = {
  glyph: {
    fontFamily: TOKENS.face.regular,
  },
} as const;
