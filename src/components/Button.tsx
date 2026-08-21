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
 * Full-width action.
 *
 * Primary is **ink, not coral**, and that is the load-bearing decision in the
 * whole palette. The coral is the app's one signal; spending it on every
 * confirm button would leave nothing to mark the send, the unread count or the
 * message you just wrote. It also could not carry a label safely — coral.9
 * measures 3.4:1 against white, which is why the token that *can* is a separate,
 * deeper step used only for the bubble.
 *
 * Danger is an outline in garnet rather than a filled red: destructive actions
 * should look deliberate, not inviting.
 *
 * The radius morph is here rather than in Pressable's defaults because it needs
 * a resting radius to travel from, and a pill has no meaningful one — `radius.xl`
 * on a 52pt button is just short of a pill, which is what makes the tightening
 * visible at all.
 */
const MORPH = { from: TOKENS.radius.xl, to: TOKENS.radius.pressButton };

function ButtonView({ label, onPress, kind = 'primary', disabled = false, testID }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={label}
      press="button"
      morph={MORPH}
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
    borderRadius: TOKENS.radius.xl,
  },
  primary: {
    backgroundColor: TOKENS.color.bg.inverse,
  },
  secondary: {
    backgroundColor: TOKENS.color.bg.raised,
    borderWidth: 1,
    borderColor: TOKENS.color.border.strong,
  },
  danger: {
    backgroundColor: TOKENS.color.bg.raised,
    borderWidth: 1,
    borderColor: TOKENS.color.state.danger,
  },
  label: {
    ...TOKENS.typography.labelMedium,
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
