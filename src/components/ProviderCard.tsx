import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { offeredChannelsLine, presenceForSpeech, readPresence } from '../lib/presence';
import { rowIn } from '../theme/motion';
import { avatarImageSource } from '../lib/clayAvatars';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { Icon } from './Icon';
import { META_CHIP_HEIGHT, MetaChip } from './MetaChip';
import { Pressable } from './Pressable';
import { replyLatency, seededExperienceYears } from './ProviderRow';

/**
 * M3 Card for the Favourites tab.
 *
 * Variant: outlined — not filled.
 * Reason: in light mode `bg.raised` === `bg.base` (#FFFFFF), so a filled card is
 * invisible against the page. Outlined adds a 1dp `border.strong` ring that
 * separates the card from the background in both themes without elevation.
 * Spec: https://m3.material.io/components/cards/specs
 * Guidelines: https://m3.material.io/components/cards/guidelines
 *
 * Card layout (M3 content padding: 16dp; 12dp corner radius default in spec —
 * this app uses `radius.lg` = 20dp, a deliberate departure sized to match the
 * sheet/screen corner family):
 *
 *   ┌─ Card (outlined, radius.lg) ────────────────────┐
 *   │  [Avatar 56]  Name (Age?)                       │
 *   │               "Headline or About snippet"       │
 *   │                                                 │
 *   │  [★ 4.8] [2 yrs] [EN] [replies ~4m]            │
 *   └─────────────────────────────────────────────────┘
 *
 * Avatar: 56dp — cards can afford more than the 40dp directory row; 56 is the
 * next step in the Avatar size ladder and matches M3 list leading-image guidance.
 */

/** 56dp avatar. Larger than the 40dp row; cards have horizontal room to afford it. */
const CARD_AVATAR = 56 as const;

/**
 * Estimated rendered height per card, including a 12dp bottom margin.
 * Used by FlashList's `overrideItemLayout` to skip the first-frame measure.
 * Derivation: padding(16×2) + header(~67, name+body 2-line) + gap(12) + chips(32) + margin(12) = 155.
 * FlashList self-corrects on first layout; this is a best-guess to prevent initial
 * blank-frame flicker on a long list.
 */
export const CARD_ITEM_HEIGHT = 155;

interface Props {
  provider: ProviderSummary;
  index: number;
  /**
   * Card tap: open the conversation. Receives the provider id (not the full
   * summary) so the parent can hoist a stable `useCallback` without wrapping
   * the object — same contract as ProviderRow.
   */
  onPress: (id: string) => void;
  /**
   * Avatar tap: open the profile card. Same id-only contract as onPress.
   */
  onPressAvatar?: (id: string) => void;
  /**
   * Whether to run the entrance animation. Set to false for FlashList-recycled
   * cells that have already entered so scroll-back does not re-fire the stagger.
   */
  animateEntrance?: boolean;
}

function ProviderCardView({
  provider,
  index,
  onPress,
  onPressAvatar,
  animateEntrance,
}: Props) {
  const styles = useStyles(makeStyles);

  const initial = initialOf(provider.display_name);
  const latency = replyLatency(provider.median_reply_seconds);

  // The dot and its spoken line: the server's `online` or last seen (migration
  // 155), through the one reading ProviderRow and the chat header use.
  const presence = readPresence({
    online: provider.online,
    lastSeenAt: provider.last_seen_at,
    now: new Date(),
  });

  /*
   * AWAY, AND THE ONE THING THIS CARD OFFERS.
   *
   * `!provider.is_available`, the same test the directory row applies
   * (ProviderRow.tsx). The switch, not the dot: open but not active in the
   * last 75 s is still reachable, so only a closed switch is away.
   *
   * This card has never had a Call or a Video on it, so there is nothing here
   * to withdraw; what it was missing is the other half of the rule. Its body
   * opens the conversation, and opening a conversation with somebody who is
   * away is precisely what notifies them (`announce_chat_open`, migration 068),
   * so the card already DOES the notify — it just never said so. The marker
   * below says it, in the same bell + verb the row uses, and the spoken label
   * stops promising a message to someone who is not there to read it.
   */
  const away = !provider.is_available;
  /*
   * What they are open to, when it is not everything. Suppressed while away
   * because closed outranks the channel set: there is nothing to do with any of
   * the three until they come back, and naming a limit on top of that reads as
   * two refusals.
   */
  const channelLine = away ? null : offeredChannelsLine(provider);

  // Fact chips: experience (seeded placeholder), top languages, reply latency.
  // Cards have more horizontal room than rows; latency earns a chip here.
  const chips = [
    `${seededExperienceYears(provider.id)} yrs`,
    ...provider.languages.slice(0, 2),
    ...(latency != null ? [latency] : []),
  ].filter(c => c !== '');

  // Body: prefer `about` (longer paragraph) then fall back to headline.
  const bodyText = provider.about?.trim() || provider.headline?.trim() || null;

  const accessibility = [
    away
      ? `Notify ${provider.display_name} that you want to chat`
      : `Message ${provider.display_name}`,
    presenceForSpeech(presence),
    channelLine,
    provider.rating_count > 0
      ? `rated ${provider.rating_avg?.toFixed(1)} from ${provider.rating_count} reviews`
      : 'no reviews yet',
    latency,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View entering={animateEntrance !== false ? rowIn(index) : undefined}>
      <Card variant="outlined" style={styles.card}>
        {/* Whole card is the press target.
            The Card's overflow:hidden clips the Pressable state layer to the
            card's rounded shape, so the ripple never bleeds over the corners. */}
        <Pressable
          onPress={() => onPress(provider.id)}
          testID={`provider-card-${provider.id}`}
          accessibilityLabel={accessibility}
          accessibilityRole="button"
          press="card"
          style={styles.inner}>
          <View style={styles.header}>
            {/* Avatar has its own tap target (opens profile), nested inside the
                card Pressable (opens conversation). Same pattern as ProviderRow.
                accessible={false} folds it into the card for TalkBack — the card's
                label already names the provider. */}
            <Pressable
              onPress={() => (onPressAvatar ?? onPress)(provider.id)}
              testID={`provider-card-avatar-${provider.id}`}
              accessibilityLabel={`${provider.display_name}'s profile`}
              accessible={false}
              press="none"
              style={styles.avatarTap}>
              <Avatar
                initial={initial}
                uri={provider.avatar_url}
                size={CARD_AVATAR}
                online={presence.here}
              />
            </Pressable>
            <View style={styles.nameBlock}>
              <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.name}>
                {provider.display_name}
                {provider.age !== null ? (
                  <Text style={styles.nameAge}> {provider.age}</Text>
                ) : null}
              </Text>
              {/* Directly under the name, above the About snippet: it qualifies
                  who you are looking at rather than describing them, so it
                  reads before the paragraph and not after it. */}
              {channelLine !== null ? (
                <Text allowFontScaling numberOfLines={1} style={styles.channelLine}>
                  {channelLine}
                </Text>
              ) : null}
              {bodyText != null ? (
                <Text allowFontScaling numberOfLines={2} style={styles.body}>
                  {bodyText}
                </Text>
              ) : null}
            </View>
          </View>
          {/* M3 AssistChip strip — same geometry as ProviderRow (32dp height, 8dp
              corners, 1dp outline). Wraps rather than truncating so a card with
              many chips does not hide data. Chips drive the height estimate above.
              https://m3.material.io/components/chips/specs */}
          <View style={styles.chips}>
            {/* The away marker LEADS the strip, because it is the one item in
                it that is about what happens next rather than about who they
                are. Chip geometry and `emphasis` colours so it sits in the row
                as a peer of the rating rather than as a loose label, and
                neutral ink rather than the coral: ProviderCard is not on the
                accent budget (theme.test.ts:1713) and a "they are out" state is
                not what that budget is reserved for. */}
            {away ? (
              <View accessible={false} testID="provider-notify" style={styles.notify}>
                <Icon
                  name="bell"
                  size={TOKENS.icon.xs}
                  color={styles.notifyLabel.color as string}
                />
                <Text allowFontScaling numberOfLines={1} style={styles.notifyLabel}>
                  Notify
                </Text>
              </View>
            ) : null}
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
        </Pressable>
      </Card>
    </Animated.View>
  );
}

export const ProviderCard = memo(ProviderCardView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      // Bottom margin is the gap between consecutive cards in the Favourites list.
      marginBottom: TOKENS.space.sm,
    },
    inner: {
      // M3 cards: 16dp content padding on all sides.
      // https://m3.material.io/components/cards/specs
      padding: TOKENS.space.md,
      gap: TOKENS.space.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
    },
    avatarTap: {
      borderRadius: CARD_AVATAR / 2,
    },
    nameBlock: {
      flex: 1,
      // 2dp top nudge aligns the name's cap-height with the avatar's optical
      // centre, avoiding the gap you get when baseline-aligning to a circle.
      paddingTop: TOKENS.space.hair,
      gap: 3,
    },
    name: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      flexShrink: 1,
    },
    nameAge: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    body: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    // Primary ink against the body's secondary: this line narrows what the card
    // is offering, so it outranks the provider's own paragraph about themselves.
    channelLine: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.primary,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
    },
    /*
     * MetaChip's own geometry, repeated rather than imported, because MetaChip
     * takes a `label` string and this needs a glyph beside the word — and the
     * glyph is the point (ProviderRow.tsx:427: a bell says something the word
     * cannot, that this is a different KIND of thing from the tags around it).
     * The numbers come from META_CHIP_HEIGHT and the chip's own style block so a
     * row of mixed items stays one height. The label keeps
     * `labelMediumEmphasized`'s own weight rather than MetaChip's step down to
     * SemiBold: this item leads the strip, the facts beside it do not.
     */
    notify: {
      height: META_CHIP_HEIGHT,
      minHeight: META_CHIP_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      // 8dp, not the 2dp this copied from ProviderRow's pre-2026-09-17 geometry.
      // Amit rejected FOUR on the row as "one smudged shape"; this was half that,
      // and the bell renders at ICON_SCALE 1.2 so its box is wider than nominal.
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.sm,
      borderRadius: TOKENS.radius.xs,
      borderCurve: 'continuous',
      borderWidth: 1,
      // Grey border + grey ink (Amit, 2026-09-13): the away/Notify marker is a
      // quiet status, not an action to draw the eye. border.hairline is the app's
      // subtle grey rule (border.strong read as a hard dark outline), and the
      // label + bell drop to text.tertiary — the same muted grey the card's
      // nameAge and other captions use. The bell reads styles.notifyLabel.color,
      // so this one change greys both the word and the glyph.
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    notifyLabel: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.tertiary,
    },
  });

// ── Square 2-column grid card ─────────────────────────────────────────────────

/** Half-gap between the two columns. Applied as marginRight/Left on each item. */
const HALF_COL_GAP = TOKENS.space.sm / 2; // 6dp → total gap 12dp

/**
 * Estimated rendered height for one row of the 2-column Favourites grid.
 *
 * Derivation for a ~375dp phone:
 *   column width = (375 - 2×16 padding - 12 gap) / 2 = 165.5dp (card is square)
 *   + 12dp marginBottom = 177.5dp
 * FlashList self-corrects after first layout; this prevents initial blank frames.
 */
export const SQUARE_CARD_ESTIMATE = 178;

interface SquareProps {
  provider: ProviderSummary;
  index: number;
  onPress: (id: string) => void;
  animateEntrance?: boolean;
}

/**
 * Square M3 "saved" card for the 2-column Favourites grid.
 *
 * The provider's avatar image fills the top flex area (most of the 1:1 card).
 * Name and a secondary line (headline or presence) sit in a compact footer.
 * Modelled on the M3 cards "saved" showcase:
 * https://m3.material.io/components/cards/overview
 *
 * Column gap (12dp total) is applied as symmetric left/right margins on the
 * Animated.View wrapper so FavouritesScreen needs no per-item layout logic.
 */
function SquareProviderCardView({
  provider,
  index,
  onPress,
  animateEntrance,
}: SquareProps) {
  const styles = useStyles(makeSquareStyles);

  const initial = initialOf(provider.display_name);
  const coverSource = avatarImageSource(provider.avatar_url, 300, 300, 85);
  const presence = readPresence({
    online: provider.online,
    lastSeenAt: provider.last_seen_at,
    now: new Date(),
  });
  // Same readings, same tests as the portrait card above and as ProviderRow:
  // the badge slot on the cover carries the dot when they are online (the
  // server's `online`), the one action that works when the switch is closed,
  // and nothing when they are open but idle. This card opens the PROFILE,
  // where an away provider's only action is Notify, so the marker names where
  // the tap goes rather than promising a call the profile no longer offers.
  const away = !provider.is_available;

  /*
   * The footer's one line, and the limit takes it when there is one.
   *
   * A 165dp square has room for a name and a line; the headline is the
   * provider's own sentence about themselves and this is what a tap will and
   * will not lead to, so it goes first. The full-set case is unchanged.
   */
  const secondaryLine =
    (away ? null : offeredChannelsLine(provider)) ??
    (provider.headline?.trim() || presenceForSpeech(presence));

  // Even indices land in the left column; odd in the right.
  const isLeft = index % 2 === 0;

  return (
    <Animated.View
      style={isLeft ? styles.itemLeft : styles.itemRight}
      entering={animateEntrance !== false ? rowIn(index) : undefined}>
      <Card variant="outlined" style={styles.card}>
        {/* Card overflow:hidden clips the Pressable state-layer to the rounded
            card shape — same pattern as the portrait ProviderCard above. */}
        <Pressable
          onPress={() => onPress(provider.id)}
          testID={`provider-sq-${provider.id}`}
          accessibilityLabel={provider.display_name}
          accessibilityRole="button"
          press="card"
          style={styles.inner}>
          {/* Cover: provider photo fills the area; initials Avatar as fallback */}
          <View style={styles.cover}>
            {coverSource !== null ? (
              <Image
                source={coverSource}
                style={styles.coverImage}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={styles.coverFallback}>
                <Avatar initial={initial} size={56} />
              </View>
            )}
            {/* Presence dot: top-right badge, ring matches card background —
                or, when they are not here, the action that replaces it. The
                pill is OPAQUE `bg/base` with `text/primary` on it for the same
                reason the dot's ring is: this corner of the cover is a photo
                with no scrim over it, so white or translucent ink is unreadable
                over a light one, and cutting the badge out of the image is what
                this card already does to stay legible. */}
            {away ? (
              <View accessible={false} testID="provider-sq-notify" style={styles.notify}>
                <Icon
                  name="bell"
                  size={TOKENS.icon.xs}
                  color={styles.notifyLabel.color as string}
                />
                <Text allowFontScaling numberOfLines={1} style={styles.notifyLabel}>
                  Notify
                </Text>
              </View>
            ) : presence.here ? (
              <View style={styles.presenceRing}>
                <View style={styles.presenceDot} />
              </View>
            ) : null}
          </View>
          {/* Footer */}
          <View style={styles.footer}>
            <Text allowFontScaling numberOfLines={1} style={styles.cardName}>
              {provider.display_name}
            </Text>
            {secondaryLine ? (
              <Text allowFontScaling numberOfLines={1} style={styles.cardSub}>
                {secondaryLine}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Card>
    </Animated.View>
  );
}

export const SquareProviderCard = memo(SquareProviderCardView);

const makeSquareStyles = (t: Theme) =>
  StyleSheet.create({
    itemLeft: {
      marginRight: HALF_COL_GAP,
      marginBottom: TOKENS.space.sm,
    },
    itemRight: {
      marginLeft: HALF_COL_GAP,
      marginBottom: TOKENS.space.sm,
    },
    // aspectRatio:1 makes the card square regardless of column width.
    card: {
      aspectRatio: 1,
    },
    inner: {
      flex: 1,
    },
    cover: {
      flex: 1,
      // Shown while the remote image loads (or as the permanent fallback bg).
      backgroundColor: t.color.bg.sunken,
    },
    // Fills the entire cover View via absolute positioning; Card overflow:hidden
    // clips it to the card's rounded corners.
    coverImage: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    coverFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presenceRing: {
      position: 'absolute',
      top: TOKENS.space.xs,
      right: TOKENS.space.xs,
      width: 14,
      height: 14,
      borderRadius: 7,
      // Ring colour matches card background to cut the dot away from the image.
      backgroundColor: t.color.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presenceDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.color.state.available,
    },
    // The away state's marker, in the dot's slot. `labelSmall` rather than the
    // portrait card's 12dp: this pill sits on a ~165dp card and has to leave the
    // face under it visible, which is the same budget argument the card's own
    // footer makes.
    notify: {
      position: 'absolute',
      top: TOKENS.space.xs,
      right: TOKENS.space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      // Same correction as `notify` above, and the padding with it: 4dp of
      // horizontal room around a glyph and a word is what made the badge read as
      // touching its own border.
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.xs,
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.base,
    },
    notifyLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.primary,
    },
    footer: {
      paddingHorizontal: TOKENS.space.sm,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.xs,
      gap: TOKENS.space.hair,
    },
    cardName: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.primary,
    },
    cardSub: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
  });
