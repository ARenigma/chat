import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Pressable } from './Pressable';

interface Props {
  label: string;
  tone?: 'neutral' | 'warm' | 'positive';
  onPress: (label: string) => void;
  /** Filled rather than outlined. For a chip that is a state, not an action. */
  selected?: boolean;
}

/**
 * Conversation starter, and the smallest tappable surface in the app.
 *
 * It answers "what do I even say?", the highest-friction moment in the product,
 * and the reason the empty conversation offers three of these rather than a
 * blinking cursor.
 *
 * The press scale and the radius morph are both gone: a pill that tightens to
 * `radius.sm` under the finger is Material 3 Expressive's shape-morphing, and a
 * UIKit `.bordered` capsule button dims rather than moving. The argument that used
 * to be here, that a smaller target needs a *larger* scale change, because the
 * eye reads absolute pixel travel and 0.96 on a 32pt chip moves its edge by less
 * than a pixel, is still correct, and it is exactly why dropping the scale
 * entirely rather than shrinking it is the right move.
 *
 * `paddingVertical` drops from 10 to 8: at 10 with a 15pt label the chip came to
 * about 40pt, where iOS's bordered capsule is 34, and hitSlop derived from
 * `INTERACTION.minTarget` carries the target.
 *
 * The labels themselves ('How was your day?') are message text, not control
 * labels, so their sentence case is correct and stays.
 *
 * At most one warm chip per screen. It counts against the accent budget.
 */

function ChipView({ label, tone = 'neutral', onPress, selected = false }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={() => onPress(label)}
      accessibilityLabel={`Start with: ${label}`}
      testID={`starter-${tone}`}
      press="none"
      highlight="ios"
      style={[
        styles.chip,
        tone === 'warm' && styles.chipWarm,
        tone === 'positive' && styles.chipPositive,
        selected && styles.chipSelected,
      ]}>
      <Text
        allowFontScaling
        style={[
          styles.label,
          tone === 'warm' && styles.labelWarm,
          tone === 'positive' && styles.labelPositive,
          selected && styles.labelSelected,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const Chip = memo(ChipView);

const makeStyles = (t: Theme) => StyleSheet.create({
  chip: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  chipWarm: {
    backgroundColor: t.color.bg.accentTint,
  },
  chipPositive: {
    backgroundColor: t.color.bg.positive,
  },
  chipSelected: {
    backgroundColor: t.color.bg.inverse,
  },
  label: {
    ...TOKENS.typography.labelMedium,
    color: t.color.text.primary,
  },
  labelWarm: {
    color: t.color.text.accent,
  },
  labelPositive: {
    color: t.color.text.positive,
  },
  labelSelected: {
    color: t.color.text.onInverse,
  },
});
