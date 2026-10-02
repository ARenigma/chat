import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Pressable, PressLayer } from './Pressable';

interface Props {
  label: string;
  tone?: 'neutral' | 'warm' | 'positive';
  onPress: (label: string) => void;
  /** Filled rather than outlined. For a chip that is a state, not an action. */
  selected?: boolean;
}

/**
 * Conversation starter, and the smallest tappable surface in the app.
 *
 * It answers "what do I even say?", the highest-friction moment in the product,
 * and the reason the empty conversation offers three of these rather than a
 * blinking cursor.
 *
 * The press scale and the radius morph are both gone: a pill that tightens to
 * `radius.sm` under the finger is Material 3 Expressive's shape-morphing, and a
 * UIKit `.bordered` capsule button dims rather than moving. The argument that used
 * to be here, that a smaller target needs a *larger* scale change, because the
 * eye reads absolute pixel travel and 0.96 on a 32pt chip moves its edge by less
 * than a pixel, is still correct, and it is exactly why dropping the scale
 * entirely rather than shrinking it is the right move.
 *
 * `paddingVertical` drops from 10 to 8: at 10 with a 15pt label the chip came to
 * about 40pt, where iOS's bordered capsule is 34, and hitSlop derived from
 * `INTERACTION.minTarget` carries the target.
 *
 * The labels themselves ('How was your day?') are message text, not control
 * labels, so their sentence case is correct and stays.
 *
 * At most one warm chip per screen. It counts against the accent budget.
 */

function ChipView({ label, tone = 'neutral', onPress, selected = false }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={() => onPress(label)}
      accessibilityLabel={`Start with: ${label}`}
      testID={`starter-${tone}`}
      press="none"
      highlight="dim"
      style={[
        styles.chip,
        tone === 'warm' && styles.chipWarm,
        tone === 'positive' && styles.chipPositive,
        selected && styles.chipSelected,
      ]}>
      <Text
        allowFontScaling
        style={[
          styles.label,
          tone === 'warm' && styles.labelWarm,
          tone === 'positive' && styles.labelPositive,
          selected && styles.labelSelected,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export const Chip = memo(ChipView);

/* ==========================================================================
 * FilterChip — Material 3's control for "select multiple from a set"
 * ========================================================================== */

/**
 * The M3 filter chip's own visual height, which is a MINIMUM and not a fixture.
 *
 * `styles.xml`'s `Widget.Material3.Chip.Filter` sets
 * `chipMinHeight = @dimen/m3_comp_filter_chip_container_height`, and that dimen
 * is `32dp` — the attribute is named `chipMin…`, so a chip that has grown under
 * a large font scale is still following the spec and a fixed `height: 32` would
 * be the thing that broke it. `FilterChipTokens.kt`'s
 * `ContainerHeight get() = 32.0.dp` agrees.
 *
 * material-components-android master:
 *   lib/java/com/google/android/material/chip/res/values/styles.xml
 *   lib/java/com/google/android/material/chip/res/values/tokens.xml
 * androidx-main:
 *   compose/material3/.../tokens/FilterChipTokens.kt
 */
const FILTER_CHIP_MIN_HEIGHT = 32;

/**
 * `m3_chip_icon_size` — 18dp, agreed by `FilterChipTokens.IconSize` and by
 * `m3_comp_filter_chip_with_icon_icon_size`.
 *
 * DEPARTURE from the token scale, deliberately, and the same trade
 * `SOURCE_METRICS` in `lib/onboarding.ts` argues: there is no 18 on
 * `TOKENS.icon` (16 then 20) and there should not be one, because this is a
 * measured value for one component rather than a step anyone else needs.
 * Rounding it to `icon.sm` shrinks a mark that already sits inside a 32dp
 * container; rounding up to `icon.md` grows the chip.
 */
const FILTER_CHIP_ICON = 18;

interface FilterChipProps {
  label: string;
  selected: boolean;
  onToggle: (label: string) => void;
  disabled?: boolean;
  /**
   * Reserve the leading icon slot even when unselected, so the chip does not
   * change width as the check appears. See the note on the check below; true is
   * the Material team's own recommendation and is what this app wants for a
   * wrapping row, where a width change can reflow every chip after it.
   */
  reserveIconSlot?: boolean;
  testID?: string;
  /** Read out instead of the bare label, so state is spoken with the name. */
  accessibilityLabel?: string;
}

/**
 * A Material 3 **filter chip**: the platform's named control for choosing
 * several things out of a set, which is what a language preference is.
 *
 * Here rather than in a fourth chip file. This module already owns the app's
 * chips and the two that existed answer different questions:
 *
 *   - `Chip` (above) is a conversation STARTER. Its label is message text, its
 *     `onPress` hands back the sentence to send, its accessibility label is
 *     hard-coded to `Start with: …`, and it is a pill. Its `selected` prop
 *     inverts the fill and nothing else — no check, no 32dp container, no
 *     outline at rest.
 *   - `MetaChip` is an M3 **AssistChip**, `accessible={false}` and not pressable
 *     at all, because the row it sits in owns the press.
 *
 * Neither is a selectable chip, so this is the variant the module was missing
 * rather than a fourth take on the same idea.
 *
 * Every number below is read from source, not from `m3.material.io` (which is
 * client-rendered and returns a page title to a fetch):
 *
 *   height          32dp min   styles.xml `chipMinHeight` → tokens.xml
 *                              `m3_comp_filter_chip_container_height`
 *   corner          8dp        `m3_comp_filter_chip_container_shape` is
 *                              `CornerSmall`; `dimens.xml m3_chip_corner_size`
 *                              is 8dp. `TOKENS.radius.xs` IS 8.
 *   start padding   8dp        styles.xml `chipStartPadding`
 *   end padding     10dp       styles.xml `chipEndPadding`
 *   icon → label    6dp        styles.xml `iconEndPadding -2` +
 *                              `textStartPadding 8`
 *   icon            18dp       dimens.xml `m3_chip_icon_size`
 *   stroke          1dp        styles.xml `chipStrokeWidth`;
 *                              `FlatUnselectedOutlineWidth = 1.0.dp`
 *   selected stroke 0dp        `FlatSelectedOutlineWidth = 0.0.dp`, and
 *                              m3_chip_stroke_color.xml gives
 *                              `state_selected` a transparent stroke
 *   label           LabelLarge `m3_comp_filter_chip_label_text_type` →
 *                              `textAppearanceLabelLarge`;
 *                              `TOKENS.typography.labelLarge` is already
 *                              14/20/0.1, which is that scale exactly
 *   touch target    48dp       styles.xml `chipMinTouchTargetSize` +
 *                              `ensureMinTouchTargetSize = true`
 *
 * **The check is ours to draw, and that is per spec.** On the View side
 * `Widget.Material3.Chip.Filter` sets `checkedIcon = @drawable/ic_m3_chip_check`
 * and injects it into the leading slot when checked; Compose's `FilterChip`
 * KDoc instead says of `leadingIcon` that "when [selected] is true, this icon
 * may visually indicate that the chip is selected (for example, via a checkmark
 * icon)" and injects nothing. React Native has neither, so we draw it — and we
 * follow the View side's behaviour, because it is the one that describes what an
 * Android user has already been trained by.
 *
 * **The slot is reserved by default**, which the View side documents as the way
 * to stop the chip resizing on selection. In a wrapping row a chip that widens
 * can push the next one onto a new line, which is a whole-row reflow caused by
 * one tap.
 *
 * **The 48dp target is a container, not a hitSlop.** Measured on device (see the
 * hitSlop note in the project memory): slop does not enlarge the accessibility
 * node in this app, so a 32dp chip with 8dp of slop is still a 32dp target to
 * TalkBack and to Accessibility Scanner. So the Pressable is 48dp tall and the
 * 32dp chip is centred inside it, which is exactly what
 * `ensureMinTouchTargetSize` does natively.
 */
function FilterChipView({
  label,
  selected,
  onToggle,
  disabled = false,
  reserveIconSlot = true,
  testID,
  accessibilityLabel,
}: FilterChipProps) {
  const styles = useStyles(makeStyles);
  const showSlot = reserveIconSlot || selected;
  return (
    <Pressable
      onPress={() => onToggle(label)}
      disabled={disabled}
      testID={testID}
      /*
       * `checkbox`, not `radio` and not `button`. This is a multi-select, so
       * each chip is independently on or off, and `checked` is what makes
       * TalkBack say "ticked" / "not ticked" rather than leaving the state
       * unspoken — the failure mode where a selected chip and an unselected one
       * sound identical.
       */
      accessibilityRole="checkbox"
      checked={selected}
      accessibilityLabel={accessibilityLabel ?? label}
      /* No press scale, matching `Chip` above: 0.96 on a 32dp chip moves its
         edge by less than a pixel, so the dim is the whole feedback. */
      press="none"
      highlight="dim"
      style={styles.filterTarget}
      // The 48dp row is the target; the light belongs on the 32dp chip.
      layer="child"
    >
      <View style={[styles.filterChip, selected && styles.filterChipSelected]}>
        <PressLayer />
        {showSlot ? (
          <View style={styles.filterIconSlot}>
            {selected ? (
              <Icon
                name="check"
                size={FILTER_CHIP_ICON}
                color={LIGHT.color.text.primary}
              />
            ) : null}
          </View>
        ) : null}
        <Text
          allowFontScaling
          style={[styles.filterLabel, selected && styles.filterLabelSelected]}
        >
          {label}
        </Text>
        {/*
          * A MIRROR of the leading icon slot, and it is what makes the label
          * read as centred (Amit, 2026-09-12: "language selection chips are
          * dont have text aligned correctly").
          *
          * The leading slot is 18dp plus a 6dp gap and is reserved even when no
          * check is drawn, so an unselected chip had 32dp of space before its
          * label (8dp chipStartPadding + 24) against 10dp after it. The label
          * was not mis-styled; it was sitting in a box padded more than three
          * times as much on one side as the other, which is exactly what "not
          * aligned" looks like across a wrapped row of them.
          *
          * Mirroring rather than removing the reserve, because the reserve is
          * load-bearing: it is what stops the chip growing 24dp when the check
          * appears and reflowing the whole wrapped row under the member's
          * finger. Material's own chip has no reserve and does reflow; this app
          * chose not to, and that choice is unchanged here. The cost is 24dp of
          * width per chip, which a wrapping row absorbs into more rows rather
          * than into a horizontal scroll.
          */}
        {showSlot ? <View style={styles.filterIconSlotMirror} /> : null}
      </View>
    </Pressable>
  );
}

export const FilterChip = memo(FilterChipView);

const makeStyles = (t: Theme) => StyleSheet.create({
  /*
   * Bluesky's selectable pill (src/components/InterestTabs.tsx:359-381),
   * adopted under ADR-0033 (Amit, 2026-09-26: "match chips to bluesky"):
   * rounded_full, px_lg 16, py_sm 8 and a 1dp border. Unselected sits on the
   * page with a faint border and contrast-medium ink; selected is a faint
   * fill, a stronger border and full ink. No brand colour in either state:
   * selection is carried by fill, border and ink, not by coral.
   */
  chip: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.color.border.hairline,
    backgroundColor: t.color.bg.base,
  },
  chipWarm: {
    backgroundColor: t.color.bg.accentTint,
  },
  chipPositive: {
    backgroundColor: t.color.bg.positive,
  },
  chipSelected: {
    backgroundColor: t.color.bg.sunken,
    borderColor: t.color.border.strong,
  },
  // Bluesky's label is font_medium on the default text_sm; Geist ships no
  // Medium face here and `face.medium` is SemiBold, so it is textSmSemiBold.
  label: {
    ...TOKENS.typography.textSmSemiBold,
    color: t.color.text.secondary,
  },
  // Text on the coral wash takes the wash's own ink (ramp 800 / 300): the
  // accent ink is step 500, and 500 on the step-50 wash is 4.4986:1.
  labelWarm: {
    color: t.color.text.onAccentTint,
  },
  labelPositive: {
    color: t.color.text.positive,
  },
  labelSelected: {
    color: t.color.text.primary,
  },

  /*
   * The 48dp target, as a container rather than a hitSlop.
   * `Base.Widget.MaterialComponents.Chip` sets `chipMinTouchTargetSize` 48dp
   * with `ensureMinTouchTargetSize` true, which extends the tap zone around a
   * 32dp chip. `minHeight` rather than `height` so the target still grows if
   * the chip inside it does under a large font scale.
   */
  filterTarget: {
    minHeight: TOKENS.interaction.minTarget,
    justifyContent: 'center',
    // Clip the state layer to the chip's own rounded shape (radius.xs = 8dp,
    // matching filterChip below). Without this the Pressable's overflow:hidden
    // clips to a square and the state layer paints a rectangle behind the pill.
    borderRadius: TOKENS.radius.xs,
  },
  /*
   * The chip itself: 32dp minimum, 8dp corner, 8dp start / 10dp end, 1dp
   * stroke. `radius.xs` IS the spec's 8, so this is a token and not a literal.
   *
   * `paddingVertical: 6` is not a free choice: `labelLarge`'s lineHeight is 20,
   * and 20 + 6 + 6 = 32, so the chip lands on `chipMinHeight` exactly at 1x
   * scale and grows past it from there — which is what a MIN height means.
   *
   * COLOUR IS A STATED DEPARTURE. M3 asks for `colorSurface` unselected and
   * `colorSecondaryContainer` selected; this app has neither role, and the one
   * surface this chip appears on is the onboarding bloom field, which no M3
   * role describes. So it takes the decision the age chips on the SAME screen
   * already took and had verified on device: transparent at rest so the field
   * shows through (a surface fill would punch a hole in it), and white when
   * selected, matching the Google primary directly below. Both keep the 1dp
   * stroke; see `filterChipSelected`.
   */
  filterChip: {
    // Clips the press layer (layer="child") to the chip's corner.
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: FILTER_CHIP_MIN_HEIGHT,
    paddingVertical: 6,
    /*
     * styles.xml: `chipStartPadding` 8dp, `chipEndPadding` 10dp. Asymmetric in
     * the spec, and kept asymmetric — the trailing 10 is what stops a label
     * crowding the corner the stroke curves through.
     *
     * The 8 is `space.xs` exactly, so it is written as the token. The 10 is not
     * on the 4dp scale and should not be added to it: it is one component's
     * measured value, which is the same trade `SOURCE_METRICS` argues in
     * `lib/onboarding.ts`, and it is allowlisted with that reason in
     * `__tests__/theme.test.ts`.
     */
    paddingStart: TOKENS.space.xs,
    paddingEnd: 10,
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.color.border.strong,
    backgroundColor: 'transparent',
  },
  /*
   * Selected: filled, and the stroke made INVISIBLE rather than removed.
   *
   * The spec's `FlatSelectedOutlineWidth` is 0dp, but setting `borderWidth: 0`
   * here would shrink the chip by 2dp on selection and reflow the row — the
   * exact layout shift `reserveIconSlot` exists to prevent. A transparent
   * stroke is how m3_chip_stroke_color.xml itself expresses the selected state
   * (`<item android:color="@android:color/transparent" android:state_selected="true"/>`),
   * so matching the fill colour is the same idea with one fewer compositing
   * pass.
   */
  filterChipSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  /*
   * 18dp wide and always present while `reserveIconSlot` is on, so the check
   * appearing costs no width. The 6dp is the spec's effective icon-to-label
   * gap: `iconEndPadding: -2dp` plus `textStartPadding: 8dp`.
   */
  filterIconSlot: {
    width: FILTER_CHIP_ICON,
    height: FILTER_CHIP_ICON,
    marginEnd: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * The trailing counterweight. Same width and gap as the leading slot, never
   * drawn into — its only job is to make the label's two margins equal. Height
   * is deliberately absent: an empty 18dp-tall view would set the row's height
   * on a chip whose height should come from its label.
   */
  filterIconSlotMirror: {
    width: FILTER_CHIP_ICON,
    marginStart: 6,
  },
  /*
   * `labelLarge` is 14/20/0.1 — `textAppearanceLabelLarge` exactly, so the
   * spec's type token needs no departure.
   *
   * Ink at rest is `text.primary` rather than the spec's
   * `colorOnSurfaceVariant`, whose nearest neighbour here is `text.secondary`.
   * On a saturated bloom that grey loses the contrast an unselected chip needs
   * to read as a live control rather than a disabled one — the same call the
   * age chips on this screen made.
   */
  filterLabel: {
    ...TOKENS.typography.labelLarge,
    color: t.color.text.primary,
  },
  /*
   * The selected surface is deliberately white in BOTH theme modes, so the ink
   * must be the light theme's, not the active theme's. `t.color.text.primary`
   * turns white in dark mode, which is the bug the age chip's own comment
   * records: a white label on a white chip.
   */
  filterLabelSelected: {
    color: LIGHT.color.text.primary,
  },
});
