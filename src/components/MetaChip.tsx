import React, { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

type Tone = 'surface' | 'emphasis' | 'onMedia';

interface Props {
  label: string;
  /** surface = M3 AssistChip; emphasis = rating lead; onMedia = photo overlay. */
  tone?: Tone;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Material 3 AssistChip geometry for fact tags (rating, years, languages).
 *
 * Specs from AssistChipDefaults (developer.android.com):
 *   - Height 32dp
 *   - Small corner shape (8dp here = radius.xs)
 *   - 1dp outline
 *   - Horizontal label padding ~12dp
 *   - Flat (no elevation)
 *
 * Display-only — not an AssistChip action target. The row/card owns the press.
 * https://m3.material.io/components/chips/specs
 * https://developer.android.com/reference/kotlin/androidx/compose/material3/AssistChipDefaults
 *
 * NO `flexShrink: 0` AND NO `minWidth`, reviewed 2026-09-07 rather than left
 * unexamined, because the obvious guard against "a chip squeezed to an ellipsis
 * mid-strip" would break the other call site.
 *
 * There is no squeeze to guard against in ProviderRow any more: its strip is a
 * horizontal ScrollView, whose main axis is unbounded, so a chip in it is laid
 * out at its natural width and there is no shrink pressure to ellipsize under.
 * ProviderCard's strip is the opposite case — a bounded, WRAPPING row — and
 * there `flexShrink: 1` (the default) is the correct behaviour for the one chip
 * that is longer than the card is wide: it shrinks and its label truncates,
 * where `flexShrink: 0` would push it out past the card's edge. A `minWidth`
 * would do the same thing more quietly. So the fix for the row belongs in the
 * row's layout, which is where it now is, and this component keeps flexing.
 */

/**
 * AssistChip height, exported so a container can size itself to the chip.
 *
 * ProviderRow's scroller needs a FIXED height — a ScrollView measures its
 * cross axis from its content, and that list's rows must all be the same height
 * — and it takes this constant rather than repeating 32, so the scroller and the
 * chip inside it cannot drift apart.
 */
export const META_CHIP_HEIGHT = 32;
function MetaChipView({ label, tone = 'surface', testID, style }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View
      testID={testID}
      accessible={false}
      style={[
        styles.chip,
        tone === 'emphasis' && styles.emphasis,
        tone === 'onMedia' && styles.onMedia,
        style,
      ]}>
      <Text
        allowFontScaling
        numberOfLines={1}
        style={[
          styles.label,
          tone === 'emphasis' && styles.labelEmphasis,
          tone === 'onMedia' && styles.labelOnMedia,
        ]}>
        {label}
      </Text>
    </View>
  );
}

export const MetaChip = memo(MetaChipView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    chip: {
      height: META_CHIP_HEIGHT,
      minHeight: META_CHIP_HEIGHT,
      paddingHorizontal: TOKENS.space.sm,
      justifyContent: 'center',
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.base,
    },
    emphasis: {
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.raised,
    },
    // Over a photo: white outline + translucent fill so the chip still reads as
    // the same 32×8 geometry without fighting the scrim.
    onMedia: {
      borderColor: 'rgba(255,255,255,0.55)',
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    label: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
    },
    labelEmphasis: {
      ...TOKENS.typography.labelMediumEmphasized,
      fontFamily: 'Geist-SemiBold',
      color: t.color.text.primary,
    },
    labelOnMedia: {
      color: '#FFFFFF',
    },
  });
