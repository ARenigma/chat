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
import { MetaChip } from './MetaChip';
import { Pressable } from './Pressable';

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
 */
function ProviderRowView({ provider, index, isLast, onPress, onPressAvatar, animateEntrance }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const initial = initialOf(provider.display_name);
  const latency = replyLatency(provider.median_reply_seconds);
  // Fact chips: experience + top languages. Experience is SEEDED until the
  // directory carries a real column — deterministic per id, stable across renders.
  const chips = [
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
        highlight="ios"
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
          <Text allowFontScaling numberOfLines={1} style={styles.name}>
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
              Rating leads; years + languages follow. One non-wrapping line so
              every row stays the same height. */}
          <View style={styles.chips}>
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
          </View>
        </View>

        {/* The disclosure indicator, which this list had no version of at all.
            Tapping a row here pushes a conversation, which is exactly where iOS
            puts UITableViewCellAccessoryDisclosureIndicator, and its absence was
            the reason a row read as a card that happened to be tappable. */}
        <Icon name="chevronRight" size={13} color={theme.color.text.tertiary} />
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
  // M3 AssistChip strip under the headline. Clipped to one line so a chip can
  // never make one row taller than its neighbours.
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    marginTop: TOKENS.space['2xs'],
    overflow: 'hidden',
  },
  secondary: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
});
