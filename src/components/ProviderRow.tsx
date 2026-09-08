import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { genderLetter, initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { rowIn } from '../theme/motion';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { META_CHIP_HEIGHT_SM, MetaChip } from './MetaChip';
import { Pressable } from './Pressable';
import { CATEGORY_BADGE, categoryOf } from '../lib/providerFilters';
import { ROW_EXPERTISE_LIMIT, rowExpertise } from '../lib/expertise';
import { formatRupees } from '../lib/rates';
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
  /**
   * Whether to name the provider's category on the row (migration 065).
   *
   * On Explore the tab above the list already says which category you are
   * looking at, so repeating it on every row is noise. In SEARCH there are no
   * tabs and the results span both, so without this a member cannot tell an
   * astrologer from a listener.
   */
  showCategory?: boolean;
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

/** The CTA's width. Astrotalk's is 95.3dp; 96 is the same number on our grid. */
export const ROW_CTA_WIDTH = 96;

/** The card's inner padding. Astrotalk insets its avatar 12dp from the card. */
const CARD_PAD = TOKENS.space.sm;

/** Card-to-card gap. Astrotalk's is 9.1dp between one card and the next. */
export const ROW_CARD_GAP = TOKENS.space.xs;

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
 *   1. 48dp CTA, not 36. See ROW_CTA_HEIGHT.
 *   2. No struck-through price. Astrotalk shows "₹ 24 ₹ 5/min" with the first
 *      crossed out; we have one undiscounted rate, so an anchor would be
 *      invented.
 *   3. No glyph before the price ("remove call icon before 22/min").
 *   4. Expertise as pills rather than a comma list — the Clarity half.
 *
 * THE RATING IS MANUFACTURED for a provider with fewer than 50 genuine ones.
 * That is a product decision, taken deliberately; `src/lib/systemRating.ts`
 * holds the numbers, the switch and the argument, and this card reads it
 * through one function so the decision cannot leak into a second
 * implementation.
 */
function ProviderRowView({
  provider,
  index,
  isLast,
  onPress,
  onPressAvatar,
  onCall,
  ratePerMin,
  animateEntrance = true,
  showCategory = false,
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
  const tags = [
    ...(showCategory ? [CATEGORY_BADGE[categoryOf(provider)]] : []),
    ...rowExpertise(provider),
  ].slice(0, ROW_EXPERTISE_LIMIT);

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
   * The dot and the trailing line both come from `presence` now. They used to
   * come from `is_available`, which is the provider's *listing* switch: it means
   * "listed for discovery and open to new conversations", so a row said somebody
   * was there when it only meant they wanted work. Migration 012 split the two,
   * and `readPresence` is the one reading of it so this row, the inbox and the
   * chat header cannot disagree.
   */
  const presence = readPresence(provider.presence, provider.last_active_at);

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
  const canCall = provider.audio_enabled && onCall !== undefined;
  const ctaLabel = canCall ? 'Call' : 'Chat';

  const accessibility = [
    `${provider.display_name}${provider.age !== null ? `, ${provider.age}` : ''}`,
    presenceForSpeech(presence),
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
                set already had. Amit: "certified icon should be like clarity..
                lucide deosnthav eit or what?" It does: `badge-check` is the
                scalloped rosette with the check inside, which is the mark both
                references draw. Added to design/icons.json and regenerated
                rather than hand-edited (RULE 4).

                Outline rather than the references' solid fill, because every
                other mark in this app is Lucide outline and one filled badge
                would read as a different system.

                Every card has one, and that is correct rather than lazy:
                `provider_directory` filters on `identity_verified_at is not
                null`, so a provider a member can see has passed the PAN and
                identity check by construction. It is a statement about the
                marketplace, not a ranking within it.

                `accessible={false}`: the card's label would otherwise gain a
                stop that says nothing a member can act on. */}
            <View accessible={false} testID="provider-verified">
              <Icon
                name="badgeCheck"
                size={TOKENS.icon.md}
                color={theme.color.bg.accent}
              />
            </View>
          </View>

          {/* Expertise, directly under the name — Astrotalk's `skillET` slot,
              with Clarity's pills in it. A plain non-scrolling row: three pills
              at 24dp fit the text column at every offered value, which is what
              ROW_EXPERTISE_LIMIT is chosen to guarantee, so there is nothing to
              scroll and no gesture to negotiate. */}
          <View style={styles.tagLine} testID={`provider-tags-${provider.id}`}>
            {tags.length > 0 ? (
              tags.map(tag => <MetaChip key={tag} size="sm" label={tag} />)
            ) : (
              <Text allowFontScaling numberOfLines={1} style={styles.headline}>
                {headline}
              </Text>
            )}
          </View>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {languages === '' ? ' ' : languages}
          </Text>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {`Exp · ${years} ${years === 1 ? 'year' : 'years'}`}
          </Text>

          <View style={styles.priceLine}>
            {/* No glyph. Amit: "remove call icon before 22/min" — and it was
                doing less than it looked: the phone said "this rate buys a
                call", which the CTA beside it now says in a word. */}
            <Text allowFontScaling numberOfLines={1} style={styles.price}>
              {formatRupees(ratePerMin)}
              <Text style={styles.perMin}>/min</Text>
            </Text>
            <View style={styles.priceSpacer} />
            <Pressable
              onPress={() =>
                canCall && onCall !== undefined ? onCall(provider.id) : onPress(provider.id)
              }
              testID={`provider-cta-${provider.id}`}
              accessibilityLabel={
                canCall ? `Call ${provider.display_name}` : `Message ${provider.display_name}`
              }
              press="none"
              highlight="dim"
              style={styles.cta}>
              <Text allowFontScaling numberOfLines={1} style={styles.ctaLabel}>
                {ctaLabel}
              </Text>
            </Pressable>
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
    alignItems: 'center',
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
  // The headline, on the expertise line, when there are no tags. `bodyMedium`
  // rather than the languages line's `bodySmall`: it is the provider's own
  // sentence and stands in for three pills, so it should not read as the
  // quietest thing on the card. It fits — the line is 24dp and bodyMedium's box
  // is 20.
  headline: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
  secondary: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  priceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_CTA_HEIGHT,
  },
  price: {
    ...TOKENS.typography.labelLarge,
    color: t.color.text.primary,
  },
  // "/min" quieter and smaller than the figure, so the rate reads as one price
  // rather than two words. Astrotalk splits these into two TextViews at 21.8dp
  // and 17.1dp for the same reason; nested Text is how RN does it.
  perMin: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
  },
  // A spacer rather than `justifyContent: 'space-between'`, because the price
  // must stay left while the CTA goes to the far edge, and the row may later
  // gain a third child.
  priceSpacer: {
    flex: 1,
  },
  /*
   * The CTA. Outlined, not filled, which is the reference and also the right
   * call here: every card has one, and a list of filled accent buttons is a
   * screen with no primary action at all. Astrotalk's is outlined green on
   * white for the same reason.
   */
  cta: {
    width: ROW_CTA_WIDTH,
    height: ROW_CTA_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: t.color.bg.accent,
    backgroundColor: t.color.bg.raised,
  },
  /*
   * `text/accent`, NOT `bg/accent`, and the two are different greens on
   * purpose: #15603E against #1DAA61 in light mode. `bg/accent` is a FILL
   * colour — what a button is painted, with `text/onAccent` on top — and as a
   * label on a light card it gives 2.9:1, under the 4.5:1 AA floor for text.
   * `text/accent` exists for exactly this and is already checked against
   * bg/base by scripts/check-contrast.mjs.
   *
   * The BORDER keeps `bg/accent`, the lighter green that matches the reference.
   * A border is a non-text boundary, so 3:1 is its target rather than 4.5 — and
   * it is not the only signal either way, since the label it surrounds says
   * "Call".
   */
  ctaLabel: {
    ...TOKENS.typography.labelLarge,
    color: t.color.text.accent,
  },
});
