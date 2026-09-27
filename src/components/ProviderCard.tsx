import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf, providerFirstName } from '../lib/display';
import { offeredChannelsLine, presenceForSpeech, readPresence } from '../lib/presence';
import { rowIn } from '../theme/motion';
import { avatarImageSource } from '../lib/clayAvatars';
import { Avatar } from './Avatar';
import { Card } from './Card';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

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
  const styles = useStyles(makeStyles);

  const initial = initialOf(provider.display_name);
  const firstName = providerFirstName(provider.display_name);
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
          accessibilityLabel={firstName}
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
              {firstName}
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

const makeStyles = (t: Theme) =>
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
