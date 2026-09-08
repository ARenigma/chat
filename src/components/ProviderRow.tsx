import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { rowIn } from '../theme/motion';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { META_CHIP_HEIGHT_SM, MetaChip } from './MetaChip';
import { Pressable } from './Pressable';
import { CATEGORY_BADGE, categoryOf } from '../lib/providerFilters';
import { ROW_EXPERTISE_LIMIT, rowExpertise } from '../lib/expertise';
import { formatRupees } from '../lib/rates';

interface Props {
  provider: ProviderSummary;
  index: number;
  /**
   * Suppresses the separator. An iOS plain list draws a divider *between* cells
   * and never after the last one; a trailing hairline under the final row reads as
   * a list that has been cut off rather than one that has ended.
   */
  isLast: boolean;
  /**
   * Row body tap: receives the provider id rather than the full summary.
   *
   * Changed from `(provider: ProviderSummary) => void` so call sites can pass a
   * stable `useCallback((id: string) => ...)` without re-wrapping the full object
   * — which was the reason memo never held across balance ticks.
   */
  onPress: (id: string) => void;
  /**
   * Avatar tap: open the profile card. Same id-only contract as `onPress` so both
   * can be hoisted as stable callbacks in the parent.
   */
  onPressAvatar?: (id: string) => void;
  /**
   * Whether to name the provider's category on the row (migration 065).
   *
   * On Explore the tab above the list already says which category you are
   * looking at, so repeating it on every row is noise. In SEARCH there are no
   * tabs and the results span both, so without this a member cannot tell an
   * astrologer from a listener.
   */
  showCategory?: boolean;
  /**
   * Whether to run the entrance animation. Defaults to true.
   *
   * Set to false for cells that FlashList has already shown once (tracked by the
   * parent via a useRef Set) so that scroll-recycling a cell does not re-fire the
   * stagger animation on every appearance.
   */
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
 * A seeded years-of-experience, 2 to 8, stable per provider.
 *
 * A placeholder (Amit's "seeded for now"): the directory has no experience
 * column, so this derives a deterministic number from the id rather than
 * inventing one per render. Swap for a real `experience_years` field when the
 * schema carries it; this is the one number in the row that is not yet true.
 */
export function seededExperienceYears(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    // `% 100000` keeps the running hash bounded (no overflow) without a bitwise
    // op, which the lint config forbids.
    h = (h * 31 + id.charCodeAt(i)) % 100000;
  }
  return 2 + (h % 7);
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
 * Avatar diameter. Exported because the separator inset is derived from it.
 *
 * 76, measured. It was 40 — an iOS Messages/Contacts list-row size, and the
 * right answer while this row was a two-line inbox-shaped cell. The row is now
 * built on Astrotalk's anatomy (Amit, 2026-09-08: "astrotalk layout with
 * clarity tags"), read off the Redmi with `uiautomator dump` at density 440,
 * 2.75 px/dp, rather than from a screenshot.
 *
 * 76 and not 72, and the difference is which of Astrotalk's two circles to
 * match. Its `user_pic` is 72.0dp sitting inside a 76.4dp
 * `background_user_pic`, the yellow ring. The ring is NOT reproduced — a halo
 * on every row of a directory of strangers reads as a badge that has been
 * awarded rather than a frame, the same argument that keeps our avatars off
 * `warm` — so our visible circle is the OUTER one, and 76 is what lands in the
 * same footprint.
 *
 * It is also already in `Avatar`'s size union, which is closed on purpose
 * ("a new size is a decision someone makes") and carries hand-tuned FONT and
 * DOT entries per value. Adding 72 would have meant inventing both for a
 * measurement that 76 already satisfies to within 0.4dp.
 */
export const ROW_AVATAR = 76;

export const ROW_SEPARATOR_INSET = ROW_AVATAR + TOKENS.space.sm;

/**
 * The disclosure chevron's own slot, so it stops sharing the row's flex.
 *
 * Amit's report: "we have full pane occupied for arrow button on sp profile row
 * in homescreen which chuts the language chip -- make the icon individual per
 * row". The chevron was a bare `Icon` sitting as the row's last flex child, so
 * what it took from the text column was whatever its glyph happened to measure,
 * and nothing in the row said "this much and no more".
 *
 * `icon.md` (20) rather than `icon.sm` (16), which is the chevron's own `size`:
 * `Icon` renders a Lucide glyph at `Math.round(size * ICON_SCALE)` — 1.2, see
 * Icon.tsx — so a 16 chevron occupies a 19dp box and a 16dp slot would clip it.
 * 20 is the smallest token that cannot, and `__tests__/providerRow.test.ts`
 * checks that arithmetic against Icon.tsx rather than trusting this sentence.
 *
 * A slot and not a second Pressable. "Individual per row" is about the width the
 * glyph owns, not about a second touch target: the row already opens the
 * conversation, so a chevron button would be a duplicate action and — like the
 * avatar, which is folded in with `accessible={false}` below — a second TalkBack
 * node overlapping the row for no gain.
 */
export const ROW_CHEVRON_SLOT = TOKENS.icon.md;

/**
 * The tag pill line, the languages line and the price line, named so the height
 * arithmetic below reads as the row rather than as a sum of tokens.
 */
const ROW_TAG_LINE = META_CHIP_HEIGHT_SM;

/**
 * The CTA's height, and the one number in this row that is NOT the reference.
 *
 * Astrotalk's `call_rl` measures 36.0dp on the Redmi. Amit: "48dp". He is right
 * and the platform agrees — "we recommend that each interactive UI element have
 * a focusable area, or touch target size, of at least 48dp x 48dp"
 * (https://developer.android.com/guide/topics/ui/accessibility/apps) — and
 * unlike the chip pills above, this one really is tappable, so the 48 applies
 * with full force. A 36dp button is the reference being wrong.
 */
export const ROW_CTA_HEIGHT = TOKENS.interaction.minTarget;

/** The CTA's width. Astrotalk's is 95.3dp; 96 is the same number on our grid. */
export const ROW_CTA_WIDTH = 96;

/**
 * The row's laid-out height, DERIVED rather than written down, so the list's
 * `overrideItemLayout` hint cannot drift away from the row it describes.
 *
 * It drifted already: HomeScreen told FlashList `size = 97` in both of its
 * `overrideItemLayout` callbacks, a number from before this row grew a meta
 * strip. FlashList v2 measures real cells, so the hint is an estimate it
 * refines rather than a constraint it enforces — a wrong one costs scrollbar
 * and scroll-to-index accuracy, not correctness, which is exactly why nobody
 * noticed for as long as nobody did.
 *
 * TWO COLUMNS NOW, and the row is the taller of them plus its padding. That is
 * the shape Astrotalk uses and the reason the avatar grew: the left column is
 * the avatar with the rating stacked under it, the right column is four lines,
 * and neither is a fixed multiple of the other.
 *
 *   left   avatar 76 · 4 · rating 16 · count 16                = 112
 *   right  name 24 · 2 · tags 24 · 2 · languages 16 · 2 · CTA 48 = 118
 *
 * The last line is a ROW — price on the left, CTA on the right — so it costs
 * the CTA's 48 rather than 48 plus the price's own 20. That is where Astrotalk
 * puts its button too: `call_rl` spans y361.5–397.5, straddling the experience
 * and price lines rather than sitting under them.
 *
 * 142dp against Astrotalk's 146.2dp `row_content_holder`, which is as close as
 * two different type scales get without copying one.
 *
 * `__tests__/providerRow.test.ts` pins the arithmetic from the tokens, so a
 * change to the type scale or a chip height fails there rather than silently
 * mis-hinting the list.
 */
export const PROVIDER_ROW_LEFT_COLUMN =
  ROW_AVATAR +
  TOKENS.space['2xs'] +
  TOKENS.typography.labelMedium.lineHeight +
  TOKENS.typography.bodySmall.lineHeight;

export const PROVIDER_ROW_RIGHT_COLUMN =
  TOKENS.typography.titleMediumEmphasized.lineHeight +
  TOKENS.space.hair +
  ROW_TAG_LINE +
  TOKENS.space.hair +
  TOKENS.typography.bodySmall.lineHeight +
  TOKENS.space.hair +
  ROW_CTA_HEIGHT;

export const PROVIDER_ROW_HEIGHT =
  TOKENS.space.sm * 2 +
  Math.max(PROVIDER_ROW_LEFT_COLUMN, PROVIDER_ROW_RIGHT_COLUMN);


/**
 * A row in the directory, rebuilt on Astrotalk's anatomy with Clarity's tags.
 *
 * Amit, 2026-09-08: "explore rows first — astrotalk layout with clarity tags",
 * after "they dont look nice.. or catchy". The reference was read off the
 * Redmi with `uiautomator dump` rather than from a screenshot, so every number
 * below is a measurement: 72dp avatar, the rating stacked beneath it, four text
 * lines beside it, an outlined CTA on the price line.
 *
 * WHAT CAME FROM WHERE, and it matters because the two references disagree:
 *
 *   Astrotalk  the anatomy. Big avatar, rating + count under it, name / detail
 *              lines / price stacked to its right, outlined CTA on the price
 *              line. Its detail lines are plain comma-joined text.
 *   Clarity    the tags themselves, as pills rather than a comma list, which is
 *              the half of "best of both" that Astrotalk does not have.
 *
 * FIVE DELIBERATE DEPARTURES, stated because RULE 1 asks for them:
 *
 *   1. **48dp CTA, not Astrotalk's 36.** See ROW_CTA_HEIGHT — this one is
 *      genuinely tappable, so the 48dp minimum applies and the reference is
 *      simply wrong.
 *   2. **No struck-through price.** Astrotalk renders "₹ 24 ₹ 5/min" with the
 *      first crossed out. Amit: "no struck price". We have one rate and it is
 *      not discounted, so a struck price would be an invented anchor.
 *   3. **No yellow ring on the avatar.** See ROW_AVATAR.
 *   4. **No photographs.** Unchanged from the previous row and for the same
 *      reason: we publish initials, and the avatar is never `warm`.
 *   5. **The seeded experience line is gone.** Astrotalk's "Exp- 14 Years" is a
 *      real column; ours came from `seededExperienceYears`, a hash of the id.
 *      It survived as one chip among several, where it read as one fact among
 *      many. Given its own line in the reference's anatomy it would be a
 *      fabricated number with a line of its own, which is a different and worse
 *      thing. The function stays exported and tested — the profile still uses
 *      it — but the browse surface no longer states it.
 *
 * The row is still a ROW: hairline-divided, on the page, no card. That is the
 * one place the anatomy is followed and the styling is not, and it is a real
 * choice rather than an omission — Astrotalk's rows are cards on grey. The
 * argument that put this list on hairlines still holds: a member moves between
 * this list and the inbox constantly, and two list idioms in one app reads as
 * two apps. Reversing it is one style block if Amit wants the cards.
 */
function ProviderRowView({
  provider,
  index,
  isLast,
  onPress,
  onPressAvatar,
  ratePerMin,
  animateEntrance = true,
  showCategory = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const initial = initialOf(provider.display_name);

  /*
   * The tag line. Category leads when there are no tabs above the list to say
   * it (search), which is the same rule the old chip strip used — it is a fact
   * about this person of exactly the tag kind, so it belongs in the same line
   * rather than in a second one.
   *
   * `rowExpertise` caps and dedupes; the slice after it keeps the total at
   * three so a categorised search row does not run four pills wide.
   */
  const tags = [
    ...(showCategory ? [CATEGORY_BADGE[categoryOf(provider)]] : []),
    ...rowExpertise(provider),
  ].slice(0, ROW_EXPERTISE_LIMIT);

  /*
   * Languages as plain text, not pills, which is a reversal of the strip this
   * row used to carry and the reason the horizontally-scrolling ScrollView is
   * gone with it.
   *
   * That scroller existed to stop a second language being clipped, and it cost
   * a three-way gesture negotiation between the strip, the row's Pressable and
   * the vertical FlashList — documented at length in the version this replaces,
   * and the source of "schip scroll is not working correctly". With the tags
   * taking the pill line, languages have a line of their own at the full text
   * width, where two of them fit in plain text with room to spare. Astrotalk
   * renders its `language` line exactly this way, at 17.1dp.
   *
   * Removing the scroller removes the gesture conflict rather than tuning it,
   * which is the only fix for that class that stays fixed.
   */
  const languages = provider.languages.slice(0, 3).join(', ');

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
   * WHICH GLYPH SITS ON THE PRICE, and why it is conditional.
   *
   * Amit asked for "call icon and rs 15/min just like how clarity shows". A
   * phone beside a rate is a claim that the rate buys a call, and
   * `audio_enabled` (migration 064) is a provider's own answer to whether they
   * take them. Showing a phone next to a provider who has switched calls off
   * would quote a price for something that cannot be bought — the same defect
   * class as the composer hints removed in 75ced47, arrived at from the other
   * direction. So a chat glyph when they only type.
   *
   * The RATE is the same either way today (chat and audio are both ₹22/min in
   * `appConfig`), so this changes the picture and not the number. If the two
   * rates ever diverge, this is the site that has to choose, and the comment is
   * here so it gets chosen rather than defaulted.
   */
  const canCall = provider.audio_enabled;

  const accessibility = [
    `Message ${provider.display_name}`,
    presenceForSpeech(presence),
    provider.rating_count > 0
      ? `rated ${provider.rating_avg?.toFixed(1)} from ${provider.rating_count} reviews`
      : 'no reviews yet',
    tags.length > 0 ? tags.join(', ') : null,
    languages === '' ? null : `speaks ${languages}`,
    // Spoken as a sentence, because "₹22/min" is read out as a string of
    // symbols by TalkBack and the rate is the one number here that costs money.
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
        press="none"
        highlight="dim"
        style={styles.row}>
        {/* LEFT COLUMN: the avatar with its rating stacked underneath, which is
            the arrangement that makes the 72dp avatar pay for itself — at 40dp
            the rating had to live in the text column as a chip, competing with
            the facts. Astrotalk stacks a 5-star RatingBar (80×16dp) and
            "10k+ orders" (16.7dp) here; we have one number and a count, so it
            is a figure and a label rather than five glyphs. */}
        <View style={styles.leftColumn}>
          {/* The avatar is its own target: it opens the profile card, while the
              rest of the row opens the conversation. Nested inside the row
              Pressable, the inner one captures taps that land on the photo. */}
          <Pressable
            onPress={() => (onPressAvatar ?? onPress)(provider.id)}
            testID={`provider-avatar-${provider.id}`}
            accessibilityLabel={`${provider.display_name}'s profile`}
            // Folded into the row for TalkBack: the avatar is a sighted-tap
            // shortcut to the profile, not a second focus target overlapping the
            // row. The row's own label already carries who this is; screen-reader
            // users open the conversation (the row's action) and lose nothing.
            accessible={false}
            press="none"
            style={styles.avatarTap}>
            <Avatar
              initial={initial}
              uri={provider.avatar_url}
              size={ROW_AVATAR}
              online={presence.here}
            />
          </Pressable>
          <Text
            allowFontScaling
            numberOfLines={1}
            testID={`provider-rating-${provider.id}`}
            style={styles.rating}>
            {provider.rating_count > 0 ? `★ ${provider.rating_avg?.toFixed(1)}` : '★ New'}
          </Text>
          {/* The count is its own line even when it is empty of content, so the
              left column measures the same on a provider with no reviews as on
              one with a thousand. A column that changes height by 16dp between
              rows is the invariant this list is built on, broken. */}
          <Text allowFontScaling numberOfLines={1} style={styles.ratingCount}>
            {provider.rating_count > 0
              ? `${provider.rating_count} ${provider.rating_count === 1 ? 'rating' : 'ratings'}`
              : 'no ratings yet'}
          </Text>
        </View>

        {/* RIGHT COLUMN: name, tags, languages, then price-and-CTA on one line. */}
        <View style={styles.label}>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
            allowFontScaling
            numberOfLines={1}
            style={styles.name}>
            {provider.display_name}
            {provider.age !== null ? (
              <Text style={styles.nameAge}> {provider.age}</Text>
            ) : null}
          </Text>

          {/* The tag line. A plain non-scrolling row: three pills at 24dp fit
              the text column at every offered value, which is what
              ROW_EXPERTISE_LIMIT is chosen to guarantee, so there is nothing to
              scroll and no gesture to negotiate.

              Rendered as a fixed-height View even when there are no tags, so
              that a provider who has not set any is the same height as one who
              has. `PROVIDER_ROW_HEIGHT` is a promise to FlashList, and a row
              that keeps it only for populated providers does not keep it. */}
          <View style={styles.tagLine} testID={`provider-tags-${provider.id}`}>
            {tags.map(tag => (
              <MetaChip key={tag} size="sm" label={tag} />
            ))}
          </View>

          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {languages === '' ? ' ' : languages}
          </Text>

          <View style={styles.priceLine}>
            <Icon
              name={canCall ? 'call' : 'chat'}
              size={TOKENS.icon.sm}
              color={theme.color.text.secondary}
            />
            <Text allowFontScaling numberOfLines={1} style={styles.price}>
              {formatRupees(ratePerMin)}
              <Text style={styles.perMin}>/min</Text>
            </Text>
            <View style={styles.priceSpacer} />
            {/* The CTA. Not a Pressable: it performs the row's own action, so a
                second touch target on top of the row would be a duplicate — the
                same argument the chevron lost. What it adds is a place for the
                eye to land and a statement of what the row DOES, which is the
                thing the chevron never said. `accessible={false}` keeps it out
                of TalkBack for the same reason: the row's label already names
                the action. */}
            <View style={styles.cta} accessible={false} testID={`provider-cta-${provider.id}`}>
              <Text allowFontScaling numberOfLines={1} style={styles.ctaLabel}>
                Chat
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
      {isLast ? null : <View style={styles.separator} />}
    </Animated.View>
  );
}

export const ProviderRow = memo(ProviderRowView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    // `flex-start`, not `center`: the two columns are different heights by
    // design (112 and 118), and centring would float the avatar 5dp down from
    // the name it belongs to. Astrotalk top-aligns them too.
    alignItems: 'flex-start',
    gap: TOKENS.space.sm,
    paddingVertical: TOKENS.space.sm,
    // The row owns its horizontal margin now, rather than inheriting it from the
    // list's contentContainerStyle. That is what lets the separator below run to
    // the screen's trailing edge with only a leading inset, which is how an iOS
    // plain-list divider is drawn, the old arrangement stopped it 20pt short at
    // both ends and made it read as an underline on the row.
    paddingHorizontal: TOKENS.space.md,
    // No radius, no border, no elevation. The page is the surface now.
    backgroundColor: t.color.bg.base,
  },
  // Fixed width, so every row's text column starts on the same x and the
  // separator inset below stays true. Without it the column would be as wide as
  // the widest of the avatar and the two labels, which varies by rating count.
  leftColumn: {
    width: ROW_AVATAR,
    alignItems: 'center',
  },
  avatarTap: {
    borderRadius: ROW_AVATAR / 2,
    // The Avatar's presence dot sits just past the circle at the bottom-right;
    // without this the rounded tap target clips it in half on Android.
    overflow: 'visible',
    marginBottom: TOKENS.space['2xs'],
  },
  rating: {
    ...TOKENS.typography.labelMedium,
    color: t.color.text.primary,
  },
  ratingCount: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
  },
  // Inset to the text edge, iMessage style. A separator that runs under the
  // avatar cuts the person in half instead of dividing two of them.
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: TOKENS.space.md + ROW_SEPARATOR_INSET,
    backgroundColor: t.color.border.hairline,
  },
  label: {
    flex: 1,
    gap: TOKENS.space.hair,
  },
  // 17/15, which is what an iOS Messages cell is. It was 15/14, one step down the
  // ladder on both lines.
  name: {
    ...TOKENS.typography.titleMediumEmphasized,
    color: t.color.text.primary,
    flexShrink: 1,
  },
  // Age beside the name, subscript — the detail/hero card idiom. Quieter weight
  // and colour so it reads as a modifier of the name, not a second word. A step
  // smaller than the name's neighbours (#11, Amit: "age a little smaller").
  nameAge: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
  },
  // Fixed height and `overflow: hidden`. The height is the row's promise to
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
  priceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_CTA_HEIGHT,
    gap: TOKENS.space['2xs'],
  },
  price: {
    ...TOKENS.typography.labelLarge,
    color: t.color.text.primary,
  },
  // "/min" quieter and smaller than the figure, so the rate reads as one price
  // rather than as two words. Astrotalk splits these into two TextViews at
  // 21.8dp and 17.1dp for the same reason; nested Text is how RN does it.
  perMin: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.tertiary,
  },
  // A spacer rather than `justifyContent: 'space-between'`, because the glyph
  // and the price must stay adjacent to each other while the CTA goes to the
  // far edge — three children and one gap cannot express that.
  priceSpacer: {
    flex: 1,
  },
  /*
   * The CTA. Outlined, not filled, which is the reference and also the right
   * call here: every row has one, and a list of filled accent buttons is a
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
    backgroundColor: t.color.bg.base,
  },
  /*
   * `text/accent`, NOT `bg/accent`, and the two are different greens on
   * purpose: #15603E against #1DAA61 in light mode. `bg/accent` is a FILL
   * colour — it is what a button is painted, with `text/onAccent` on top of it
   * — and setting it as a label colour on a white card gives 2.9:1, under the
   * 4.5:1 AA floor for text. `text/accent` exists for exactly this and is
   * already checked against bg/base by scripts/check-contrast.mjs.
   *
   * The BORDER keeps `bg/accent`, which is the lighter green and matches the
   * reference. A border is a non-text boundary, so 3:1 is its target rather
   * than 4.5 — and it is not the only signal either way, since the label it
   * surrounds says "Chat". The pair is added to check-contrast rather than
   * argued for here, so the claim is verified on every run.
   */
  ctaLabel: {
    ...TOKENS.typography.labelLarge,
    color: t.color.text.accent,
  },
});
