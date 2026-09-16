import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  ICON_FAMILY_BY_NAME,
  ICON_FAMILY_FILLED_BY_NAME,
  ICON_GLYPH,
  type IconName,
} from '../theme/icons.generated';

/**
 * Every icon in the app, rendered as a Heroicons glyph in a font.
 *
 * **A font, not SVG and not hand-drawn geometry.** react-native-svg is banned
 * here — it throws `synchronouslyUpdateUIProps` inside Reanimated views and
 * kills touch on the subtree (RULE 5). A glyph in a font is plain `<Text>`: safe
 * inside Reanimated, tinted by `color`, and scaled by `fontSize`.
 *
 * **Style, weight and set live in `design/icons.json`**, and `npm run icons:font`
 * regenerates the fonts and `icons.generated.ts` from it — the same pipeline as
 * the type tokens.
 *
 * **`active` is a REAL fill now.** Heroicons ships a matched outline + solid pair
 * for every icon, built into two faces at the same codepoint
 * (`ICON_FILL_ON_ACTIVE` is `true`). So `active` swaps the outline face for the
 * solid one and the glyph genuinely FILLS: the favourite heart, the selected nav
 * tab, the filled portion of a rating star. This replaces the old over-drawn
 * outline hack that faked a heavier heart because Lucide had no solid twin. A few
 * icons with no correct Heroicons equivalent fall back to the Lucide face (no
 * solid variant), so for those `active` resolves to the same face and colour
 * carries the state — see ICON_FAMILY_BY_NAME in icons.generated.ts.
 */
interface Props {
  name: IconName;
  /** Selected / filled state — renders the solid glyph where one exists. */
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

/**
 * Every `size` is multiplied by this before it becomes a `fontSize`, so a glyph
 * reads at the weight the layout was drawn for. One place, app-wide, rather than
 * bumping every call site.
 *
 * The VALUE is a judgement, not arithmetic: 1.2 is Amit's call — the icons were
 * reading too small under Lucide — and it moves every icon in the app, so it
 * stays his.
 *
 * Exported so a caller that needs to lay out several icons in a fixed-width row
 * — `RatingStars` is the first — can compute the box the glyph ACTUALLY renders
 * at, rather than the `size` prop it was given. `Icon` sets `width`/`height` on
 * its Text node to `px`, not to `size`: a caller who reserves `size` dp of layout
 * per icon reserves the wrong number, and the glyph overflows that reservation by
 * the same 1.2x this constant names. See RatingStars.tsx for the defect this
 * caused.
 *
 * NOTE (RULE 2): the Heroicons faces have their own stroke weight and fill
 * balance, distinct from Lucide's baked stroke-2. This scale and the on-device
 * fill/outline weight must be re-baselined on a device after the migration.
 */
export const ICON_SCALE = 1.2;

function IconView({
  name,
  active = false,
  size = DEFAULT_SIZE,
  color,
  testID,
  accessibilityLabel,
}: Props) {
  const theme = useTheme();
  const px = Math.round(size * ICON_SCALE);
  const resolvedColor = color ?? theme.color.text.primary;

  const glyph = ICON_GLYPH[name];
  const fontFamily = active
    ? ICON_FAMILY_FILLED_BY_NAME[name]
    : ICON_FAMILY_BY_NAME[name];

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
          fontFamily,
          // Square line height so the glyph box is not taller than the glyph,
          // which would misalign it against adjacent text.
          fontSize: px,
          lineHeight: px,
          width: px,
          height: px,
          color: resolvedColor,
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
    // The glyph is centred in an em square; no extra padding.
    includeFontPadding: false,
  },
});
