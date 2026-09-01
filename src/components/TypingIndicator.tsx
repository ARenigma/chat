import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION } from '../theme/motion';
import { ConveyorDots } from './CallingDots';

/**
 * Peer-typing indicator — conveyor dots (smaller/slower) beside a label.
 *
 * Uses the same clipped linear conveyor mechanic as CallingDots, via the shared
 * ConveyorDots primitive, but with geometry and cadence tuned for the patient
 * rhythm of someone composing text rather than the urgency of a live call:
 *
 *   dot=3dp (vs 4), pitch=6dp (vs 8), DURATION.slow 420ms (vs calling's 240ms base)
 *
 * This means "typing" and "calling" are the same animation at a different tempo
 * — one mechanic, one module, two meanings.
 *
 * Reduced motion: the dots collapse to a static "…" label. Accent-coloured,
 * one of the five permitted accent uses (see tokens.generated.ts header).
 *
 * `label` is both the accessibility label and the visible text, so a sighted
 * user knows who is typing without squinting at the dots.
 */
function TypingIndicatorView({ label = 'Typing' }: { label?: string }) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reduce = useReducedMotion();

  return (
    <View style={styles.host} testID="typing-indicator" accessibilityLabel={label}>
      {reduce ? (
        // Reduced motion: three static dots, no clip, no loop.
        <Text allowFontScaling={false} style={[styles.label, { color: theme.color.bg.accent }]}>
          …
        </Text>
      ) : (
        <ConveyorDots
          dot={3}
          pitch={6}
          duration={DURATION.slow}
          color={theme.color.bg.accent}
          startOffset={0}
        />
      )}
      <Text allowFontScaling style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export const TypingIndicator = memo(TypingIndicatorView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space.xs,
  },
  label: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
});
