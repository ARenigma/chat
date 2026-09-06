import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  /** Extra positioning from the caller (e.g. absolute placement over a hero). */
  style?: StyleProp<ViewStyle>;
  /** Override the chevron tint — e.g. white over a photo hero. Defaults to primary. */
  tint?: string;
}

/**
 * The one back affordance, so every screen's back reads and presses the same.
 *
 * The design audit found seven different back buttons: some `chevronLeft` at 22
 * with `highlight="dim"`, some at 26 with none, and Settings on Paper's Appbar.
 * This is the single source — a bare chevron in a transparent 28pt target with
 * the iOS press highlight — that they all now use.
 */
export function BackButton({ onPress, testID, accessibilityLabel = 'Back', style, tint }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      press="none"
      highlight="dim"
      size={28}
      style={[styles.button, style]}>
      <Icon name="chevronLeft" size={22} color={tint ?? theme.color.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 28,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
