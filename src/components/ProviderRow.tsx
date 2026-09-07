import React, { memo, useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { rowIn } from '../theme/motion';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { META_CHIP_HEIGHT, MetaChip } from './MetaChip';
import { Pressable } from './Pressable';
import { CATEGORY_BADGE, categoryOf } from '../lib/providerFilters';

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
 * 40, not 42: iOS Messages and Contacts both use 40 in a list row, and the two
 * lists in this app should agree with the platform rather than with each other by
 * a couple of points.
 */
export const ROW_AVATAR = 40;

/**
 * Where a row's separator starts: past the avatar, at the text edge.
 *
 * Derived rather than typed as a number, so changing the avatar size cannot leave
 * the separators misaligned by a value nobody remembers is related.
 */
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
 * The terms are the row's own box, top to bottom: `paddingVertical: space.sm`
 * twice, the name line, `space.hair`, the headline line, `space.hair`, the
 * strip's `marginTop: space['2xs']`, and the strip itself at
 * `META_CHIP_HEIGHT`. The separator is 1px and sits OUTSIDE this — it is a
 * sibling of the Pressable, not a child.
 *
 * `__tests__/providerRow.test.ts` pins the arithmetic to 108 from the tokens,
 * so a change to the type scale or the chip height fails there rather than
 * silently mis-hinting the list.
 */
export const PROVIDER_ROW_HEIGHT =
  TOKENS.space.sm * 2 +
  TOKENS.typography.titleMediumEmphasized.lineHeight +
  TOKENS.space.hair +
  TOKENS.typography.bodyMedium.lineHeight +
  TOKENS.space.hair +
  TOKENS.space['2xs'] +
  META_CHIP_HEIGHT;

/**
 * A row in the directory. Not a card any more.
 *
 * It was a white card on a grey page, and that was a reasoned choice: colour
 * difference separates two strangers better than a line does, on the one screen
 * where a member is comparing people side by side. It is being reversed
 * deliberately, not corrected. The reference this now follows puts rows directly
 * on the page divided by hairlines, the way iMessage and WhatsApp do, and the
 * argument for it is consistency: a member moves between this list and the inbox
 * constantly, and two list idioms in one app reads as two apps.
 *
 * Three departures from the reference, all deliberate:
 *
 *   - **No photographs.** Every mockup shows faces. We publish initials, and the
 *     avatar is never `warm`, because washing one stranger's mark in the brand
 *     colour reads as a recommendation nobody made.
 *   - **No price.** One token per message for everyone, an invariant with a SQL
 *     parity test behind it, so a per-provider price would be a lie.
 *   - **Reply latency instead.** The most-upvoted negative review of the app this
 *     was studied from is about a listener who never replied while the meter ran.
 *
 * The language pills that used to sit here are gone. They were the only thing
 * making rows variable-height, and a list whose rows disagree about their height
 * cannot carry a hairline convincingly.
 *
 * Languages came BACK as AssistChips, and the height invariant survived by being
 * enforced instead of assumed: the chip strip is one fixed-height row that
 * SCROLLS sideways (see `styles.strip`) rather than wrapping or being clipped.
 */
function ProviderRowView({
  provider,
  index,
  isLast,
  onPress,
  onPressAvatar,
  animateEntrance = true,
  showCategory = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const initial = initialOf(provider.display_name);
  const latency = replyLatency(provider.median_reply_seconds);
  // Fact chips: experience + top languages. Experience is SEEDED until the
  // directory carries a real column — deterministic per id, stable across renders.
  const chips = [
    ...(showCategory ? [CATEGORY_BADGE[categoryOf(provider)]] : []),
    `${seededExperienceYears(provider.id)} yrs`,
    ...provider.languages.slice(0, 2),
  ].filter(c => c !== '');

  /**
   * The dot and the trailing line both come from `presence` now. They used to
   * come from `is_available`, which is the provider's *listing* switch: it means
   * "listed for discovery and open to new conversations", so a row said somebody
   * was there when it only meant they wanted work. Migration 012 split the two,
   * and `readPresence` is the one reading of it so this row, the inbox and the
   * chat header cannot disagree.
   */
  const presence = readPresence(provider.presence, provider.last_active_at);

  /**
   * The meta strip's scroller, rewound whenever this cell is recycled onto a
   * different provider.
   *
   * A native scroll offset is not React state, and FlashList re-renders the SAME
   * component instance with new props instead of mounting a new one — which is
   * why it ships a hook whose whole job is this class of leftover:
   * `useRecyclingState`, "automatically resets the state when specified
   * dependencies change ... when items are recycled"
   * (@shopify/flash-list@2.3.2 dist/recyclerview/hooks/useRecyclingState.d.ts).
   * Without the rewind, scrolling one row's languages and then scrolling the
   * list would hand the next provider a strip already parked on somebody else's
   * chips. `scrollTo` is the imperative half of that hook, for state Android
   * holds rather than React.
   * https://reactnative.dev/docs/scrollview#scrollto
   */
  const strip = useRef<ScrollView | null>(null);
  useEffect(() => {
    strip.current?.scrollTo({ x: 0, animated: false });
  }, [provider.id]);

  const accessibility = [
    `Message ${provider.display_name}`,
    presenceForSpeech(presence),
    provider.rating_count > 0
      ? `rated ${provider.rating_avg?.toFixed(1)} from ${provider.rating_count} reviews`
      : 'no reviews yet',
    latency,
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
        <View style={styles.label}>
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.name}>
            {provider.display_name}
            {provider.age !== null ? (
              <Text style={styles.nameAge}> {provider.age}</Text>
            ) : null}
          </Text>
          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {provider.headline !== null && provider.headline !== ''
              ? provider.headline
              : 'Here to listen'}
          </Text>
          {/* Material 3 AssistChip strip (32dp / 8dp corners / 1dp outline).
              Rating leads; years + languages follow. Still ONE non-wrapping
              line — it now SCROLLS instead of being clipped.

              THE THREE-WAY GESTURE, which is the whole risk here: a horizontal
              scroller, inside the row's Pressable, inside a vertical FlashList.

              1. A HORIZONTAL DRAG scrolls the strip, and a VERTICAL one scrolls
                 the list, and neither is decided by a prop. Android arbitrates in
                 the parent's `onInterceptTouchEvent`: "If you return `true` from
                 `onInterceptTouchEvent()`, the child view that was previously
                 handling touch events receives an `ACTION_CANCEL`", and the
                 sanctioned test for a scroll is the axis distance against
                 `ViewConfiguration`'s touch slop — "the distance in pixels a
                 user's touch can wander before the gesture is interpreted as
                 scrolling". `ReactHorizontalScrollView extends
                 HorizontalScrollView` (ReactHorizontalScrollView.java:74), so
                 the X-axis slop test is the platform's own, and when it wins RN
                 hands the responder over from JS — `notifyNativeGestureStarted`
                 in `handleInterceptedTouchEvent`
                 (ReactHorizontalScrollView.java:744), which is what cancels the
                 row's press mid-drag instead of firing it on lift.
                 https://developer.android.com/develop/ui/views/touch-and-input/gestures/viewgroup

                 The two props that LOOK like the fix are not, and this is the
                 same finding the hero pager already carries
                 (ProviderDetailScreen.tsx): `directionalLockEnabled` is iOS-only
                 and `nestedScrollEnabled` is the SAME-axis case, "Enables nested
                 scrolling for Android API level 21+".
                 https://reactnative.dev/docs/scrollview#nestedscrollenabled-android
                 https://reactnative.dev/docs/scrollview#directionallockenabled

              2. A TAP still opens the row, and `keyboardShouldPersistTaps` is
                 what makes that true rather than luck. Responder negotiation
                 bubbles — "the deepest node is called first" — so the scroller
                 gets first refusal on every touch that starts on a chip, and at
                 the DEFAULT of `'never'` it accepts one whenever a keyboard is
                 up: "tapping outside of the focused text input when the keyboard
                 is up dismisses the keyboard. When this happens, children won't
                 receive the tap." On the search results list that is exactly a
                 member tapping the middle of a row and getting nothing.
                 `'handled'` — correct for the LIST, which is why HomeScreen sets
                 it there — is also wrong HERE: ScrollView.js:1453-1459 returns
                 true from `onStartShouldSetResponder` under `'handled'` while the
                 keyboard is dismissible, so the strip would swallow that tap too.
                 `'always'` is the one value that declines: "the scroll view will
                 not catch taps, but children of the scroll view can catch taps",
                 and declining is what lets the bubble carry on up to the row's
                 Pressable.
                 https://reactnative.dev/docs/scrollview#keyboardshouldpersisttaps
                 https://reactnative.dev/docs/gesture-responder-system

                 Nothing inside the strip presses. The chips are display-only
                 Views (`accessible={false}` in MetaChip), so there is no inner
                 responder competing for the tap the row wants.

              3. THE ROW'S HEIGHT DOES NOT MOVE: `styles.strip` fixes the
                 scroller at `META_CHIP_HEIGHT`, see the style. */}
          <ScrollView
            ref={strip}
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            {...SCROLL_PHYSICS}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            testID={`provider-meta-${provider.id}`}>
            <MetaChip
              testID="provider-rating"
              tone="emphasis"
              label={
                provider.rating_count > 0
                  ? `★ ${provider.rating_avg?.toFixed(1)}`
                  : '★ New'
              }
            />
            {chips.map(chip => (
              <MetaChip key={chip} label={chip} />
            ))}
          </ScrollView>
        </View>

        {/* The disclosure indicator, which this list had no version of at all.
            Tapping a row here pushes a conversation, which is exactly where iOS
            puts UITableViewCellAccessoryDisclosureIndicator, and its absence was
            the reason a row read as a card that happened to be tappable.

            In its own bounded slot now (ROW_CHEVRON_SLOT), so the width it takes
            from the text column is stated rather than measured, and every row's
            chevron lands on the same centre line. */}
        <View style={styles.chevron}>
          <Icon name="chevronRight" size={TOKENS.icon.sm} color={theme.color.text.tertiary} />
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
    alignItems: 'center',
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
  avatarTap: {
    borderRadius: ROW_AVATAR / 2,
    // The Avatar's presence dot sits just past the circle at the bottom-right;
    // without this the rounded tap target clips it in half on Android.
    overflow: 'visible',
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
  /*
   * M3 AssistChip strip under the headline, in one horizontally scrolling row.
   *
   * A single-row chip group IS the platform's answer, and so is the scroller
   * around it: "A `ChipGroup` can also constrain its chips to a single row using
   * the `app:singleLine` attribute... Using a single row may necessitate
   * wrapping the `ChipGroup` with a `HorizontalScrollView`."
   * https://github.com/material-components/material-components-android/blob/master/docs/components/Chip.md
   *
   * `overflow: 'hidden'` USED TO BE HERE, and it is the defect Amit reported
   * ("full pane occupied for arrow button... which chuts the language chip"):
   * the strip is wider than the text column whenever a provider has two
   * languages, and a hard clip cut the last chip through the middle with nothing
   * on screen to say there was more. A scroller hides the same pixels and hands
   * them back.
   *
   * THE HEIGHT IS FIXED, NOT INTRINSIC, and that is the invariant this list is
   * built on — every row the same height, which is also what HomeScreen promises
   * FlashList through `overrideItemLayout`. A ScrollView's cross-axis size is
   * otherwise measured from its content, so one taller chip could quietly make
   * one row taller than its neighbours. `META_CHIP_HEIGHT` rather than 32, so
   * the scroller cannot drift from the thing it carries.
   */
  strip: {
    height: META_CHIP_HEIGHT,
    marginTop: TOKENS.space['2xs'],
  },
  // The chips' own row, which for a horizontal ScrollView lives on the content
  // container rather than on the scroller. `flexDirection: 'row'` comes from
  // `horizontal`; the gap and the centring are ours.
  // https://reactnative.dev/docs/scrollview#contentcontainerstyle
  stripContent: {
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  // The chevron's bounded slot. `flexShrink: 0` so it never squeezes, `flexGrow:
  // 0` so it never claims the text column's width, and a stated `width` so the
  // glyph's own measurement stops being what the row gives away. See
  // ROW_CHEVRON_SLOT for why 20 and why this is not a second Pressable.
  chevron: {
    width: ROW_CHEVRON_SLOT,
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
});
