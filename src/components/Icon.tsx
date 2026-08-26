import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  ICON_FAMILY,
  ICON_FAMILY_FILLED,
  ICON_GLYPH,
  type IconName,
} from '../theme/icons.generated';

/**
 * Every icon in the app, rendered as a Material Symbols glyph in a font.
 *
 * **A font, not SVG and not hand-drawn geometry.** react-native-svg is banned
 * here — it throws `synchronouslyUpdateUIProps` inside Reanimated views and
 * kills touch on the subtree. The previous version of this file drew each of ~19
 * glyphs from `View` borders, which is what made `bubble` render as an empty box
 * and `phone` as a bare arc at display size. A glyph in a font is plain `<Text>`:
 * safe inside Reanimated, tinted by `color`, and scaled by `fontSize`.
 *
 * **Style, weight and set live in `design/icons.json`**, and `npm run icons`
 * regenerates the subset fonts and `icons.generated.ts` from it — the same
 * pipeline as the type tokens. Swapping Rounded for Outlined is a one-line config
 * change plus a regenerate, which is the "change instantly like fonts" the icon
 * set was asked to support.
 *
 * **`active` swaps to the filled face.** React Native Android cannot animate the
 * Material `FILL` axis at runtime, so the generator ships two static instances —
 * outlined and filled — and this picks between them. That is Material's own
 * selection pattern (a filled tab icon is the selected tab), and it adds a shape
 * signal on top of the colour one, which colour-blind users cannot read.
 */
interface Props {
  name: IconName;
  /** Selected / live state. Renders the filled face. */
  active?: boolean;
  size?: number;
  color?: string;
  testID?: string;
  /**
   * Hidden from the accessibility tree by default: an icon almost always sits
   * beside a label or inside a labelled control, so announcing the glyph too is
   * noise. Pass an `accessibilityLabel` only for an icon that stands alone as the
   * whole meaning of its control.
   */
  accessibilityLabel?: string;
}

const DEFAULT_SIZE = 24;

function IconView({ name, active = false, size = DEFAULT_SIZE, color, testID, accessibilityLabel }: Props) {
  const theme = useTheme();
  const glyph = ICON_GLYPH[name];
  return (
    <Text
      testID={testID}
      allowFontScaling={false}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={
        accessibilityLabel === undefined ? 'no-hide-descendants' : 'yes'
      }
      style={[
        styles.glyph,
        {
          fontFamily: active ? ICON_FAMILY_FILLED : ICON_FAMILY,
          // Square line height so the glyph box is not taller than the glyph,
          // which would misalign it against adjacent text.
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          color: color ?? theme.color.text.primary,
        },
      ]}>
      {glyph}
    </Text>
  );
}

export const Icon = memo(IconView);

export type { IconName };

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
    textAlignVertical: 'center',
    // A Material Symbols glyph is centred in an em square; no extra padding.
    includeFontPadding: false,
  },
});
