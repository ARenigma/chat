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
 */
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
      height: 32,
      minHeight: 32,
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
