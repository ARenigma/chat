import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  ICON_FAMILY,
  ICON_GLYPH,
  ICON_GLYPH_ACTIVE,
  type IconName,
} from '../theme/icons.generated';

/**
 * Every icon in the app, rendered as a Phosphor glyph in a font.
 *
 * **A font, not SVG and not hand-drawn geometry.** react-native-svg is banned
 * here — it throws `synchronouslyUpdateUIProps` inside Reanimated views and
 * kills touch on the subtree (RULE 5). A glyph in a font is plain `<Text>`: safe
 * inside Reanimated, tinted by `color`, and scaled by `fontSize`.
 *
 * **Set, glyph and fill live in `design/icons.json`**, and `npm run icons:font`
 * regenerates `assets/fonts/Phosphor.ttf` and `icons.generated.ts` from it — the
 * same pipeline as the type tokens.
 *
 * **ONE face, and `active` picks a codepoint, not a family.** Phosphor ships
 * its regular and fill weights under one naming scheme (`heart` /
 * `heart-fill`), so both glyphs sit in the same font and a selected icon is a
 * different character in the same `fontFamily`. The names that genuinely fill
 * when selected (the nav destinations, the favourite heart, the rating star)
 * have an `ICON_GLYPH_ACTIVE` entry; every other name draws its regular glyph
 * in both states and colour carries `active`. This replaces the three-face
 * setup (Heroicons outline + solid, a Lucide subset) and its per-icon family
 * table.
 */
interface Props {
  name: IconName;
  /** Selected state — renders the fill glyph where design/icons.json has one. */
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
 * The scale assumes a full-bleed glyph inks ~0.832 of its em (19.97 of 24),
 * which is what TOKENS.icon's ink-dp values were derived against. Phosphor
 * draws on a 256 grid and inks 208 of it, so the generator maps a 250-unit
 * window onto the em to land on the same 0.832 (EM_WINDOW in
 * scripts/gen-icons-font.mjs). That keeps this constant and every `size` where
 * they were; what it cannot keep is Phosphor's regular stroke, 16/256 of the
 * grid (~1.5 at 24) against Lucide's 2, so glyphs read slightly lighter at the
 * same size. That is a device judgement (RULE 2), not arithmetic.
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

  const glyph =
    (active ? ICON_GLYPH_ACTIVE[name] : undefined) ?? ICON_GLYPH[name];

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
    fontFamily: ICON_FAMILY,
    textAlign: 'center',
    textAlignVertical: 'center',
    // The glyph is centred in an em square; no extra padding.
    includeFontPadding: false,
  },
});
