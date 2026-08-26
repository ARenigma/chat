import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { enterRow } from '../theme/motion';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
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
  /** Row body tap: open the conversation. */
  onPress: (provider: ProviderSummary) => void;
  /**
   * Avatar tap: open the profile card. Two targets in one row — the photo is a
   * peek at who they are, the rest of the row is "talk to them" — which is the
   * split every dating/marketplace list uses and what v13 intends.
   */
  onPressAvatar?: (provider: ProviderSummary) => void;
}

const GENDER_SHORT: Record<string, string> = { female: 'F', male: 'M', other: '' };

/** "replies in ~4m". Rounded hard, because precision here would be false. */
function replyLatency(seconds: number | null): string | null {
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
function ProviderRowView({ provider, index, isLast, onPress, onPressAvatar }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const initial = initialOf(provider.display_name);
  const shortGender = provider.gender ? (GENDER_SHORT[provider.gender] ?? '') : '';
  const identity = [shortGender, provider.age !== null ? `${provider.age}` : null]
    .filter(part => part !== null && part !== '')
    .join(' · ');
  const latency = replyLatency(provider.median_reply_seconds);
  const languages = provider.languages.slice(0, 2).join(', ');

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
    <Animated.View entering={enterRow(index)}>
      <Pressable
        onPress={() => onPress(provider)}
        testID={`provider-${provider.id}`}
        accessibilityLabel={accessibility}
        press="none"
        highlight="ios"
        style={styles.row}>
        {/* The avatar is its own target: it opens the profile card, while the
            rest of the row opens the conversation. Nested inside the row
            Pressable, the inner one captures taps that land on the photo. */}
        <Pressable
          onPress={() => (onPressAvatar ?? onPress)(provider)}
          testID={`provider-avatar-${provider.id}`}
          accessibilityLabel={`${provider.display_name}'s profile`}
          // Folded into the row for TalkBack: the avatar is a sighted-tap
          // shortcut to the profile, not a second focus target overlapping the
          // row. The row's own label already carries who this is; screen-reader
          // users open the conversation (the row's action) and lose nothing.
          accessible={false}
          press="none"
          style={styles.avatarTap}>
          <Avatar initial={initial} size={ROW_AVATAR} online={presence.here} />
        </Pressable>
        <View style={styles.label}>
          <View style={styles.topLine}>
            <Text allowFontScaling numberOfLines={1} style={styles.name}>
              {provider.display_name}
            </Text>
            {identity !== '' ? (
              <Text allowFontScaling style={styles.identity}>
                · {identity}
              </Text>
            ) : null}
          </View>
          <Text allowFontScaling numberOfLines={1} style={styles.secondary}>
            {provider.headline !== null && provider.headline !== ''
              ? provider.headline
              : languages !== ''
                ? languages
                : 'Here to listen'}
          </Text>
        </View>

        <View style={styles.trailing}>
          {/* A rating with two reviews behind it is noise dressed as signal, so
              the count is always next to it. */}
          {provider.rating_count > 0 ? (
            <Text testID="provider-rating" allowFontScaling style={styles.rating}>
              ★ {provider.rating_avg?.toFixed(1)}
              <Text style={styles.ratingCount}> · {provider.rating_count}</Text>
            </Text>
          ) : (
            <Text allowFontScaling style={styles.meta}>
              New here
            </Text>
          )}
          {/* Three cases, one rendered. `here` gets the sage line, `away` gets the
              same line in the quiet colour (it is presence either way, and putting
              it in `meta` would make it look like a reply latency), and `hidden`
              falls through to the latency it always fell through to. */}
          {presence.line !== null ? (
            <Text
              allowFontScaling
              style={[styles.presenceText, !presence.here && styles.presenceQuiet]}>
              {presence.line}
            </Text>
          ) : latency !== null ? (
            <Text testID="provider-latency" allowFontScaling style={styles.meta}>
              {latency}
            </Text>
          ) : null}
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
    gap: 2,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: TOKENS.space['2xs'],
  },
  // 17/15, which is what an iOS Messages cell is. It was 15/14, one step down the
  // ladder on both lines.
  name: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
    flexShrink: 1,
  },
  identity: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  secondary: {
    ...TOKENS.typography.subhead,
    color: t.color.text.secondary,
  },
  trailing: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rating: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.primary,
  },
  ratingCount: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  meta: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  presenceText: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.positive,
  },
  // 'Away' and 'Last seen ...' are presence, so they keep the presence type
  // style, but sage means here. In the secondary ink they read as the same fact
  // in a quieter voice rather than as a different kind of information.
  presenceQuiet: {
    color: t.color.text.secondary,
  },
});
