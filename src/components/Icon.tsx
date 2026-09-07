import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import {
  ICON_FAMILY,
  ICON_FAMILY_FILLED,
  ICON_GLYPH,
  type IconName,
} from '../theme/icons.generated';

/**
 * Half of one Lucide grid unit, as a fraction of the rendered em.
 *
 * Lucide draws every icon on a 24x24 grid with `stroke-width="2"`
 * (https://lucide.dev/contribute/icon-design-guide), and the generated font maps
 * that grid onto the em with no inset. Measured on assets/fonts/Lucide.ttf with
 * fontTools at authoring time: unitsPerEm is 1000 and the heart glyph (uniE0F2)
 * has a bounding box 916 units wide — 22/24 of the em, which is exactly the
 * heart path's 2..22 extent plus half a stroke on each side.
 *
 * Re-measured 2026-09-07 and it holds: uniE0F2 inks x 42.1..958.1 (916.0 wide,
 * 22 grid units) and y 84.0..875.7 (791.7 tall, 19 units). MEASURE IT WITH AN
 * OUTLINE BOUNDS PEN, not the glyf header — lucide-static ships every glyph
 * with its header xMin/yMin zeroed, and `npm run icons` only rewrites the name
 * table, so `head`/`glyf` still report this glyph as 0,0..962,878. A reader who
 * trusts the header measures a different font from the one Android rasterises.
 *
 * So one grid unit is fontSize/24, and expanding the outline by HALF a unit on
 * every side takes the stroke from Lucide's shipped 2 to 3 — one of Lucide's own
 * stroke-width steps, not an invented value.
 * https://lucide.dev/guide/lucide/basics/stroke-width
 *
 * One constant governs the whole weight change: 1/96 gives an effective stroke
 * of 2.5, 1/32 gives 3.5.
 */
const HEAVY_DILATION = 1 / 48;

/**
 * The four directions the heavy heart is over-drawn in.
 *
 * Four rather than eight: the union expands the outline by the full offset where
 * the local normal is axis-aligned and by offset/sqrt(2) at 45 degrees, about a
 * 10% ripple in the ADDED weight around the curve. Eight offsets would cut that
 * to 7.6% for four more `Text` nodes per heart, and at the 24-43dp sizes this
 * renders at the difference is below a pixel.
 */
const HEAVY_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Every icon in the app, rendered as a Lucide glyph in a font.
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
 * **`active` changes weight, not fill.** Lucide is one stroke set with no filled
 * twin (`ICON_FILL_ON_ACTIVE` is `false` in icons.generated.ts), so for every
 * icon but the heart `active` is already a no-op — both family constants resolve
 * to 'Lucide'. The heart is the one control here with a real selected state, and
 * it carries that state as a HEAVIER OUTLINE; see the heart branch below.
 */
interface Props {
  name: IconName;
  /** Selected / live state. For the heart, a heavier outline — never a fill. */
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
 * Every `size` is multiplied by this before it becomes a `fontSize`, so a Lucide
 * glyph reads at the weight the layout was drawn for. One place, app-wide,
 * rather than bumping every call site.
 *
 * NOT because the grid is inset inside the em. That is what this comment used to
 * say, it contradicted the HEAVY_DILATION note above it, and it is the one of the
 * two that measurement refutes: `plus` (uniE13D) inks grid x 4..20 at font units
 * 166.9..833.0, and `close` (uniE1B2) inks grid 5..19 at 209.0..791.0 — one grid
 * unit is 41.667 = unitsPerEm/24 in both. The 24-unit grid maps onto the em 1:1.
 * Deriving a constant from an inset that does not exist would give a wrong
 * number, which is why the wrong sentence is worth replacing rather than
 * softening.
 *
 * What actually makes a Lucide glyph read small is its own artwork rule: "Icons
 * must have at least 1 pixel of padding between their strokes and the edge of
 * the canvas" (https://lucide.dev/contribute/icon-design-guide), and most icons
 * take more than the minimum — the heart inks 22/24 of the em wide and 19/24
 * tall. The Material Symbols set this replaced drew to the edge of its own 24
 * grid, so at one `fontSize` the Lucide mark is the smaller of the two.
 *
 * The VALUE is a judgement, not arithmetic: 24/22 ≈ 1.09 would match the widest
 * glyphs, 24/19 ≈ 1.26 the heart's height. 1.2 is Amit's call — the icons were
 * reading too small — and it moves every icon in the app, so it stays his.
 */
const ICON_SCALE = 1.2;

function IconView({ name, active = false, size = DEFAULT_SIZE, color, testID, accessibilityLabel }: Props) {
  const theme = useTheme();
  const px = Math.round(size * ICON_SCALE);
  const resolvedColor = color ?? theme.color.text.primary;

  const glyph = ICON_GLYPH[name];

  // The favourite heart. An OUTLINE in both states — never filled.
  //
  // Amit, 2026-09-07: "Remove the heart fill; keep the outline, heavier." That
  // extends the reasoning already written at FloatingToolbar.tsx — "a filled
  // heart reads as a save action instead of navigation" — to every heart in the
  // app. There is now exactly one heart shape, and `active` changes its WEIGHT.
  //
  // The selected state is still not colour-only, which WCAG 2.2 SC 1.4.1
  // forbids ("Color is not used as the only visual means of conveying
  // information"): stroke weight is the second visual cue, and the toggle also
  // names the state in its accessibilityLabel.
  // https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
  //
  // WHY OVER-DRAW AND NOT `fontWeight`. A font glyph has no strokeWidth —
  // Lucide bakes stroke-width 2 into the outline before the font is built — and
  // Android's own synthetic bold, Paint.setFakeBoldText ("a simulated bold
  // effect when drawing a Typeface that is not already bold"), has no JS door:
  // grep for it across node_modules/react-native/ReactAndroid/src/main/java
  // returns nothing, so React Native Android never calls it. Asking for
  // `fontWeight` instead makes ReactFontManager.createAssetTypeface look for
  // `assets/fonts/Lucide_bold.ttf`, which does not exist, and then fall through
  // to `Typeface.create("Lucide", BOLD)` — an unknown family, so the system
  // default, which has no glyph at U+E0F2 (a Private Use Area codepoint). That
  // is a tofu heart, silently.
  // https://developer.android.com/reference/android/graphics/Paint#setFakeBoldText(boolean)
  //
  // A genuinely re-stroked face is a second font FILE
  // (https://developer.android.com/develop/ui/views/text-and-emoji/fonts-in-xml),
  // which means regenerating assets/fonts/Lucide.ttf and rebuilding the APK —
  // fonts are packaged at build time, so it cannot reach a device over Metro.
  // So the weight is synthesised the way Skia's fake bold does it, by dilating
  // the outline; here in layout space rather than in outline space.
  if (name === 'heart') {
    const dilation = px * HEAVY_DILATION;
    return (
      <View style={[styles.heartBox, { width: px, height: px }]}>
        {active
          ? HEAVY_OFFSETS.map(([dx, dy]) => (
              <Text
                key={`${dx}:${dy}`}
                allowFontScaling={false}
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={[
                  styles.glyph,
                  styles.heartOverdraw,
                  {
                    fontFamily: ICON_FAMILY,
                    fontSize: px,
                    lineHeight: px,
                    width: px,
                    height: px,
                    left: dx * dilation,
                    top: dy * dilation,
                    color: resolvedColor,
                  },
                ]}>
                {glyph}
              </Text>
            ))
          : null}
        {/* The base copy, last so the un-offset glyph paints on top, and the
            only one carrying `testID` — RNTL's getByTestId throws on multiple
            matches. Byte for byte what the inactive heart has always been, so
            the unchanged state stays unchanged. */}
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
              fontFamily: ICON_FAMILY,
              fontSize: px,
              lineHeight: px,
              color: resolvedColor,
            },
          ]}>
          {glyph}
        </Text>
      </View>
    );
  }

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
    // A Material Symbols glyph is centred in an em square; no extra padding.
    includeFontPadding: false,
  },
  // Fixed-size box for the heart. It centres the glyph via flexbox rather than
  // via the em box, and it is the positioning context for the heavy state's
  // over-draw copies — so toggling `active` changes the stroke and nothing else
  // moves.
  heartBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Over-draw copies of the heart, stacked on the base glyph. Absolute so they
  // occupy the same px-by-px box the base copy is flex-centred in; both centre
  // the glyph at px/2, so the copies register on it. Offset with `left`/`top`
  // rather than `transform`, because Yoga rounds layout positions to the
  // physical pixel grid — each copy lands a whole pixel off and the union is a
  // crisp thicker stroke, where a transform is a render-time matrix and would
  // give softer, resampled copies.
  heartOverdraw: {
    position: 'absolute',
  },
});
