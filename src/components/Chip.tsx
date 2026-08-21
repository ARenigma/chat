import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS } from '../theme/tokens';
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
 * It answers "what do I even say?" — the highest-friction moment in the product,
 * and the reason the empty conversation offers three of these rather than a
 * blinking cursor.
 *
 * The press scale is `chip` (0.94) rather than `button` (0.96): the smaller the
 * target, the larger the scale change has to be to register at all, because the
 * eye reads the *absolute* pixel travel, not the ratio. A 0.96 press on a 32pt
 * chip moves its edge by less than a pixel.
 *
 * At most one warm chip per screen. It counts against the accent budget.
 */
const MORPH = { from: TOKENS.radius.pill, to: TOKENS.radius.sm };

function ChipView({ label, tone = 'neutral', onPress, selected = false }: Props) {
  return (
    <Pressable
      onPress={() => onPress(label)}
      accessibilityLabel={`Start with: ${label}`}
      testID={`starter-${tone}`}
      press="chip"
      morph={MORPH}
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

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.bg.sunken,
  },
  chipWarm: {
    backgroundColor: TOKENS.color.bg.accentTint,
  },
  chipPositive: {
    backgroundColor: TOKENS.color.bg.positive,
  },
  chipSelected: {
    backgroundColor: TOKENS.color.bg.inverse,
  },
  label: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
  },
  labelWarm: {
    color: TOKENS.color.text.accent,
  },
  labelPositive: {
    color: TOKENS.color.text.positive,
  },
  labelSelected: {
    color: TOKENS.color.text.onInverse,
  },
});
