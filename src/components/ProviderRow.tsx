import React, { memo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { genderLetter, initialOf, providerCtaLabel, providerFirstName } from '../lib/display';
import { offeredChannelsLine, presenceForSpeech, readPresence } from '../lib/presence';
import { DURATION, EASE_OUT_QUINT, fadeSwapOutFast, rowIn } from '../theme/motion';
import { minutesUntil, useNotifyProvider } from '../api/sessions';
import { Avatar } from './Avatar';
import { ICON_SCALE, Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { CATEGORY_BADGE, categoryOf, type ProviderCategory } from '../lib/providerFilters';
import { rowExpertise } from '../lib/expertise';
import { formatRupees } from '../lib/rates';
import { busyForSpeech, busyLine, readBusy } from '../lib/busy';
import { RupeeAmount } from './RupeeAmount';
import { displayRating, formatReviewCount } from '../lib/systemRating';
import { RatingStars, STARS_HEIGHT } from './RatingStars';

interface Props {
  provider: ProviderSummary;
  index: number;
  /**
   * Suppresses the trailing gap under the last card, so the list does not end
   * with a strip of page colour that reads as a cut-off rather than an end.
   */
  isLast: boolean;
  /**
   * Card body tap: opens the conversation. Receives the provider id rather than
   * the full summary, so call sites can pass a stable
   * `useCallback((id: string) => ...)` without re-wrapping the object — which
   * was the reason memo never held across balance ticks.
   */
  onPress: (id: string) => void;
  /** Avatar tap: open the profile card. Same id-only contract as `onPress`. */
  onPressAvatar?: (id: string) => void;
  /**
   * The CTA. Rings the provider — a DIFFERENT action from the card body, which
   * is why it is a second touch target where the old chevron was rightly not.
   *
   * Optional: a surface with nowhere to put a call passes nothing, and the
   * button falls back to opening the conversation, so the control is never
   * inert and never lies about what it will do.
   */
  onCall?: (id: string) => void;
  /** Whether to run the entrance animation. Defaults to true. */
  animateEntrance?: boolean;
  /**
   * ₹ per minute, passed IN rather than read from `useEconomicsConfig()` here.
   *
   * The hook would work — React Query dedupes the fetch — but every row would
   * subscribe to the config query, so one admin change re-renders the whole
   * list and `memo` stops holding. The list screens already read the config for
   * other reasons; one read at the top and a number down the tree keeps this
   * component a pure function of its props, which is also what makes it
   * assertable without a renderer.
   *
   * ONE EXCEPTION SINCE 2026-09-17, stated here because this note is where the
   * rule is written down: `useNotifyProvider` (see the CTA below) is read in
   * this component rather than threaded in as a prop. The reason the rate is a
   * prop does not apply to it — it subscribes to nothing that changes for
   * anyone else, so no other row re-renders when one of them rings a bell —
   * and the alternative would be a handler plus a per-row state object passed
   * down from three different list screens for a control only this file draws.
   */
  ratePerMin: number;
}

/**
 * A seeded years-of-experience, 1 to 10, stable per provider.
 *
 * A placeholder (Amit, 2026-09-08: "give experience also from 1-10 years"): the
 * directory has no experience column, so this derives a deterministic number
 * from the id rather than inventing one per render. It is the same class of
 * manufactured fact as `systemRating` — that module's header argues the case at
 * length and applies here too — and stable for the same reason: a number that
 * changed as the list recycled would be a visible bug rather than a plausible
 * figure.
 *
 * Was 2..8; widened to 1..10 on request. Swap for a real `experience_years`
 * column when the schema carries one.
 */
export function seededExperienceYears(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    // `% 100000` keeps the running hash bounded (no overflow) without a bitwise
    // op, which the lint config forbids.
    h = (h * 31 + id.charCodeAt(i)) % 100000;
  }
  return 1 + (h % 10);
}

/** "replies in ~4m". Rounded hard, because precision here would be false. */
export function replyLatency(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  if (seconds < 120) {
    return 'replies in ~1m';
  }
  if (seconds < 3600) {
    return `replies in ~${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `replies in ~${Math.round(seconds / 3600)}h`;
  }
  return 'replies slowly';
}

/**
 * The photo itself. Astrotalk's `user_pic` is 72.0dp; ours is 76 because that
 * is what `Avatar`'s deliberately-closed size union carries, and 76 already has
 * the hand-tuned FONT and DOT entries a new value would have to invent.
 */
export const ROW_AVATAR = 76;

/**
 * The ring, which Astrotalk has and this row did not.
 *
 * Amit, 2026-09-08: "token color of ring around dp always" — the accent, so it
 * is the same green as the CTA and the wallet pill rather than a colour with no
 * other job. Astrotalk's is their brand yellow; this is the same move in our
 * palette.
 *
 * The earlier argument for having NO ring was that a halo on a stranger's face
 * reads as a badge that has been awarded. That argument fails on a ring that is
 * on EVERY row: uniform decoration endorses nobody, which is the same reasoning
 * that lets the accent CTA past the directory's monochrome rule.
 *
 * A 2dp stroke with a 2dp inset, giving 84 overall against Astrotalk's 85.1dp
 * `ll_old_image_holder`. RN borders draw inside the box, so an 84 box with a
 * 2dp border has an 80 content area and `padding: 2` leaves exactly 76.
 */
const RING_STROKE = 2;
const RING_INSET = 2;
export const ROW_AVATAR_RING = ROW_AVATAR + 2 * (RING_STROKE + RING_INSET);

/**
 * The LEAST gap between the ring and the star row. A floor now, not the gap.
 *
 * `space.xs` (8) and not `space['2xs']` (4). Amit, on the device: "ratings too
 * close to dp circle.. allow some more spacing" — and the 4dp that looked right
 * in the arithmetic reads as crowding on hardware, because the ring's stroke is
 * a hard edge and the stars have their own optical padding inside the glyph
 * box, so the measured gap and the perceived gap are not the same number.
 *
 * A FLOOR since 2026-09-27: the left column is sized to put the stars on the
 * last text line's centre OR this far under the ring, whichever is lower (see
 * PROVIDER_ROW_LEFT_COLUMN). With the CTA beside the last two lines the floor
 * is the term in force, so the gap is exactly this 8 and the stars sit 1.5dp
 * under the category line's centre rather than 6.5 under the ring.
 */
const RING_TO_STARS = TOKENS.space.xs;

/**
 * THE ONE GAP between the card's text lines, in both columns (Amit, on the
 * S22, 2026-09-27: the gaps were uneven, and the one after the specialities
 * read biggest).
 *
 * It was three different numbers. The specialities sat in a 24dp slot left
 * over from when they were chips (MetaChip's small height), so a 16dp line
 * inside it carried 4dp of dead space above and below on top of the 2dp hair
 * gap: 6 above it and 6 below, against 2 between languages and experience,
 * and 9.5 from experience down to the CTA's drawn edge.
 *
 * `space['2xs']` (4), measured line box to line box (every face here sets
 * includeFontPadding false, so the line box is the glyph box). The scale has
 * no 6; 2 (`hair`) is what made the lines read as a block with no rhythm, and
 * 8 would spend 16dp of card on air across the column.
 */
const ROW_LINE_GAP = TOKENS.space['2xs'];

/**
 * The CTA's height, and the one number in this card that is NOT the reference.
 *
 * Astrotalk's `call_rl` measures 36.0dp on the Redmi. Amit: "48dp". He is right
 * and the platform agrees — "we recommend that each interactive UI element have
 * a focusable area, or touch target size, of at least 48dp x 48dp"
 * (https://developer.android.com/guide/topics/ui/accessibility/apps) — and this
 * one really is tappable, so the 48 applies with full force. A 36dp button is
 * the reference being wrong.
 */
export const ROW_CTA_HEIGHT = TOKENS.interaction.minTarget;

/**
 * The CTA's DRAWN height: 33dp, Bluesky's small button (Amit, 2026-09-26:
 * "smaller, from our system's small button"). Bluesky's `size="small"` is 12dp
 * of horizontal and 8dp of vertical padding around semibold `text_sm` (13.1 on
 * a 17 line), so 8 + 17 + 8 = 33 — derived from the same tokens here rather
 * than written down. Was 36, Astrotalk's `call_rl`.
 *
 * The 48dp TARGET is unchanged, and still met two ways so the smaller drawing is
 * not an a11y regression: the slot it is centred in (`ctaSlot`) stays
 * `ROW_CTA_HEIGHT` (48) tall, and the Pressable's `size` turns the difference
 * into `hitSlop`,
 * max(8, ceil((48 - 33) / 2)) = 8 on every side, a 49dp target — "we recommend
 * that each interactive UI element have a focusable area, or touch target size,
 * of at least 48dp x 48dp"
 * (https://developer.android.com/guide/topics/ui/accessibility/apps).
 * Since 2026-09-27 the slot lays out at THIS, the drawing, and its 48dp box
 * bleeds past it (ROW_CTA_BLEED), so the target is still a real 48dp box while
 * the button takes no more of the card than it draws.
 *
 * A FIXED SHAPE, 108 × 36 (Amit, S22, 2026-09-27: "cta has become too tall..
 * aspect ratio of cta should not change.. astrotalk is also not taller").
 * The hug-content version measured 74 × 48 DRAWN on the device: with only a
 * minHeight and no size of its own, the button stretched to its 48dp slot, so
 * the target was painted. 36 is the height this button had before and
 * Astrotalk's `call_rl` (35.6); 108 fits the widest state ("Notified" with
 * its check, about 105) so Call, Notify and Notified are one shape. The
 * target stays 48, invisible, through the slot and hitSlop.
 */
export const ROW_CTA_VISUAL_HEIGHT = 36;
export const ROW_CTA_WIDTH = 108;

/**
 * How far the CTA slot's 48dp TARGET box bleeds past its 33dp DRAWING, top
 * and bottom: (48 - 33) / 2 = 7.5.
 *
 * The slot keeps its 48 so the CTA's hitSlop has a real box to land in (hitSlop
 * cannot reach past a parent on Android). What changes is what the slot COSTS
 * the tail row: a negative margin of this much each side lays it out at 33,
 * less than the two text lines beside it, so the button never sets the row's
 * height. The margin sits on the plain `ctaSlot` View, not on the Pressable,
 * for the reason HomeScreen's `seeAllBleed` records: Pressable moves minHeight
 * to its root and leaves margins on its inner view, so a margin there shrinks
 * only the inside.
 */
const ROW_CTA_BLEED = (ROW_CTA_HEIGHT - ROW_CTA_VISUAL_HEIGHT) / 2;

/**
 * The category line's box: its glyph's, `icon.sm` (16) at ICON_SCALE, which
 * `Icon` rounds to 19 and which is taller than the 17dp word beside it, so it
 * is the line's height. The uniform gap above it is measured to this box.
 */
const ROW_CATEGORY_LINE = Math.round(TOKENS.icon.sm * ICON_SCALE);

/**
 * The tail: "Exp" and the category line, the two lines the CTA is centred
 * across. 16 + 4 + 19 = 39, and the CTA slot's laid-out 33 fits inside it,
 * which is what keeps the button from growing the text column.
 */
const ROW_TAIL =
  TOKENS.typography.bodySmall.lineHeight + ROW_LINE_GAP + ROW_CATEGORY_LINE;

/**
 * The wait line's distance under the busy button's drawn edge: `hair` (2), not
 * the 4 between text lines, because it belongs to the button rather than to
 * the column. It reads as the button's caption.
 */
const BUSY_LINE_GAP = TOKENS.space.hair;

/**
 * The outline, drawn INSIDE the 33 rather than around it, and drawn by its own
 * layer (`ctaOutline`) rather than by the button's `borderWidth`.
 *
 * A layer because the press has to be able to take it away (Amit, on the S22,
 * 2026-09-27): a border on the button itself stays painted while the fill fades
 * in over it, and in dark that left a peach step-300 rim round the solid coral.
 * As its own view it can fade out in step with the fill; see `ctaOutline`.
 *
 * The geometry is unchanged. The layer sits absolutely over the button's
 * padding box, so the 1dp stroke draws over the outermost dp of Bluesky's 8/12
 * padding: 1 + 7 + 17 + 7 + 1 = 33, the same pixels the in-box border drew.
 * The padding is the full 8/12 now because nothing in the layout takes the
 * stroke's width any more.
 */
const CTA_STROKE = 1;
const CTA_PAD_Y = TOKENS.space.xs;
const CTA_PAD_X = TOKENS.space.sm;

/**
 * The CTA glyph's `size`, chosen so its box IS the label's line box: 17 / 1.2,
 * which `Icon` renders at Math.round(17 / 1.2 * 1.2) = 17dp. `TOKENS.icon.sm`
 * would render 19 (16 x ICON_SCALE) and, as the tallest thing in the row, set
 * the button to 35 instead of 33. At 17 the phone inks 800/1000 of its em,
 * 13.6dp, beside a 13.1dp label, which is the glyph-to-text weight a small
 * button wants.
 */
const CTA_ICON_SIZE = TOKENS.typography.textSmSemiBold.lineHeight / ICON_SCALE;

/**
 * The press FILL (Amit, 2026-09-26: the CTA "fills up on click", solid while
 * pressed). Timings from animate-expo's press row, 100-150ms, on its strong
 * ease-out, which this repo names EASE_OUT_QUINT (0.23, 1, 0.32, 1); motion.ts's
 * own `EASE_OUT` is the weaker CSS curve.
 *
 * ASYMMETRIC, on purpose. In is `pressRamp` (100): the fill is the answer to the
 * finger landing, and it has to arrive while the finger is still there. Out is
 * half as long again, 150, still inside the press band, so a quick tap (a
 * finger down for 60-80ms) still sees the fill land before it drains instead of
 * a one-frame flash.
 *
 * `ReduceMotion.System` makes both a jump under the OS "remove animations"
 * setting: the fill still appears and empties, it just does not tween.
 */
const CTA_FILL_IN = {
  duration: DURATION.pressRamp,
  easing: EASE_OUT_QUINT,
  reduceMotion: ReduceMotion.System,
} as const;
const CTA_FILL_OUT = {
  duration: DURATION.pressRamp * 1.5,
  easing: EASE_OUT_QUINT,
  reduceMotion: ReduceMotion.System,
} as const;

/**
 * The glyph in front of each verb. Keyed by the label so a new verb fails to
 * compile here rather than rendering without one.
 */
const CTA_VERB_ICON = {
  Call: 'call',
  Chat: 'chat',
  Video: 'video',
  Notify: 'bell',
} as const satisfies Record<string, IconName>;

/**
 * THE VERIFIED SEAL IS AS TALL AS THE NAME'S CAPITALS (Amit, 2026-09-26: "with
 * height equal to the first capital letter of the name").
 *
 * Measured from the two fonts, not eyeballed, and RE-DERIVED 2026-09-27 when
 * the name went from titleMediumEmphasized (Geist-Bold 16) to textXlSemiBold
 * (Geist-SemiBold 18.8, Bluesky alf text_xl; Amit's call):
 *
 *   Geist cap height    OS/2 sCapHeight 710 / unitsPerEm 1000 = 0.71 em, the
 *                       same in the SemiBold and the Bold cut
 *   name cap height     0.71 x textXlSemiBold 18.8 = 13.35dp
 *   seal ink            `seal-check-fill` in assets/fonts/Phosphor.ttf spans
 *                       y 52..948 of a 1000 em (fontTools glyph bounds), 0.896 em
 *   glyph box           13.35 / 0.896 = 14.90 -> 15dp, since `Icon` rounds its
 *                       box to a whole dp (Math.round(size x ICON_SCALE))
 *   drawn seal          15 x 0.896 = 13.44dp
 *
 * 13.44 against 13.35 is 0.09dp over (a quarter of a pixel at the S22's
 * density), and over is the correct side: a round shape set beside flat-topped
 * capitals has to overshoot them to LOOK the same height, which is why a type
 * designer's O is taller than their H. 14dp would have drawn 12.54, visibly
 * short. (At the old 16dp name it was a 13dp box drawing 11.65.)
 *
 * `__tests__/providerRow.test.ts` reads both numbers out of the .ttf files, so
 * a regenerated icon font or a type-scale change fails there rather than
 * leaving this arithmetic describing a glyph that has moved.
 */
const GEIST_CAP_HEIGHT = 0.71;
const SEAL_INK_BOTTOM = 0.052;
const SEAL_INK_TOP = 0.948;
const NAME_CAP_HEIGHT = GEIST_CAP_HEIGHT * TOKENS.typography.textXlSemiBold.fontSize;
export const VERIFIED_SEAL_PX = Math.round(NAME_CAP_HEIGHT / (SEAL_INK_TOP - SEAL_INK_BOTTOM));
export const VERIFIED_SEAL_SIZE = VERIFIED_SEAL_PX / ICON_SCALE;

/**
 * ...AND IT SITS ON THE BASELINE, not in the middle of the line box.
 *
 * The name line aligns its children on their baselines (`alignItems:
 * 'baseline'`, which Fabric resolves from each Text's first-line ascent). The
 * icon font has ascent 1000 / descent 0 and `Icon` sets lineHeight equal to
 * fontSize, so the seal's box bottom IS its baseline, and baseline alignment
 * puts that bottom on the name's baseline. The glyph's ink starts 52/1000 of the
 * em above that bottom, so a translate of 0.052 x 15 = 0.78dp lands the ink
 * itself on the baseline, and its top at the cap line plus the overshoot above.
 * A transform, so the 0.78dp moves pixels and not the row's layout.
 */
const SEAL_BASELINE_SHIFT = SEAL_INK_BOTTOM * VERIFIED_SEAL_PX;

/** The card's inner padding. Astrotalk insets its avatar 12dp from the card. */
const CARD_PAD = TOKENS.space.sm;

/**
 * Card-to-card gap. Astrotalk's is 9.1dp between one card and the next; `xs`
 * (8) undershot that, and Amit asked for it to read closer to Astrotalk's
 * spacing ("gap between cards should be more like astrotalk"). `sm` (12) is
 * the nearest step on the token scale to 9.1 that is not a hand-picked
 * in-between value.
 */
export const ROW_CARD_GAP = TOKENS.space.sm;

/**
 * The card's laid-out height, DERIVED rather than written down, so the list's
 * `overrideItemLayout` hint cannot drift away from the row it describes.
 *
 * It drifted already: HomeScreen told FlashList `size = 97` in both of its
 * `overrideItemLayout` callbacks, a number from before this row grew a meta
 * strip. FlashList v2 measures real cells, so the hint is an estimate it
 * refines rather than a constraint it enforces — a wrong one costs scrollbar
 * and scroll-to-index accuracy, not correctness, which is exactly why nobody
 * noticed for as long as nobody did.
 *
 * TWO COLUMNS, every gap between text lines the one ROW_LINE_GAP (4), and since
 * 2026-09-27 (Amit, Astrotalk's placement) the CTA is no longer a line at all:
 * it sits at the right of the last two lines, centred across them, in a slot
 * that lays out shorter than they are.
 *
 *   right  name 24 · 4 · specialities 16 · 4 · langs 16 · 4 · exp 16 · 4 · category 19 = 107
 *   left   ring 84 · 8 · stars 14 · 4 · count 16                                     = 126
 *
 * History, so the next change can see the trend:
 *   09-26  name 24 · 2 · tags 24 · 2 · langs 16 · 2 · exp 16 · 2 · CTA row 48 = 136  card 160
 *   09-27  uniform 4dp gaps, CTA row at its drawn 33                        = 121  card 155.5
 *   09-27  CTA beside exp + category, category its own line                 = 107  card 150
 *
 * `__tests__/providerRow.test.ts` pins the arithmetic from the tokens, so a
 * change to the type scale fails there rather than silently mis-hinting the
 * list.
 */
export const PROVIDER_ROW_RIGHT_COLUMN =
  TOKENS.typography.textXlSemiBold.lineHeight +
  ROW_LINE_GAP +
  TOKENS.typography.bodySmall.lineHeight +
  ROW_LINE_GAP +
  TOKENS.typography.bodySmall.lineHeight +
  ROW_LINE_GAP +
  ROW_TAIL;

/**
 * The last text line's centre (the category line), from the top of the right
 * column: 107 - 19 / 2 = 97.5. The horizon the star row is aligned to.
 */
const ROW_LAST_LINE_CENTRE = PROVIDER_ROW_RIGHT_COLUMN - ROW_CATEGORY_LINE / 2;

/**
 * The left column's height: the stars-and-count block at the bottom, with the
 * star row on the last text line's centre, unless that would crowd the ring.
 *
 * Amit, on the device: "strats should align with rate.. pls see how astrotalsk
 * proved space and alignment" — and the reference does align them: its
 * `average_ratingbar` sits at y384.4 and its `price` at y386.5, so the rating
 * and the line beside it read as one line across the card. The line beside
 * them is the category now (the lowest text line, 2026-09-27), not the CTA.
 *
 * The column pushes exactly two children apart (`justifyContent:
 * 'space-between'`): the ring to the top, the stars-and-count block to the
 * bottom. Exact alignment would want the column 97.5 + 7 + 4 + 16 = 124.5
 * tall, which leaves the ring only 6.5 clear of the stars, under Amit's 8
 * (RING_TO_STARS). The FLOOR wins, 84 + 8 + 14 + 4 + 16 = 126, and the star
 * row's centre lands at 99, 1.5dp under the category line's: inside the 2dp
 * this card has always allowed the two (it was 111 against 112 at 136), and
 * the price of keeping the ring's breathing room.
 *
 * So the LEFT column sizes the card, and the review count is its lowest line,
 * hanging under the last text line the way Astrotalk's "orders" line hangs
 * under its price. The busy wait line hangs into the same space on the right
 * (see ROW_BUSY_LINE_BOTTOM).
 */
export const PROVIDER_ROW_LEFT_COLUMN = Math.max(
  // Aligned: the star row's centre on the last text line's.
  ROW_LAST_LINE_CENTRE +
    STARS_HEIGHT / 2 +
    ROW_LINE_GAP +
    TOKENS.typography.bodySmall.lineHeight,
  // The floor: never closer to the ring than Amit's 8. The term in force today.
  ROW_AVATAR_RING +
    RING_TO_STARS +
    STARS_HEIGHT +
    ROW_LINE_GAP +
    TOKENS.typography.bodySmall.lineHeight,
);

/**
 * Where the busy wait line ends, from the top of the right column: the tail's
 * centre plus half the button, the gap and the textXs line,
 * (107 - 39 / 2) + 33 / 2 + 2 + 15 = 121. The test holds it inside the card's
 * content height, so the line can hang out of the text column without ever
 * hanging out of the card.
 */
export const ROW_BUSY_LINE_BOTTOM =
  PROVIDER_ROW_RIGHT_COLUMN -
  ROW_TAIL / 2 +
  ROW_CTA_VISUAL_HEIGHT / 2 +
  BUSY_LINE_GAP +
  TOKENS.typography.textXs.lineHeight;

/**
 * The card itself, without the gap under it: the taller column plus padding.
 * `Math.max` rather than naming the left column, so a future right-column line
 * grows the card instead of spilling out of it.
 */
export const PROVIDER_CARD_HEIGHT =
  CARD_PAD * 2 + Math.max(PROVIDER_ROW_LEFT_COLUMN, PROVIDER_ROW_RIGHT_COLUMN);

/** What the list must reserve per item: the card plus the gap beneath it. */
export const PROVIDER_ROW_HEIGHT = PROVIDER_CARD_HEIGHT + ROW_CARD_GAP;


/**
 * A directory card, copied from Astrotalk with Clarity's expertise pills.
 *
 * Amit, 2026-09-08: "exactly copy the astrotalk -- why to deviate.. jsut add
 * expertise from clarity.. astrotalk also has expertise just below the name",
 * and "take all line items as is".
 *
 * MEASURED, NOT EYEBALLED. Astrotalk is installed on the Redmi, so the
 * reference was read with `adb exec-out uiautomator dump` at density 440
 * (2.75 px/dp), not from a screenshot. Its line items, in order, with the
 * measurements this card is built to:
 *
 *   nameET     y295.3 h25.5   "Ritu Ji"
 *   skillET    y323.3 h17.1   "Vedic,  AI Astrologer"    → our expertise pills
 *   language   y344.4 h17.1   "English, Hindi"
 *   expET      y365.5 h17.1   "Exp- 14 Years"
 *   price      y386.5 h21.8   "₹ 24 ₹ 5" + "/min"
 *   ratingbar  y384.4 80×16   under the avatar
 *   orders     y402.5 h16.7   "10k+ orders"              → our review count
 *   call_rl    y361.5 95.3×36 the CTA
 *   card       h171.3, pitch 180.4, avatar 72 in a 76.4 ring
 *
 * IT IS A CARD, which is the deviation that got reversed. This list was on
 * hairline-divided rows, on the argument that a member moves between it and the
 * inbox constantly and two list idioms read as two apps. Amit overruled it —
 * "why to deviate" — and the reference is unambiguous: cards, not rows.
 *
 * FOUR DEPARTURES SURVIVE, each of them Amit's own instruction rather than my
 * judgement:
 *
 *   1. A 48dp CTA target around a 33dp drawing. See ROW_CTA_VISUAL_HEIGHT.
 *   2. No struck-through price ON SCREEN. Astrotalk shows "₹ 24 ₹ 5/min" with
 *      the first crossed out; we have one undiscounted rate, so an anchor would
 *      be invented. `RateLabel` has the slot for one (2026-09-26) so a real
 *      discount can land without re-laying the name line, and nothing fills it.
 *   3. The rate is on the NAME line, right-aligned, not in the CTA or on a
 *      price line of its own (Amit, 2026-09-26).
 *   4. Expertise as plain comma text rather than a pill row.
 *
 * THE RATING IS MANUFACTURED for a provider with fewer than 50 genuine ones.
 * That is a product decision, taken deliberately; `src/lib/systemRating.ts`
 * holds the numbers, the switch and the argument, and this card reads it
 * through one function so the decision cannot leak into a second
 * implementation.
 */
interface RateLabelProps {
  /** ₹ per minute, the rate a call is billed at. */
  rate: number;
  /**
   * A pre-discount rate, struck through BEFORE `rate`: Astrotalk's
   * "₹24 ₹5/min". The slot exists so a discount can be shown later without
   * re-laying the name line. NOTHING passes it today, because there is no
   * discount data source, and an anchor price with no discount behind it is an
   * invented claim (departure 2 in the header below).
   */
  original?: number;
  style: StyleProp<TextStyle>;
  /** The struck figure's own ink: muted, and line-through. */
  originalStyle: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * "₹22/min" on the name line, one Text so the figure, the struck anchor (if
 * any) and the suffix share a baseline and truncate as one. The digits go
 * through `RupeeAmount`, so the ₹ keeps its lighter weight and `formatRupees`
 * stays the one place that knows how a rupee figure is written.
 */
function RateLabel({ rate, original, style, originalStyle, testID }: RateLabelProps) {
  return (
    <Text allowFontScaling numberOfLines={1} style={style} testID={testID}>
      {original !== undefined ? (
        <>
          <RupeeAmount value={original} style={originalStyle} />
          {' '}
        </>
      ) : null}
      <RupeeAmount value={rate} />
      {'/min'}
    </Text>
  );
}

function ProviderRowView({
  provider,
  index,
  isLast,
  onPress,
  onPressAvatar,
  onCall,
  ratePerMin,
  animateEntrance = true,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const initial = initialOf(provider.display_name);
  // First name only, on every surface a member reads (display.ts).
  const firstName = providerFirstName(provider.display_name);

  /*
   * The expertise line. Category leads when there are no tabs above the list to
   * say it (search), because it is a fact about this person of exactly the tag
   * kind and belongs in the same line rather than in a second one.
   *
   * `rowExpertise` caps and dedupes; the slice after it keeps the total at
   * three so a categorised search row does not run four pills wide.
   */
  /*
   * The expertise pills. The CATEGORY used to lead this line in search, and no
   * longer does: Amit, 2026-09-08, "there should be tag of listener /
   * astrologer on proile like truemittr shows - place this where price is". It
   * has its own slot now, on every card rather than only in search, so the
   * `showCategory` prop is gone with it.
   *
   * That is a better place for it than the head of the pill row, where it
   * competed with the topics for the three slots and pushed a real one off in
   * search — the one screen where the topics matter most.
   */
  const tags = rowExpertise(provider);
  const categoryKey = categoryOf(provider);
  const category = CATEGORY_BADGE[categoryKey];

  /*
   * What sits on the expertise line when a provider has no tags.
   *
   * The line cannot collapse — its height is part of the promise
   * `PROVIDER_ROW_HEIGHT` makes to FlashList, and a card that keeps that
   * promise only for tagged providers does not keep it — so it needs content.
   * The headline is the right content: the provider's own sentence about
   * themselves, which is what this row showed before the pills took the slot.
   */
  const headline =
    provider.headline !== null && provider.headline.trim() !== ''
      ? provider.headline
      : 'Here to listen';

  const languages = provider.languages.slice(0, 3).join(', ');
  const years = seededExperienceYears(provider.id);
  const rating = displayRating(provider);
  const letter = genderLetter(provider.gender);

  /**
   * TWO QUESTIONS, TWO COLUMNS (2026-09-27, migration 155).
   *
   * The DOT (and its spoken line) is "are they here right now": the server's
   * `online`, which is the switch open AND a heartbeat within 75 s AND no
   * offline since, or else their last seen. `readPresence` is the one reading
   * of it, so this row, the rail, the inbox and the chat header cannot
   * disagree.
   *
   * The CTA (`away` below) is "can I reach them": the master switch,
   * `is_available`, as it has been since 2026-09-17. A provider with the
   * switch on who has not opened the app in the last 75 s is still callable,
   * and the call rings their phone; reading the heartbeat there would put a
   * Notify on somebody who would pick up.
   */
  const presence = readPresence({
    online: provider.online,
    lastSeenAt: provider.last_seen_at,
    now: new Date(),
  });

  /*
   * The CTA calls, unless this provider does not take calls.
   *
   * `audio_enabled` is migration 064's provider-owned switch. A Call button on
   * somebody who has switched calls off would fail at `start_call` after the
   * tap, which is the false-affordance class this codebase has now removed
   * twice — the composer's "costs one token" hints and the price line's phone
   * glyph. So the label follows the capability, and the action follows the
   * label.
   */
  /*
   * AWAY REPLACES THE CTA WITH A BELL (Amit, 2026-09-13: "For offline girls
   * there should be CTA to notify replacing call with bell glyph").
   *
   * A Call button on somebody who is not there is the same false affordance the
   * `audio_enabled` check below already removes — the tap would ring a phone
   * nobody is holding. "Notify" is the honest action, and it is one the server
   * already performs: opening the conversation calls `announce_chat_open`
   * (migration 068), which pushes to the peer precisely when they are away, the
   * member has a minute, and no session is running. So the bell does not need a
   * new endpoint; it names what already happens and stops the row promising a
   * call instead.
   *
   * Every state has a glyph now, not only this one: the "no glyph in front of
   * the label" rule was reversed on 2026-09-26 (see the CTA below). The bell
   * still says something the others do not, that this is a different KIND of
   * action from the one the other rows offer.
   *
   * The switch, not the dot: see `presence` above.
   */
  const away = !provider.is_available;
  const canCall = provider.audio_enabled && onCall !== undefined && !away;
  /*
   * BUSY: here, but in a session with someone else (Amit, 2026-09-27). Away
   * outranks it, because a provider who is not here is not "busy" in any sense
   * a member can wait out; the Notify route is the honest one then. The verb
   * and the action do not change, only the ink and the wait line: the tap
   * still does what the label says, and the member decides whether ~12m is
   * worth it.
   */
  const busy = away ? null : readBusy(provider);
  /*
   * WHICH CHANNEL THE ONE BUTTON NAMES, when it cannot dial.
   *
   * The row has a single CTA and the provider may offer any of seven channel
   * sets (064's CHECK forbids the eighth), so "Chat" was a false affordance on
   * anyone who had switched chat off — the same class as the Call it already
   * guards. The verb names a channel they actually offer, and a tap that is not
   * a dial lands on `onPress`, which is the profile: the one surface that can
   * render the whole offered set.
   */
  const ctaLabel = providerCtaLabel({
    isAvailable: provider.is_available,
    audioEnabled: provider.audio_enabled,
    chatEnabled: provider.chat_enabled,
    canDial: onCall !== undefined,
  });
  const ctaSpoken =
    ctaLabel === 'Call'
      ? `Call ${firstName}`
      : ctaLabel === 'Video'
        ? `Video call ${firstName}`
        : `Message ${firstName}`;
  /*
   * "Voice calls only" and the rest, in the slot directly under the name.
   *
   * It TAKES that slot rather than adding a line, and the trade is deliberate:
   * every dimension of this card is a promise to FlashList
   * (`PROVIDER_ROW_HEIGHT`), a sixth line would break it for exactly the
   * providers who have a limit to declare, and what a member can do with
   * somebody outranks the topics they cover on a card whose button has already
   * narrowed to one verb.
   */
  const channelLine = away ? null : offeredChannelsLine(provider);

  /*
   * THE BELL NOW RINGS FROM HERE.
   *
   * It did not before, and the comment above was describing an intention rather
   * than the code: the CTA fell through to `onPress(provider.id)`, the same
   * handler the whole card fires, so tapping "Notify" was indistinguishable from
   * tapping anywhere else on the row and the RPC only ran later, from
   * the chat's controller. `useNotifyProvider` performs `announce_chat_open`
   * in place and leaves the member in the list, which is the only arrangement in
   * which this control can have a state to show.
   *
   * WHEN THE PEER TURNS OUT TO BE HERE, this row does NOT keep a local override.
   * The hook invalidates the directory query, `is_available` comes back on, and
   * `away` above goes false on the next render — so the row swaps to Call
   * through the single reading of availability it already has, rather than growing a
   * second answer to the same question beside it.
   *
   * AND IT SURVIVES A COLD START. The state is restored from the server's own
   * record of the push (`conversation_thread_meta.provider_alerted_at`, 068) by
   * `useNotifyProvider` itself, so this file gains persistence without gaining
   * a line: a relaunched app draws "Notified" for the thirty minutes the server
   * would refuse a second doorbell, and "Notify" the moment it would not.
   *
   * The cooldown is still only SPOKEN here, per the note on the label below.
   * The row CTA is a small button that hugs its label, and restoring a state
   * does not buy it any more room than earning one did.
   */
  const notify = useNotifyProvider(provider.id);
  const notified = notify.state.kind === 'notified';
  const notifyAgainIn =
    notify.state.kind === 'notified' ? minutesUntil(notify.state.cooldownUntil) : null;

  /*
   * What the button says and shows. The present participle while the request is
   * in flight, the same contract Button.busyLabel has (Button.tsx:17-21): a
   * control that compresses and says nothing tells a member their tap was felt
   * but not what it started. The bell becomes a check once they have been told:
   * same slot, same size, the control is reporting rather than growing.
   */
  const ctaText =
    notify.state.kind === 'pending' ? 'Notifying' : notified ? 'Notified' : ctaLabel;
  const ctaIcon: IconName = notified ? 'check' : CTA_VERB_ICON[ctaLabel];

  /*
   * The press fill's progress, 0 resting to 1 solid. A shared value on the UI
   * thread, driven from press-in and press-out (twice per press, never per
   * frame), and read only inside the worklet below. It drives ONE property, the
   * opacity of a pre-painted solid face laid over the outlined one; see
   * `ctaFill` in the styles for why that is the colour interpolation itself
   * rather than an approximation of it.
   */
  const fill = useSharedValue(0);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));
  /*
   * The resting outline, going the other way on the same value, so the pressed
   * button is ONE solid shape with no rim (see `ctaOutline`). Still opacity
   * only, still one shared value: the two faces cannot drift out of step.
   */
  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.get() }));

  /*
   * THE CTA'S COLOUR IS ITS STATE (Amit, 2026-09-27): green while free, garnet
   * while busy, the neutral while away. Coral stopped being the directory CTA
   * colour: a list of coral buttons put the brand on every row, where the
   * state is what a member is scanning for. One lookup, so the resting ink,
   * the outline and both pressed layers cannot disagree about which state
   * they are drawing.
   */
  const ctaTone = away
    ? {
        outline: styles.ctaOutlineAway,
        label: styles.ctaAwayLabel,
        fill: styles.ctaFillAway,
        fillLabel: styles.ctaFillAwayLabel,
      }
    : busy !== null
      ? {
          outline: styles.ctaOutlineBusy,
          label: styles.ctaBusyLabel,
          fill: styles.ctaFillBusy,
          fillLabel: styles.ctaFillLabel,
        }
      : {
          outline: styles.ctaOutlineFree,
          label: styles.ctaFreeLabel,
          fill: styles.ctaFillFree,
          fillLabel: styles.ctaFillLabel,
        };

  /*
   * The category's ink, keyed by the category so a third one added to
   * migration 065 fails to compile here rather than rendering uncoloured.
   */
  const categoryInk: Record<ProviderCategory, TextStyle> = {
    listener: styles.categoryListener,
    astrologer: styles.categoryAstrologer,
  };

  const accessibility = [
    `${firstName}${provider.age !== null ? `, ${provider.age}` : ''}`,
    presenceForSpeech(presence),
    busy !== null ? busyForSpeech(busy) : null,
    channelLine,
    category,
    tags.length > 0 ? tags.join(', ') : headline,
    languages === '' ? null : `speaks ${languages}`,
    `${years} ${years === 1 ? 'year' : 'years'} experience`,
    // Spoken as a sentence: "4.3 stars" beats five unlabelled glyphs, and
    // "₹22/min" is read out as a string of symbols.
    `rated ${rating.score.toFixed(1)} out of 5 from ${rating.count} reviews`,
    `${formatRupees(ratePerMin)} per minute`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View entering={animateEntrance !== false ? rowIn(index) : undefined}>
      <Pressable
        onPress={() => onPress(provider.id)}
        testID={`provider-${provider.id}`}
        accessibilityLabel={accessibility}
        accessibilityHint="Opens the conversation"
        press="none"
        highlight="dim"
        style={[styles.card, isLast && styles.cardLast]}>
        {/* LEFT COLUMN: the ringed avatar, with the stars and the review count
            stacked under it. That is the arrangement that pays for a 76dp
            avatar — at 40dp the rating had to live in the text column as a
            chip, competing with the facts. */}
        <View style={styles.leftColumn}>
          {/* The avatar is its own target: it opens the profile card, while the
              rest of the card opens the conversation. Nested inside the card
              Pressable, the inner one captures taps that land on the photo. */}
          <Pressable
            onPress={() => (onPressAvatar ?? onPress)(provider.id)}
            testID={`provider-avatar-${provider.id}`}
            accessibilityLabel={`${firstName}'s profile`}
            // Folded into the card for TalkBack: the avatar is a sighted-tap
            // shortcut to the profile, not a second focus target overlapping
            // the card. The card's own label already carries who this is.
            accessible={false}
            press="none"
            style={styles.ring}>
            <Avatar
              initial={initial}
              uri={provider.avatar_url}
              size={ROW_AVATAR}
              online={presence.here}
            />
          </Pressable>
          {/* Stars and count as ONE block, so the column has exactly two
              children for `space-between` to push apart: the ring to the top,
              this to the bottom, level with the price. */}
          <View style={styles.ratingBlock}>
            <RatingStars score={rating.score} testID={`provider-stars-${provider.id}`} />
            {/* The count is unconditional, so a provider with no reviews
                occupies the same 16dp as one with ten thousand. A column that
                changes height between rows is the invariant this list is built
                on, broken. */}
            <Text allowFontScaling numberOfLines={1} style={styles.reviews}>
              {`${formatReviewCount(rating.count)} reviews`}
            </Text>
          </View>
        </View>

        {/* RIGHT COLUMN: Astrotalk's five line items, in Astrotalk's order. */}
        <View style={styles.label}>
          <View style={styles.nameLine}>
            <Text
              maxFontSizeMultiplier={TOKENS.fontScaleCap.textXlSemiBold}
              allowFontScaling
              numberOfLines={1}
              style={styles.name}>
              {firstName}
              {provider.age !== null ? (
                /* "F-24", Astrotalk's shorthand. The letter is dropped for
                   'other' and for null rather than guessed — see
                   `genderLetter`. */
                <Text style={styles.nameAge}>
                  {` ${letter === null ? '' : `${letter}-`}${provider.age}`}
                </Text>
              ) : null}
            </Text>
            {/* The certified badge, Clarity's.
                ONE GLYPH. It was first built as our own `check` inside a filled
                accent disc — two shapes stacked to approximate a shape the icon
                set already had. Amit: "certified icon should be like
                clarity". The scalloped rosette with the check inside is the
                mark both references draw; Phosphor names it `seal-check`.

                FILLED AND BLUE since 2026-09-26 (Amit: "replace our seal check
                with phosphor seal check in blue colour, filled, with height
                equal to the first capital letter of the name"). `badgeCheck`
                maps to `seal-check-fill` in design/icons.json, regenerated
                rather than hand-edited (RULE 4), and the blue is
                `mark/verified`, Bluesky's own verified blue (design/tokens.json
                carries the measurement). Its size and its seat on the baseline
                are derived from the two fonts: VERIFIED_SEAL_SIZE and
                SEAL_BASELINE_SHIFT above.

                Every card has one, and that is correct rather than lazy:
                `provider_directory` filters on `identity_verified_at is not
                null`, so a provider a member can see has passed the PAN and
                identity check by construction. It is a statement about the
                marketplace, not a ranking within it.

                `accessible={false}`: the card's label would otherwise gain a
                stop that says nothing a member can act on. */}
            <View accessible={false} testID="provider-verified" style={styles.seal}>
              <Icon
                name="badgeCheck"
                size={VERIFIED_SEAL_SIZE}
                color={theme.color.text.available}
              />
            </View>
            {/* The rate, moved out of the CTA onto the name line and pushed to
                the card's right edge (Amit, 2026-09-26). The F-29 subscript's
                own style, `nameAge`, so the two read as one quiet register
                around the name; see `rate` in the styles for the one property
                it does not share. `flexShrink: 0` on it and `flexShrink: 1` on
                the name mean a long name ellipsizes before it can reach the
                rate, with the line's 8dp gap as the least the two keep apart. */}
            <RateLabel
              rate={ratePerMin}
              style={[styles.nameAge, styles.rate]}
              originalStyle={styles.rateOriginal}
              testID={`provider-rate-${provider.id}`}
            />
          </View>

          {/* Expertise, directly under the name — Astrotalk's `skillET` slot.
              PLAIN COMMA TEXT, not pills (Amit, on the S22 with Astrotalk open:
              "exactly the same as astrotalk.. looks crowded and not relaxed",
              then confirmed plain text). Measured the reference on the device:
              its skill/language/exp rows are all plain grey text, and that is
              what makes the card breathe — boxed pills read as busy against it.
              Expertise now matches the language and exp lines: the same
              `secondary` grey text, and since 2026-09-27 the same 16dp line
              box, not the 24dp slot the chips needed (see ROW_LINE_GAP).
              `numberOfLines={1}` is what keeps it one line now, where the
              slot's fixed height and clip used to. `rowExpertise` still caps
              and dedupes the tag set (ROW_EXPERTISE_LIMIT); only the rendering
              changed from chips to a comma join. The category line under Exp
              stopped being a chip too (2026-09-26): coloured text behind a
              filled glyph. */}
          <Text
            allowFontScaling
            numberOfLines={1}
            testID={`provider-tags-${provider.id}`}
            style={channelLine !== null ? styles.channelLine : styles.secondary}>
            {channelLine ?? (tags.length > 0 ? tags.join(', ') : headline)}
          </Text>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {languages === '' ? ' ' : languages}
          </Text>

          {/* THE TAIL: the last two text lines on the left, the CTA on the
              right, centred across both (Amit, 2026-09-27, Astrotalk's
              placement: its `call_rl` straddles the experience and price
              lines at the card's right edge). The CTA used to own a 48dp row
              of its own under these lines; now the lines run on in the one
              4dp rhythm and the button sits beside them without adding a
              line. See `ctaSlot` for how it avoids inflating the column. */}
          <View style={styles.tail}>
            <View style={styles.tailLines}>
              <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
                {`Exp · ${years} ${years === 1 ? 'year' : 'years'}`}
              </Text>
              {/* Listener / Astrologer, on EVERY card — the tab above Explore
                  already says which you are looking at, but search spans both
                  and a member should not have to remember which list they are
                  in to know what they are buying.

                  A PLAIN TEXT LINE under Exp since 2026-09-27, the same 4dp
                  under it as every other line; it shared the CTA's row before.
                  Not a chip since 2026-09-26 (Amit): coloured text behind a
                  filled glyph, the "trophy + Wellness Guide" idiom. Hue tells
                  the two apart down a scrolling column, and the glyph says it a
                  second way (lotus, moon-stars) for anyone who does not
                  separate the hues. The ink is `text/listener` /
                  `text/astrologer`, the text-safe member of each category pair
                  on the card, registered in scripts/check-contrast.mjs. */}
              <View accessible={false} testID="provider-category" style={styles.category}>
                <Icon
                  name={categoryKey}
                  size={TOKENS.icon.sm}
                  color={categoryInk[categoryKey].color as string}
                />
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  style={[styles.categoryLabel, categoryInk[categoryKey]]}>
                  {category}
                </Text>
              </View>
            </View>
            <View style={styles.ctaSlot}>
              {/* The state swap, keyed so it runs once per transition and never
                  on a re-render or on a recycled cell that lands on the same
                  state. `fadeSwapOutFast` is the existing builder for a button
                  label that just narrated itself (motion.ts): DURATION.fast,
                  EASE_OUT, opacity only, `reduceMotion(ReduceMotion.System)`.
                  The whole control fades through rather than its pieces
                  separately, because it is one object changing its mind.

                  A live region, because a focused control whose label changes
                  does not announce on its own, and Android 16 deprecates
                  announceForAccessibility in favour of exactly this.
                  https://developer.android.com/about/versions/16/behavior-changes-all

                  OFF WHILE IDLE, and on a list that is the difference between a
                  useful announcement and an unusable one: a live region speaks
                  when its content ARRIVES as well as when it changes, and in a
                  recycled list rows arrive continuously under the finger.
                  Polite only once this control has something to report. */}
              <Animated.View
                key={notify.state.kind}
                exiting={fadeSwapOutFast}
                accessibilityLiveRegion={notify.state.kind === 'idle' ? 'none' : 'polite'}>
                <Pressable
                  onPress={() =>
                    away
                      ? notify.notify()
                      : canCall && onCall !== undefined ? onCall(provider.id) : onPress(provider.id)
                  }
                  /* Feedback on press-in, commit on press-out (animate-expo
                     §7): the fill starts the moment the finger lands, and the
                     action still only fires on a completed tap. Press-out
                     drains it on every release, including a cancelled one. */
                  onPressIn={() => fill.set(withTiming(1, CTA_FILL_IN))}
                  onPressOut={() => fill.set(withTiming(0, CTA_FILL_OUT))}
                  busy={notify.state.kind === 'pending'}
                  testID={`provider-cta-${provider.id}`}
                  /* The cooldown is SPOKEN here and DRAWN on the profile, which
                     is the one asymmetry in this pair of surfaces and is
                     deliberate: this control is a small button on a row whose
                     every dimension is a promise to FlashList, and "Notified
                     again in 12m" does not belong in it at any type size. The
                     profile's Notify button is full width and shows the same
                     fact in words. The busy wait is drawn AND spoken, because
                     it has a line of its own under the button. */
                  accessibilityLabel={
                    notified
                      ? `${firstName} has been notified${
                          notifyAgainIn === null ? '' : `, again in ${notifyAgainIn}m`
                        }`
                      : away
                        ? `Notify ${firstName} that you want to chat`
                        : busy !== null
                          ? `${ctaSpoken}, ${busyForSpeech(busy)}`
                          : ctaSpoken
                  }
                  /* No scale and no state layer (`highlight="none"`): the fill
                     IS the press feedback, and a 3% squeeze or a grey dim on
                     top of it would be two answers to one touch. */
                  press="none"
                  highlight="none"
                  // `size` is how this Pressable meets the 48dp target — it
                  // turns the 33dp drawn button into a 49dp focusable area via
                  // hitSlop, without inflating the visual (Pressable.tsx,
                  // `slop`).
                  size={ROW_CTA_VISUAL_HEIGHT}
                  style={[styles.cta, away && styles.ctaAway]}>
                  {/* The resting outline, as a layer so the press can fade it
                      out. First, so it paints under the glyph and the word. */}
                  <Animated.View
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.ctaOutline, ctaTone.outline, outlineStyle]}
                  />
                  {/* Glyph + verb. Every state leads with its glyph (phone for
                      Call, camera for Video, bubble for Chat, bell for Notify,
                      check once notified), the small-button idiom of Amit's
                      approved mockup (2026-09-26). Resting face: outlined, in
                      the state's ink (green free, garnet busy, neutral away). */}
                  <Icon
                    name={ctaIcon}
                    size={CTA_ICON_SIZE}
                    color={ctaTone.label.color as string}
                  />
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[styles.ctaLabel, ctaTone.label]}>
                    {ctaText}
                  </Text>
                  {/* Pressed face: the same glyph and word on the solid fill,
                      faded in over the resting face by `fill`. Hidden from
                      TalkBack and from touch, because it is a second drawing of
                      the one control, not a second control. */}
                  <Animated.View
                    pointerEvents="none"
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.ctaFill, ctaTone.fill, fillStyle]}>
                    <Icon
                      name={ctaIcon}
                      size={CTA_ICON_SIZE}
                      color={ctaTone.fillLabel.color as string}
                    />
                    <Text
                      allowFontScaling
                      numberOfLines={1}
                      style={[styles.ctaLabel, ctaTone.fillLabel]}>
                      {ctaText}
                    </Text>
                  </Animated.View>
                </Pressable>
              </Animated.View>
              {/* "wait ~12m" (or "Busy" with no estimate), directly under the
                  button in the button's garnet. Out of flow, so it hangs into
                  the space under the category line instead of growing the
                  column; hidden from TalkBack because the CTA's label already
                  says it. */}
              {busy !== null ? (
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  importantForAccessibility="no"
                  testID={`provider-busy-${provider.id}`}
                  style={styles.busyLine}>
                  {busyLine(busy)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const ProviderRow = memo(ProviderRowView);

const makeStyles = (t: Theme) => StyleSheet.create({
  /*
   * A CARD, on a grouped page. Reversed from hairline rows on 2026-09-08 — see
   * the component header.
   *
   * The separation is a hairline border rather than a drop shadow: an Android
   * elevation on a recycled FlashList cell costs an overdraw pass per frame,
   * and the reference's own separation comes from the fill standing against the
   * page, not from a shadow.
   */
  card: {
    flexDirection: 'row',
    // `flex-start`, not `center`: the two columns are different heights by
    // design (126 and 107), and centring would float the text column down
    // from the top of the avatar it sits beside. Astrotalk top-aligns them too.
    alignItems: 'flex-start',
    gap: TOKENS.space.sm,
    padding: CARD_PAD,
    marginHorizontal: TOKENS.space.sm,
    marginBottom: ROW_CARD_GAP,
    borderRadius: TOKENS.radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    backgroundColor: t.color.bg.raised,
  },
  // The last card keeps the height contract but drops the gap, so the list ends
  // on a card rather than on a strip of page colour.
  cardLast: {
    marginBottom: 0,
  },
  /*
   * BOTH DIMENSIONS STATED, and the height is not decoration — without it the
   * rating and the count did not render at all, which is what the first build
   * on the Redmi showed.
   *
   * `Pressable` splits a caller's style: only the BOX keys (width, height,
   * flex*, aspectRatio) reach the touchable root, and everything else moves to
   * an inner view that is given `flexGrow: 1`. The ring set none of them — only
   * a radius, a border and a padding — so the root had no size of its own and
   * took it from an inner view that grows. In a column with no stated height
   * that resolved to the whole column: `uiautomator` reported the avatar's
   * touch node 130.5dp tall inside a 112dp column, and the Text siblings
   * underneath were laid out past the clip and painted nothing.
   *
   * Nothing was wrong with the Texts, which is why this cost a device build to
   * find — the dump listed them, with inverted bounds, while the screen showed
   * neither.
   */
  leftColumn: {
    width: ROW_AVATAR_RING,
    // Sized so the space-between below lands the star row on the last text
    // line, or 8 under the ring if that is lower. See PROVIDER_ROW_LEFT_COLUMN.
    height: PROVIDER_ROW_LEFT_COLUMN,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  /*
   * The ring. `borderWidth` draws inside the box in RN, so an 84 box with a 2dp
   * border has an 80 content area, and `padding: 2` leaves exactly the avatar's
   * 76 — the inset that makes it read as a ring rather than as an outline.
   *
   * `overflow: 'visible'` because the Avatar's presence dot sits just past the
   * circle at the bottom-right, and a rounded box would clip it in half.
   */
  ring: {
    width: ROW_AVATAR_RING,
    height: ROW_AVATAR_RING,
    borderRadius: ROW_AVATAR_RING / 2,
    borderWidth: RING_STROKE,
    borderColor: t.color.bg.accent,
    padding: RING_INSET,
    overflow: 'visible',
  },
  ratingBlock: {
    alignItems: 'center',
  },
  reviews: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
    marginTop: ROW_LINE_GAP,
  },
  // The one gap between every line of the right column. See ROW_LINE_GAP.
  label: {
    flex: 1,
    gap: ROW_LINE_GAP,
  },
  nameLine: {
    flexDirection: 'row',
    // `baseline`, not `center`, since 2026-09-26: three texts in three sizes
    // share this line now (the 18.8dp name, the 12dp rate, the seal glyph), and
    // centring boxes of different heights puts their baselines at three
    // different heights. Fabric resolves a Text's baseline from its first
    // line's ascent (ParagraphShadowNode::baseline), so the rate sits on the
    // name's baseline exactly as the nested F-29 does, at every font scale.
    alignItems: 'baseline',
    // `space.xs` (8), not `space['2xs']` (4). Amit, on the device: "certofied
    // icon spacing also increase a bit like clarity" — Clarity sets its badge
    // well clear of the name, and at 4dp ours read as part of the word.
    gap: TOKENS.space.xs,
    height: TOKENS.typography.textXlSemiBold.lineHeight,
  },
  /*
   * alf text_xl SemiBold, 18.8 on 24 (Amit, 2026-09-27), replacing
   * titleMediumEmphasized's Bold 16 on 24. The line box is the same 24, so the
   * name line and the card height do not move; the seal beside it is
   * re-derived from the new cap height (VERIFIED_SEAL_PX).
   */
  name: {
    ...TOKENS.typography.textXlSemiBold,
    color: t.color.text.primary,
    flexShrink: 1,
  },
  // Age beside the name, subscript — the detail/hero card idiom. Quieter weight
  // and colour so it reads as a modifier of the name, not a second word.
  nameAge: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
  },
  /*
   * The rate takes `nameAge` whole (Amit: the same size and style as "F-29")
   * and overrides ONE property, the ink, which is a contrast fix and not a
   * preference. `text/tertiary` on the card is 4.39:1 light / 3.30:1 dark,
   * which check-contrast.mjs exempts only as glanceable metadata that is never
   * the only carrier of a fact. The age can lean on that; the price cannot: it
   * is the only place on the card that says what a minute costs, and text
   * under 18sp takes 4.5:1
   * (https://developer.android.com/guide/topics/ui/accessibility/apps).
   * `text/secondary` is one step darker and 7.41:1 / 5.00:1, so the two still
   * read as one quiet register at a glance.
   */
  rate: {
    color: t.color.text.secondary,
    marginLeft: 'auto',
    flexShrink: 0,
  },
  // The struck anchor, when one is ever passed: muted AND struck, so it cannot
  // be read as the price. Not the only carrier of anything, the rate after it is.
  rateOriginal: {
    color: t.color.text.tertiary,
    textDecorationLine: 'line-through',
  },
  // The 0.68dp that lands the seal's ink, rather than its box, on the baseline.
  // See SEAL_BASELINE_SHIFT.
  seal: {
    transform: [{ translateY: SEAL_BASELINE_SHIFT }],
  },
  secondary: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  /*
   * The channel limit, in the tag line's slot and a step louder than it. It is
   * standing in for facts a member can skim past; this one changes what the
   * button beside it will do, so it takes the primary ink the name has rather
   * than the grey the tags and languages share.
   */
  channelLine: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.primary,
  },
  /*
   * The last two text lines and the CTA beside them. `center` puts the button's
   * middle on the middle of the two lines, which is Astrotalk's placement. The
   * 8dp gap is the least the category word keeps from the button before it
   * ellipsizes.
   */
  tail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  // Exp and the category, in the column's one rhythm. `flex: 1` so they take
  // what the button leaves and give way first.
  tailLines: {
    flex: 1,
    gap: ROW_LINE_GAP,
  },
  /*
   * THE CTA'S OWN COLUMN, and why it does not grow the text column. It is a
   * real 48dp box (ROW_CTA_HEIGHT), so the Pressable's hitSlop lands inside a
   * parent (it cannot reach past one on Android), and a negative margin of
   * ROW_CTA_BLEED each side lays it out at the button's drawn 33, which is
   * shorter than the two lines it sits beside (ROW_TAIL, 39). So the row is
   * exactly the lines' height, whatever the button's target. The margin is on
   * this plain View, not on the Pressable, for the reason HomeScreen's
   * `seeAllBleed` records: Pressable moves minHeight to its root and leaves
   * margins on its inner view.
   */
  ctaSlot: {
    height: ROW_CTA_HEIGHT,
    marginVertical: -ROW_CTA_BLEED,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  /*
   * "wait ~12m" under the busy button: textXs (alf text_xs 11.3 on 15) in the
   * button's own garnet, state/danger, which is 9.10:1 light / 6.74:1 dark on
   * the card, past 4.5 for text this small. Absolute, so it is not in the row's
   * layout at all: it hangs BUSY_LINE_GAP under the button's drawn bottom edge,
   * into the space the left column's review count already makes the card give
   * (ROW_BUSY_LINE_BOTTOM, 121, inside the 126 of content), and `alignItems:
   * 'center'` on the slot centres it under the button.
   */
  busyLine: {
    ...TOKENS.typography.textXs,
    color: t.color.state.danger,
    position: 'absolute',
    top: ROW_CTA_HEIGHT - ROW_CTA_BLEED + BUSY_LINE_GAP,
  },
  /*
   * The category mark and word. Its box is the glyph's (ROW_CATEGORY_LINE, 19),
   * the taller of the two, which is what the card's arithmetic counts. The 4dp
   * gap is the mark-to-word distance of a label, not the 8dp of a control.
   */
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  // textSmSemiBold, the CTA label's role: the category and the verb sit side by
  // side across the tail and read at the same size.
  categoryLabel: {
    ...TOKENS.typography.textSmSemiBold,
    flexShrink: 1,
  },
  categoryListener: {
    color: t.color.text.listener,
  },
  categoryAstrologer: {
    color: t.color.text.astrologer,
  },
  /*
   * The CTA. Outlined AT REST, which is the reference and also the right call
   * here: every card has one, and a list of filled buttons is a screen with no
   * primary action at all. Astrotalk's is outlined for the same reason.
   * It goes solid only UNDER THE FINGER (`ctaFill`), which is feedback, not a
   * resting emphasis.
   *
   * Bluesky's small button: 12/8 padding around a 17dp line, 33 tall, with
   * the 1dp outline drawn over the padding's outer edge by `ctaOutline` rather
   * than by a border here (see CTA_STROKE).
   * `minHeight`, not `height`: at a large font scale the label grows, and a
   * fixed height would clip it rather than let the button grow inside its 48dp
   * slot. No width at all: it hugs its content.
   */
  cta: {
    // A definite size, so Pressable's root (which takes box sizing) cannot be
    // stretched by the 48dp slot around it. See ROW_CTA_WIDTH.
    height: ROW_CTA_VISUAL_HEIGHT,
    width: ROW_CTA_WIDTH,
    /*
     * A ROW, so the glyph sits beside the word rather than above it.
     *
     * Found on device: with the default column direction the bell stacked on
     * top of "Notify", which grew the control to two lines and broke the fixed
     * row height this list is built on.
     */
    flexDirection: 'row',
    // 8dp, not 4: at 4 the glyph and the word read as one smudged glyph-word,
    // which is the "tick mark and notified text distance" defect.
    gap: TOKENS.space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: CTA_PAD_X,
    paddingVertical: CTA_PAD_Y,
    // The radius stays HERE as well as on the two layers: Pressable's inner
    // view clips its children (`overflow: 'hidden'`) to this shape, and its
    // state layer takes the shape from it.
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.raised,
  },
  /*
   * THE RESTING OUTLINE: 1dp on the button's own radius, in the state's ink
   * (`ctaOutlineFree` / `ctaOutlineBusy` / `ctaOutlineAway`). At rest this is
   * the control's only boundary on the card, so each takes a colour that
   * clears the 3:1 non-text floor there: text/available 4.62:1 light / 8.13:1
   * dark, state/danger 9.10 / 6.74, text/secondary 7.41 / 5.00.
   *
   * It FADES OUT as the fill fades in (`outlineStyle`, 1 - fill), and that is
   * the fix for the rim. Amit, on the S22 (2026-09-27): while pressed the
   * button must read as one solid shape. With the outline as the button's own
   * border it stayed painted round the fill, a lighter edge in dark. Letting
   * the fill cover the border instead (inset -1) was the other option and the
   * weaker one: the Pressable's inner view clips to its box, and even
   * unclipped, two anti-aliased edges laid on each other leave a fringe of the
   * lower colour on the partly covered pixels.
   */
  ctaOutline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: CTA_STROKE,
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
  },
  /*
   * FREE: green (Amit, 2026-09-27: the CTA is green when the provider is free,
   * and coral is no longer the directory CTA colour). `text/available`, not
   * `state/available`: the presence dot's green is 3.84:1 on the light card,
   * a glyph colour that cannot carry a 13.1sp label; the ink is the same hue
   * at 90%, 4.62:1, and the dot's own #3FD69B in dark, 8.13:1. Registered in
   * scripts/check-contrast.mjs as the label and as the outline.
   */
  ctaOutlineFree: {
    borderColor: t.color.text.available,
  },
  ctaFreeLabel: {
    color: t.color.text.available,
  },
  /*
   * BUSY: the garnet, `state/danger`, which is already text-safe on the card in
   * both modes (9.10:1 light, 6.74:1 dark), so it takes the label, the outline
   * and the wait line under the button without a new token.
   */
  ctaOutlineBusy: {
    borderColor: t.color.state.danger,
  },
  ctaBusyLabel: {
    color: t.color.state.danger,
  },
  // textSmSemiBold, Bluesky's small-button label (13.1 on 17); was labelLarge.
  // The colour comes from the state (ctaFreeLabel and its siblings).
  ctaLabel: {
    ...TOKENS.typography.textSmSemiBold,
  },
  /*
   * THE PRESSED FACE: the same glyph and word on a solid fill in the state's
   * colour (`ctaFillFree` / `ctaFillBusy` / `ctaFillAway`), laid over the
   * resting face and faded in by the `fill` shared value.
   *
   * WHY AN OPACITY CROSSFADE and not `backgroundColor` + `color` tweened on the
   * button, its glyph and its label. Compositing a layer at opacity p over
   * another IS the linear RGB mix of the two at p, pixel for pixel, which is
   * what `interpolateColor` computes, so the frames are the same frames. What
   * differs is the cost: opacity is the one property here that never re-runs
   * text layout or crosses back to the shadow tree, where a Text `color`
   * change goes through a commit per frame on Android; and `Icon` stays a
   * plain component with a plain `color` prop instead of growing an animated
   * one (animate-expo §4: transform and opacity are free, everything else is
   * a pass).
   *
   * EDGE TO EDGE, NO RIM (Amit, on the S22, 2026-09-27). The fill covers the
   * whole button on the button's own outer radius, and the outline fades out
   * under it (`ctaOutline`), so fully pressed it is one solid shape. It used to
   * sit inside a stroke that stayed drawn, a lighter rim round the fill in dark.
   *
   * No contrast is spent on it any more. The coral press was 2.91:1 against the
   * dark card, accepted as transient feedback; the green and the garnet fills
   * are their own edge at 4.62 / 8.13 and 9.10 / 6.74, past the 3:1 floor in
   * both modes, and the word on them is text/onState at 4.62 / 9.27 (green) and
   * 9.10 / 7.69 (garnet), all registered in scripts/check-contrast.mjs.
   */
  ctaFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    gap: TOKENS.space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
  },
  ctaFillFree: {
    backgroundColor: t.color.bg.available,
  },
  ctaFillBusy: {
    backgroundColor: t.color.state.danger,
  },
  // text/onState: the ink this palette already puts on its state fills (white
  // light, #0A1F14 dark), for both the green and the garnet.
  ctaFillLabel: {
    color: t.color.text.onState,
  },
  /*
   * Away variant. GREY, and deliberately a DARK one (Amit, 2026-09-17).
   *
   * Two wrong answers preceded this. First a hairline border with
   * `text/tertiary` ink and no fill, which is Material 3's DISABLED recipe
   * painted onto an enabled control: measured 3.30:1 on this card, under the
   * 4.5:1 floor for 14sp, which is exactly why the report read "Notify icon
   * looks disabled". Then a filled-tonal `bg/accentTint`, which fixed the
   * contrast and broke the hierarchy: Notify is the SECONDARY action on this
   * row and must not compete with Call for a colour.
   *
   * `bg/pressed` is the most solid neutral in the scale, and with
   * `text/primary` on it the label measures 10.25:1 dark and 11.18:1 light.
   * That number is the whole point: the control reads enabled because the ink
   * is strong, not because it is coloured.
   *
   * The 1dp stroke carries the edge, because the fill alone cannot: `bg/pressed`
   * is 1.47:1 against this card in dark. `text/secondary` as the stroke measures
   * 5.00:1 dark and 7.41:1 light against the card, past the 3:1 non-text floor.
   * It is the `ctaOutline` layer's colour (`ctaOutlineAway`), so it fades out
   * under the pressed face the same way the green and garnet ones do.
   *
   * The fill does NOT change between idle, pending and notified. Only the glyph
   * and the word do. A control that recolours itself on every state change draws
   * attention it has not earned, and this one is on screen in every row of a
   * scrolling list.
   */
  ctaAway: {
    backgroundColor: t.color.bg.pressed,
  },
  ctaOutlineAway: {
    borderColor: t.color.text.secondary,
  },
  ctaAwayLabel: {
    color: t.color.text.primary,
  },
  /*
   * The away button's pressed face, in ITS tone rather than a state colour: the
   * neutral at full strength, `bg/inverse` under `text/onInverse` (the primary
   * button's pair, 17.01:1 light / 14.44:1 dark). Solid-while-pressed is the
   * same gesture on every variant; the hue is not, because a green flash on
   * the secondary action is the hierarchy break the 2026-09-17 note forbids.
   * No rim here either: `bg/inverse` is 17.01:1 light / 12.95:1 dark on the
   * card, so the fill is its own edge once the grey outline fades.
   */
  ctaFillAway: {
    backgroundColor: t.color.bg.inverse,
  },
  ctaFillAwayLabel: {
    color: t.color.text.onInverse,
  },
});
