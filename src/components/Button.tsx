import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS } from '../theme/tokens';
import { Pressable } from './Pressable';

interface Props {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  testID?: string;
}

/**
 * Full-width pill for sheet actions. Primary uses bg/inverse, not the accent —
 * the accent belongs to send, and two accent surfaces on one screen means
 * neither reads as special. Danger is outline-only: destructive actions should
 * look deliberate, not inviting.
 */
function ButtonView({ label, onPress, kind = 'primary', disabled = false, testID }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={label}
      style={[styles.base, styles[kind]]}>
      <Text allowFontScaling style={[styles.label, styles[`${kind}Label`]]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const Button = memo(ButtonView);

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space.lg,
    borderRadius: TOKENS.radius.pill,
  },
  primary: {
    backgroundColor: TOKENS.color.bg.inverse,
  },
  secondary: {
    borderWidth: 1,
    borderColor: TOKENS.color.border.hairline,
  },
  danger: {
    borderWidth: 1,
    borderColor: TOKENS.color.state.danger,
  },
  label: {
    ...TOKENS.typography.bodyMedium,
    fontWeight: '500',
  },
  primaryLabel: {
    color: TOKENS.color.text.onInverse,
  },
  secondaryLabel: {
    color: TOKENS.color.text.primary,
  },
  dangerLabel: {
    color: TOKENS.color.state.danger,
  },
});
