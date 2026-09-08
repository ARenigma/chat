import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, ICON_SCALE } from './Icon';

/**
 * The star glyph's box, and why the row is measured rather than laid out.
 *
 * Astrotalk's `average_ratingbar` is 80.0 × 16.0dp for five stars — read off
 * the Redmi with `uiautomator dump` at density 440. That is 16dp per star with
 * no gap, which is what a native `RatingBar` does (the drawable tiles edge to
 * edge). Ours draws five `Icon`s at `icon.xs` with a hair of space, and the
 * total is computed below rather than typed, because the CLIP needs an exact
 * pixel width and a hand-written total that drifted by two points would
 * silently mis-fill every rating in the directory.
 */
const STAR = TOKENS.icon.xs;
const STAR_GAP = 1;
const STAR_COUNT = 5;

/**
 * The box ONE star glyph actually occupies — NOT `STAR`.
 *
 * `Icon` sets its own Text node's `width`/`height` to `Math.round(size *
 * ICON_SCALE)`, not to the `size` prop it was handed (see Icon.tsx). A caller
 * that reserves `STAR` (12) dp of layout per glyph reserves twelve when the
 * glyph's real box is fourteen, and this component did exactly that: the empty
 * row of five Icons is not width-constrained (`row` has no explicit width), so
 * it naturally laid out at 5 * 14 + 4 * 1 = 74dp while `host` — the thing
 * everything ELSE centres against — was fixed at the wrong 5 * 12 + 4 * 1 =
 * 64dp. The row was not clipped (only the FILLED overlay carries
 * `overflow: 'hidden'`), so the last one or two stars silently rendered past
 * the box a parent's `alignItems: 'center'` was centring, and the whole row
 * read as shifted right of the avatar above it.
 *
 * Found on the device (Amit: "align the starts below centre of dp -- it seems
 * a bit to the right as of now") and measured before being explained: the
 * ring's true centre and the star row's true ink centre differed by ~4dp in a
 * pixel scan of the Redmi screenshot, in the direction the report named.
 *
 * `STARS_HEIGHT` already used this arithmetic (`Math.round(STAR * 1.2)`, the
 * same number spelled out rather than imported) and was correct by accident;
 * `STARS_WIDTH` did not, and that asymmetry — one dimension scaled, the other
 * not — is what made this bug hide as a horizontal-only offset.
 */
const STAR_BOX = Math.round(STAR * ICON_SCALE);

/** The whole row's width. Exported so a column can size itself to it. */
export const STARS_WIDTH = STAR_COUNT * STAR_BOX + (STAR_COUNT - 1) * STAR_GAP;

/** The row's height — the glyph's real box, not its nominal `size`. */
export const STARS_HEIGHT = STAR_BOX;

interface Props {
  /** 0–5. Fractions are drawn as a partially filled star. */
  score: number;
  /** Spoken instead of five unlabelled glyphs. */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Five stars, filled to a fractional score, with no SVG and no new dependency.
 *
 * THE TECHNIQUE, because it is the whole component. Two identical rows of five
 * stars are stacked: an empty row in the page's quiet colour, and a filled row
 * in the rating colour laid over it inside a `width`-constrained,
 * `overflow: 'hidden'` View. Setting that width to `score / 5` of the row
 * reveals exactly that fraction of the filled row, so 4.3 shows four solid
 * stars and 30% of a fifth.
 *
 * WHY NOT THE OBVIOUS ALTERNATIVES:
 *
 *   - **Rounding to whole stars.** Then 4.1 and 4.3 render identically, and the
 *     decimal Amit asked for ("4.1, 4.3, 4.5 etc") does not reach the screen at
 *     all. The star row would be a five-value control displaying an eleven-value
 *     number.
 *   - **Half-star glyphs.** The icon set has `star` and no half — adding one is
 *     a change to `design/icons.json` and a regenerated font (RULE 4), for a
 *     quantisation that still loses 4.1 vs 4.3.
 *   - **`react-native-svg` and a gradient/mask.** Banned (RULE 5): it throws
 *     `synchronouslyUpdateUIProps` inside Reanimated views and kills touch on
 *     the whole subtree. This row lives inside a Pressable, which is precisely
 *     that case.
 *
 * `pointerEvents="none"` on the host: the row it sits in owns the gesture, and
 * an overlay View that accepted touches would carve a dead patch out of the
 * provider row's tap target. Same reason `MetaChip` is `accessible={false}`.
 */
function RatingStarsView({ score, accessibilityLabel, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  // Clamped, because the caller's number comes from a database column in the
  // genuine case and nothing constrains `rating_avg` to 0..5 at the schema
  // level. A width wider than the host would paint a sixth star's worth of
  // colour past the row.
  const clamped = Math.max(0, Math.min(STAR_COUNT, score));
  const filledWidth = (clamped / STAR_COUNT) * STARS_WIDTH;

  const row = (color: string, key: string) => (
    <View style={styles.row}>
      {Array.from({ length: STAR_COUNT }, (_, i) => (
        <Icon key={`${key}-${i}`} name="star" size={STAR} color={color} />
      ))}
    </View>
  );

  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
      style={styles.host}>
      {row(theme.color.text.tertiary, 'empty')}
      {/*
       * The filled row is absolutely positioned so it does not add to the
       * host's measured width — a second row in flow would double it — and the
       * clip is the parent View's `width`, not the icons'. Icons are never
       * resized; they are revealed.
       */}
      <View style={[styles.clip, { width: filledWidth }]}>
        {row(theme.color.text.rating, 'filled')}
      </View>
    </View>
  );
}

export const RatingStars = memo(RatingStarsView);

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: {
      width: STARS_WIDTH,
      height: STARS_HEIGHT,
      justifyContent: 'center',
      // Belt and braces after the STAR_BOX defect: if `STARS_WIDTH` ever drifts
      // from the row's true rendered width again, this clips the overflow
      // instead of letting it silently paint past the box every centred parent
      // is centring — a wrong number would then shrink the row rather than
      // shift it off-centre, which is the failure this component's whole
      // reason for existing (an exact-width clip) already assumes is not
      // happening to ITSELF.
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      gap: STAR_GAP,
      alignItems: 'center',
    },
    clip: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      // The clip is the point of the component. Without it the filled row
      // simply covers the empty one and every rating renders as five stars.
      overflow: 'hidden',
      justifyContent: 'center',
    },
  });
