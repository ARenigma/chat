import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { TOKENS } from '../theme/tokens';
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
 * Uses `back` (Phosphor arrow-left) at `TOKENS.icon.lg` (24dp), matching
 * Bluesky's Header.BackButton which renders `ArrowLeft` at `size="lg"` (24dp).
 * An arrow points where you came from; a chevron is a disclosure caret and
 * belongs on expandable rows. The design audit found seven different back
 * buttons using `chevronLeft` at various sizes — this is the single source.
 *
 * Ref: social-app src/components/Layout/Header/index.tsx BackButton
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
      // The `dim` fill has to follow the button, not the square touch box: this
      // box sets no radius, so the layer painted a solid 28x40 rectangle behind
      // a 22pt chevron. Icon-only controls get borderless (circular) ink on this
      // platform rather than the bounded rectangular kind — see
      // `selectableItemBackgroundBorderless` vs `selectableItemBackground`.
      // https://developer.android.com/training/material/animations
      //
      // Deviation, stated per rule 1.6: the box is 28x40, not square, so the
      // pill resolves to a 28-wide stadium rather than a true circle (CSS
      // corner-overlap clamps the radius to half the shorter side). That is the
      // intended reading for an oblong icon slot; a true 40dp M3 circle would
      // mean widening the box to 40, which moves the header layout.
      shape="circle"
      style={[styles.button, style]}>
      {/* Measured against Bluesky 1.133.0 on the S22 (2026-10-04): its
          ArrowLeft draws 18x14dp in contrast_600, which is #8798B0 in dark
          (the inverted ramp's 400) and #526580 in light. Phosphor's arrow fills
          more of its box, so icon.md (20) lands on the same drawn size, and
          text.secondary is that grey at the same luminance in our neutral
          palette. It was 24dp in primary ink, a heavier mark than theirs. */}
      <Icon name="back" size={TOKENS.icon.md} color={tint ?? theme.color.text.secondary} />
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
