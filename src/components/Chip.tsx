import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS } from '../theme/tokens';
import { Pressable } from './Pressable';

interface Props {
  label: string;
  tone?: 'neutral' | 'warm';
  onPress: (label: string) => void;
}

/**
 * Conversation starter, shown only in an empty conversation. Answers "what do I
 * even say?" — the highest-friction moment in the product. At most one warm chip
 * per screen; it counts against the accent budget.
 */
function ChipView({ label, tone = 'neutral', onPress }: Props) {
  return (
    <Pressable
      onPress={() => onPress(label)}
      accessibilityLabel={`Start with: ${label}`}
      testID={`starter-${tone}`}
      style={[styles.chip, tone === 'warm' && styles.chipWarm]}>
      <Text allowFontScaling style={[styles.label, tone === 'warm' && styles.labelWarm]}>
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
  label: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
  },
  labelWarm: {
    color: TOKENS.color.text.accent,
  },
});
