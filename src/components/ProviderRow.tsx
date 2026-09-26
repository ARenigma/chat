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
import { genderLetter, initialOf } from '../lib/display';
import { offeredChannelsLine, presenceForSpeech, readPresence } from '../lib/presence';
import { DURATION, EASE_OUT_QUINT, fadeSwapOutFast, rowIn } from '../theme/motion';
import { minutesUntil, useNotifyProvider } from '../api/sessions';
import { Avatar } from './Avatar';
import { ICON_SCALE, Icon, type IconName } from './Icon';
import { META_CHIP_HEIGHT_SM } from './MetaChip';
import { Pressable } from './Pressable';
import { CATEGORY_BADGE, categoryOf, type ProviderCategory } from '../lib/providerFilters';
import { rowExpertise } from '../lib/expertise';
import { formatRupees } from '../lib/rates';
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
 * The gap between the ring and the star row.
 *
 * `space.xs` (8) and not `space['2xs']` (4). Amit, on the device: "ratings too
 * close to dp circle.. allow some more spacing" — and the 4dp that looked right
 * in the arithmetic reads as crowding on hardware, because the ring's stroke is
 * a hard edge and the stars have their own optical padding inside the glyph
 * box, so the measured gap and the perceived gap are not the same number.
 *
 * It costs the card nothing: the left column goes 120 → 124, still under the
 * right column's 136, so `PROVIDER_CARD_HEIGHT` is unchanged.
 */
const RING_TO_STARS = TOKENS.space.xs;

/**
 * The expertise pill line, directly under the name.
 *
 * Amit: "astrotalk also has expertise just below the name" — and it does:
 * `skillET` sits at y323.3 with the name at y295.3, 17.1dp tall, reading
 * "Vedic,  AI Astrologer". Ours is pills rather than a comma list, which is the
 * one thing taken from Clarity instead ("jsut add expertise from clarity").
 */
const ROW_TAG_LINE = META_CHIP_HEIGHT_SM;

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
 * not an a11y regression: the price row it is centred in stays `ROW_CTA_HEIGHT`
 * (48) tall, and the Pressable's `size` turns the difference into `hitSlop`,
 * max(8, ceil((48 - 33) / 2)) = 8 on every side, a 49dp target — "we recommend
 * that each interactive UI element have a focusable area, or touch target size,
 * of at least 48dp x 48dp"
 * (https://developer.android.com/guide/topics/ui/accessibility/apps).
 * The card height is unchanged: PROVIDER_ROW_RIGHT_COLUMN reserves
 * ROW_CTA_HEIGHT, not this.
 *
 * NO WIDTH CONSTANT ANY MORE. It was a fixed 136 because the button carried the
 * rate as well as the verb ("move rate into cta after call text", 2026-09-08).
 * The rate moved to the name line on 2026-09-26, so the button hugs its icon
 * and label, the way Bluesky's small button does: "Call" draws about 75dp wide,
 * "Notified" about 105.
 */
export const ROW_CTA_VISUAL_HEIGHT =
  TOKENS.space.xs * 2 + TOKENS.typography.textSmSemiBold.lineHeight;

/**
 * The outline, drawn INSIDE the 33 rather than around it. RN borders take space
 * inside the box, so a 1dp stroke over Bluesky's 8/12 padding would draw a 35dp
 * button; the stroke comes out of the padding instead, 1 + 7 + 17 + 7 + 1 = 33.
 */
const CTA_STROKE = 1;
const CTA_PAD_Y = TOKENS.space.xs - CTA_STROKE;
const CTA_PAD_X = TOKENS.space.sm - CTA_STROKE;

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
 * Measured from the two fonts, not eyeballed:
 *
 *   Geist cap height    OS/2 sCapHeight 710 / unitsPerEm 1000 = 0.71 em
 *   name cap height     0.71 x titleMediumEmphasized 16 = 11.36dp
 *   seal ink            `seal-check-fill` in assets/fonts/Phosphor.ttf spans
 *                       y 52..948 of a 1000 em (fontTools glyph bounds), 0.896 em
 *   glyph box           11.36 / 0.896 = 12.68 -> 13dp, since `Icon` rounds its
 *                       box to a whole dp (Math.round(size x ICON_SCALE))
 *   drawn seal          13 x 0.896 = 11.65dp
 *
 * 11.65 against 11.36 is 0.29dp over (under a pixel at the S22's density), and
 * over is the correct side: a round shape set beside flat-topped capitals has to
 * overshoot them to LOOK the same height, which is why a type designer's O is
 * taller than their H. 12dp would have drawn 10.75, visibly short.
 *
 * `__tests__/providerRow.test.ts` reads both numbers out of the .ttf files, so
 * a regenerated icon font or a type-scale change fails there rather than
 * leaving this arithmetic describing a glyph that has moved.
 */
const GEIST_CAP_HEIGHT = 0.71;
const SEAL_INK_BOTTOM = 0.052;
const SEAL_INK_TOP = 0.948;
const NAME_CAP_HEIGHT =
  GEIST_CAP_HEIGHT * TOKENS.typography.titleMediumEmphasized.fontSize;
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
 * em above that bottom, so a translate of 0.052 x 13 = 0.68dp lands the ink
 * itself on the baseline, and its top at the cap line plus the overshoot above.
 * A transform, so the 0.68dp moves pixels and not the row's layout.
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
 * TWO COLUMNS, and the card is the taller of them plus its padding — the shape
 * Astrotalk uses, and the reason the avatar grew:
 *
 *   left   ring 84 · 4 · stars 14 · 2 · count 16                          = 120
 *   right  name 24 · 2 · tags 24 · 2 · langs 16 · 2 · exp 16 · 2 · CTA 48 = 136
 *
 * The last line is a ROW — price on the left, CTA on the right — so it costs
 * the CTA's 48 rather than 48 plus the price's own 20. That is where Astrotalk
 * puts its button too: `call_rl` spans y361.5–397.5, straddling the experience
 * and price lines rather than sitting under them.
 *
 * 160dp of card against Astrotalk's 146.2dp `row_content_holder`, and 168 of
 * pitch against their 180.4 — taller than the first build, which is what was
 * asked for ("increase row height for comfortable view"), and inside the
 * reference's own bracket.
 *
 * `__tests__/providerRow.test.ts` pins the arithmetic from the tokens, so a
 * change to the type scale or a chip height fails there rather than silently
 * mis-hinting the list.
 */
/**
 * What the left column actually contains, top to bottom.
 *
 * It is no longer what sizes the card — see below — but it still has to FIT,
 * and the assertion that it does is what keeps the two columns honest.
 */
export const PROVIDER_ROW_LEFT_COLUMN =
  ROW_AVATAR_RING +
  RING_TO_STARS +
  STARS_HEIGHT +
  TOKENS.space.hair +
  TOKENS.typography.bodySmall.lineHeight;

export const PROVIDER_ROW_RIGHT_COLUMN =
  TOKENS.typography.titleMediumEmphasized.lineHeight +
  TOKENS.space.hair +
  ROW_TAG_LINE +
  TOKENS.space.hair +
  TOKENS.typography.bodySmall.lineHeight +
  TOKENS.space.hair +
  TOKENS.typography.bodySmall.lineHeight +
  TOKENS.space.hair +
  ROW_CTA_HEIGHT;

/**
 * The card itself, without the gap under it — the RIGHT column plus padding.
 *
 * It used to be `Math.max` of the two columns, which was correct arithmetic and
 * the wrong shape. Amit, on the device: "strats should align with rate.. pls
 * see how astrotalsk proved space and alignment" — and the reference does align
 * them, exactly: its `average_ratingbar` sits at y384.4 and its `price` at
 * y386.5, two points apart, so the stars and the rate read as one line across
 * the card.
 *
 * Top-aligning two columns of different heights cannot produce that. The left
 * column is shorter, so its stars landed 13dp above the price and the card had
 * two unrelated horizons.
 *
 * The fix is to give the left column the RIGHT column's height and push its
 * contents apart (`justifyContent: 'space-between'`): the ring stays at the
 * top, the stars-and-count block falls to the bottom, and the star row's centre
 * lands within a point of the price row's. That is Astrotalk's arrangement
 * rather than an approximation of it, and it stays true on its own — if a line
 * is added to the right column, both sides grow together.
 *
 * `PROVIDER_ROW_LEFT_COLUMN` therefore no longer sizes anything, and the test
 * asserts it FITS instead.
 */
export const PROVIDER_CARD_HEIGHT = CARD_PAD * 2 + PROVIDER_ROW_RIGHT_COLUMN;

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
   * The dot and the trailing line both come from `is_available` again, as of
   * 2026-09-17. They came from it before migration 012 as well, and that was
   * wrong then for a reason that has since been removed rather than forgotten:
   * `presence` was a second, separate declaration, so reading the listing switch
   * as the dot said somebody was there when it only meant they wanted work.
   * There is no second declaration now — see src/lib/presence.ts — and
   * `readPresence` is still the one reading, so this row, the inbox and the chat
   * header cannot disagree.
   */
  const presence = readPresence(provider.is_available);

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
   */
  const away = !presence.here;
  const canCall = provider.audio_enabled && onCall !== undefined && !away;
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
  const offeredVerb = provider.chat_enabled
    ? 'Chat'
    : provider.audio_enabled
      ? 'Call'
      : 'Video';
  const ctaLabel = away ? 'Notify' : canCall ? 'Call' : offeredVerb;
  const ctaSpoken =
    ctaLabel === 'Call'
      ? `Call ${provider.display_name}`
      : ctaLabel === 'Video'
        ? `Video call ${provider.display_name}`
        : `Message ${provider.display_name}`;
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
   * The hook invalidates the directory query, `presence` comes back 'here', and
   * `away` above goes false on the next render — so the row swaps to Call
   * through the single reading of presence it already has, rather than growing a
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
   * The category's ink, keyed by the category so a third one added to
   * migration 065 fails to compile here rather than rendering uncoloured.
   */
  const categoryInk: Record<ProviderCategory, TextStyle> = {
    listener: styles.categoryListener,
    astrologer: styles.categoryAstrologer,
  };

  const accessibility = [
    `${provider.display_name}${provider.age !== null ? `, ${provider.age}` : ''}`,
    presenceForSpeech(presence),
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
            accessibilityLabel={`${provider.display_name}'s profile`}
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
              maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
              allowFontScaling
              numberOfLines={1}
              style={styles.name}>
              {provider.display_name}
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
                color={theme.color.mark.verified}
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
              `secondary` grey text, in the same 24dp slot (no height change, so
              PROVIDER_CARD_HEIGHT is untouched). `rowExpertise` still caps and
              dedupes the tag set (ROW_EXPERTISE_LIMIT); only the rendering
              changed from chips to a comma join. The category on the price line
              stopped being a chip too (2026-09-26): coloured text behind a
              filled glyph. */}
          <View style={styles.tagLine} testID={`provider-tags-${provider.id}`}>
            <Text
              allowFontScaling
              numberOfLines={1}
              style={channelLine !== null ? styles.channelLine : styles.secondary}>
              {channelLine ?? (tags.length > 0 ? tags.join(', ') : headline)}
            </Text>
          </View>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {languages === '' ? ' ' : languages}
          </Text>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {`Exp · ${years} ${years === 1 ? 'year' : 'years'}`}
          </Text>

          <View style={styles.priceLine}>
            {/* Listener / Astrologer, on EVERY card — the tab above Explore
                already says which you are looking at, but search spans both and
                a member should not have to remember which list they are in to
                know what they are buying.

                NOT A CHIP since 2026-09-26 (Amit): coloured text behind a
                filled glyph, the "trophy + Wellness Guide" idiom, so the line
                carries the type without a box competing with the CTA beside it.
                Hue still tells the two apart down a scrolling column, and the
                glyph now says it a second way (headset, moon-stars) for anyone
                who does not separate the hues. The ink is `text/onListener` /
                `text/onAstrologer`, the text-safe member of each category pair
                on the card: 8.79 / 8.98:1 light, 11.65 / 10.93:1 dark, both
                registered in scripts/check-contrast.mjs. The bg/ tones are fills
                and fail as text there (1.24:1 to 1.81:1). */}
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
            <View style={styles.priceSpacer} />
            {/* The state swap, keyed so it runs once per transition and never on
                a re-render or on a recycled cell that lands on the same state.
                `fadeSwapOutFast` is the existing builder for a button label that
                just narrated itself (motion.ts): DURATION.fast, EASE_OUT,
                opacity only, `reduceMotion(ReduceMotion.System)`. The whole
                control fades through rather than its pieces separately,
                because it is one object changing its mind.

                A live region, because a focused control whose label changes does
                not announce on its own, and Android 16 deprecates
                announceForAccessibility in favour of exactly this.
                https://developer.android.com/about/versions/16/behavior-changes-all

                OFF WHILE IDLE, and on a list that is the difference between a
                useful announcement and an unusable one: a live region speaks
                when its content ARRIVES as well as when it changes, and in a
                recycled list rows arrive continuously under the finger. Polite
                only once this control has something to report. */}
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
                /* Feedback on press-in, commit on press-out (animate-expo §7):
                   the fill starts the moment the finger lands, and the action
                   still only fires on a completed tap. Press-out drains it on
                   every release, including a cancelled one. */
                onPressIn={() => fill.set(withTiming(1, CTA_FILL_IN))}
                onPressOut={() => fill.set(withTiming(0, CTA_FILL_OUT))}
                busy={notify.state.kind === 'pending'}
                testID={`provider-cta-${provider.id}`}
                /* The cooldown is SPOKEN here and DRAWN on the profile, which is
                   the one asymmetry in this pair of surfaces and is deliberate:
                   this control is a small button on a row whose every dimension
                   is a promise to FlashList, and "Notified  again in 12m" does
                   not belong in it at any type size. The profile's Notify
                   button is full width and shows the same fact in words. */
                accessibilityLabel={
                  notified
                    ? `${provider.display_name} has been notified${
                        notifyAgainIn === null ? '' : `, again in ${notifyAgainIn}m`
                      }`
                    : away
                      ? `Notify ${provider.display_name} that you want to chat`
                      : ctaSpoken
                }
                /* No scale and no state layer (`highlight="none"`): the fill IS
                   the press feedback, and a 3% squeeze or a grey dim on top of
                   it would be two answers to one touch. */
                press="none"
                highlight="none"
                // `size` is how this Pressable meets the 48dp target — it turns
                // the 33dp drawn button into a 49dp focusable area via hitSlop,
                // without inflating the visual (Pressable.tsx, `slop`).
                size={ROW_CTA_VISUAL_HEIGHT}
                style={[styles.cta, away && styles.ctaAway]}>
                {/* Glyph + verb, and the glyph is BACK. REVERSED 2026-09-26,
                    citing Amit's approved mockup: every state leads with its
                    glyph (phone for Call, camera for Video, bubble for Chat,
                    bell for Notify, check once notified). The old rule, from
                    "remove call icon before 22/min", was about a phone in front
                    of a PRICE, where it only restated "this rate buys a call";
                    the price has left the button, and a glyph in front of a
                    one-word verb is the small-button idiom the mockup draws.
                    Resting face: outlined, coral ink. */}
                <Icon
                  name={ctaIcon}
                  size={CTA_ICON_SIZE}
                  color={(away ? styles.ctaAwayLabel.color : styles.ctaLabel.color) as string}
                />
                <Text
                  allowFontScaling
                  numberOfLines={1}
                  style={[styles.ctaLabel, away && styles.ctaAwayLabel]}>
                  {ctaText}
                </Text>
                {/* Pressed face: the same glyph and word on the solid fill,
                    faded in over the resting face by `fill`. Hidden from
                    TalkBack and from touch, because it is a second drawing of
                    the one control, not a second control. */}
                <Animated.View
                  pointerEvents="none"
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.ctaFill, away && styles.ctaFillAway, fillStyle]}>
                  <Icon
                    name={ctaIcon}
                    size={CTA_ICON_SIZE}
                    color={
                      (away ? styles.ctaFillAwayLabel.color : styles.ctaFillLabel.color) as string
                    }
                  />
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={[styles.ctaLabel, away ? styles.ctaFillAwayLabel : styles.ctaFillLabel]}>
                    {ctaText}
                  </Text>
                </Animated.View>
              </Pressable>
            </Animated.View>
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
    // design (120 and 136), and centring would float the avatar down from the
    // name it belongs to. Astrotalk top-aligns them too.
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
    // The RIGHT column's height, so the two share a bottom edge and the
    // space-between below can land the stars on the price line.
    height: PROVIDER_ROW_RIGHT_COLUMN,
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
    marginTop: TOKENS.space.hair,
  },
  label: {
    flex: 1,
    gap: TOKENS.space.hair,
  },
  nameLine: {
    flexDirection: 'row',
    // `baseline`, not `center`, since 2026-09-26: three texts in three sizes
    // share this line now (the 16dp name, the 12dp rate, the seal glyph), and
    // centring boxes of different heights puts their baselines at three
    // different heights. Fabric resolves a Text's baseline from its first
    // line's ascent (ParagraphShadowNode::baseline), so the rate sits on the
    // name's baseline exactly as the nested F-29 does, at every font scale.
    alignItems: 'baseline',
    // `space.xs` (8), not `space['2xs']` (4). Amit, on the device: "certofied
    // icon spacing also increase a bit like clarity" — Clarity sets its badge
    // well clear of the name, and at 4dp ours read as part of the word.
    gap: TOKENS.space.xs,
    height: TOKENS.typography.titleMediumEmphasized.lineHeight,
  },
  name: {
    ...TOKENS.typography.titleMediumEmphasized,
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
  // Fixed height and `overflow: hidden`. The height is the card's promise to
  // FlashList; the clip is what makes a fourth pill impossible rather than
  // merely unlikely, since a category badge plus three tags would otherwise
  // wrap and push the price line down.
  tagLine: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_TAG_LINE,
    gap: TOKENS.space['2xs'],
    overflow: 'hidden',
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
  priceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_CTA_HEIGHT,
  },
  /*
   * The category mark and word. `flexShrink: 1` so at a large font scale the
   * word gives way before the CTA is pushed off the card, and the 4dp gap is the
   * mark-to-word distance of a label, not the 8dp of a control.
   */
  category: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    flexShrink: 1,
  },
  // textSmSemiBold, the CTA label's role: the category and the verb are the
  // two words on this line and read at the same size.
  categoryLabel: {
    ...TOKENS.typography.textSmSemiBold,
    flexShrink: 1,
  },
  categoryListener: {
    color: t.color.text.onListener,
  },
  categoryAstrologer: {
    color: t.color.text.onAstrologer,
  },
  // A spacer rather than `justifyContent: 'space-between'`, because the price
  // must stay left while the CTA goes to the far edge, and the row may later
  // gain a third child.
  priceSpacer: {
    flex: 1,
  },
  /*
   * The CTA. Outlined AT REST, which is the reference and also the right call
   * here: every card has one, and a list of filled accent buttons is a screen
   * with no primary action at all. Astrotalk's is outlined for the same reason.
   * It goes solid only UNDER THE FINGER (`ctaFill`), which is feedback, not a
   * resting emphasis.
   *
   * Bluesky's small button: 12/8 padding around a 17dp line, with the 1dp
   * stroke taken out of the padding (CTA_PAD_X / CTA_PAD_Y) so it draws 33.
   * `minHeight`, not `height`: at a large font scale the label grows, and a
   * fixed height would clip it rather than let the button grow inside its 48dp
   * row. No width at all: it hugs its content.
   */
  cta: {
    minHeight: ROW_CTA_VISUAL_HEIGHT,
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
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
    borderWidth: CTA_STROKE,
    // The accent INK, not the fill: this outline is the control's only
    // boundary and it sits on the card. bg/accent (step 500) there is 2.91:1
    // in dark, under the 3:1 non-text floor; text/accent (step 300) is 6.22:1.
    borderColor: t.color.text.accent,
    backgroundColor: t.color.bg.raised,
  },
  /*
   * `text/accent`, NOT `bg/accent`. `bg/accent` is a FILL colour, what a button
   * is painted, with `text/onAccent` on top; `text/accent` is the ink for coral
   * text on a surface. In light both are ramp step 500 (5.19:1 on the card); in
   * dark the ink is step 300, 6.22:1 on this card, where step 500 as text would
   * be 2.91:1. Registered on bg/raised in scripts/check-contrast.mjs, as the
   * label and as the outline above.
   *
   * textSmSemiBold, Bluesky's small-button label (13.1 on 17); was labelLarge.
   */
  ctaLabel: {
    ...TOKENS.typography.textSmSemiBold,
    color: t.color.text.accent,
  },
  /*
   * THE PRESSED FACE: the same glyph and word, solid `bg/accent` under
   * `text/onAccent` (5.19:1, registered), laid over the resting face and faded
   * in by the `fill` shared value.
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
   * INSIDE THE STROKE, not over it. Yoga places an absolute child inside its
   * parent's border, so the 1dp outline stays drawn around the fill: in light it
   * is the same step 500 and vanishes into it, in dark it is a step-300 rim that
   * keeps the pressed button's edge at 6.22:1 against the card, where the fill
   * alone would be 2.91:1. The radius is the outline's inner radius, so the
   * fill's corners meet the stroke's curve instead of poking through it.
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
    borderRadius: TOKENS.radius.xs - CTA_STROKE,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.accent,
  },
  ctaFillLabel: {
    color: t.color.text.onAccent,
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
   * row and must not compete with Call for the accent.
   *
   * `bg/pressed` is the most solid neutral in the scale, and with
   * `text/primary` on it the label measures 10.25:1 dark and 11.18:1 light.
   * That number is the whole point: the control reads enabled because the ink
   * is strong, not because it is coloured.
   *
   * The 1dp stroke carries the edge, because the fill alone cannot: `bg/pressed`
   * is 1.47:1 against this card in dark. `text/secondary` as the stroke measures
   * 5.00:1 dark and 7.41:1 light against the card, past the 3:1 non-text floor.
   *
   * The fill does NOT change between idle, pending and notified. Only the glyph
   * and the word do. A control that recolours itself on every state change draws
   * attention it has not earned, and this one is on screen in every row of a
   * scrolling list.
   */
  ctaAway: {
    backgroundColor: t.color.bg.pressed,
    borderColor: t.color.text.secondary,
  },
  ctaAwayLabel: {
    color: t.color.text.primary,
  },
  /*
   * The away button's pressed face, in ITS tone rather than the coral: the
   * neutral at full strength, `bg/inverse` under `text/onInverse` (the primary
   * button's pair, 17.01:1 light / 14.44:1 dark). Solid-while-pressed is the
   * same gesture on both variants; the hue is not, because a coral flash on
   * the secondary action is the hierarchy break the 2026-09-17 note forbids.
   */
  ctaFillAway: {
    backgroundColor: t.color.bg.inverse,
  },
  ctaFillAwayLabel: {
    color: t.color.text.onInverse,
  },
});
