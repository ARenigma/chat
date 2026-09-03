import React, { memo } from 'react';
import { Image, PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { rowIn } from '../theme/motion';
import { sizedStorageImageUri } from '../lib/storageImage';
import { isClayUri, resolveAvatarSource } from '../lib/clayAvatars';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { MetaChip } from './MetaChip';
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

  // Derives presence the same way ProviderRow and ChatScreen do — one reading
  // of the two-field pair, so the dot and the availability label cannot disagree.
  const presence = readPresence(provider.presence, provider.last_active_at);

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
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {provider.display_name}
                {provider.age !== null ? (
                  <Text style={styles.nameAge}> {provider.age}</Text>
                ) : null}
              </Text>
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
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
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
  const presence = readPresence(provider.presence, provider.last_active_at);

  // Prefer headline for the secondary line; fall back to spoken presence label.
  const secondaryLine = provider.headline?.trim() || presenceForSpeech(presence);

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
            {provider.avatar_url != null ? (
              <Image
                source={
                  isClayUri(provider.avatar_url)
                    ? (resolveAvatarSource(provider.avatar_url) as number)
                    : {
                        uri: sizedStorageImageUri(
                          provider.avatar_url,
                          300,
                          300,
                          PixelRatio.get(),
                          85,
                        ),
                      }
                }
                style={styles.coverImage}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={styles.coverFallback}>
                <Avatar initial={initial} size={56} />
              </View>
            )}
            {/* Presence dot: top-right badge, ring matches card background */}
            {presence.here ? (
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
