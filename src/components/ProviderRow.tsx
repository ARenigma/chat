import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { enterRow } from '../theme/motion';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';

interface Props {
  provider: ProviderSummary;
  index: number;
  onPress: (provider: ProviderSummary) => void;
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

const MORPH = { from: TOKENS.radius.lg, to: TOKENS.radius.pressCard };

/**
 * A card in the directory, no longer a row.
 *
 * The content is unchanged and the container is not: a white card on warm paper
 * separates two people far better than a hairline between two rows, and this is
 * the screen where a member is comparing strangers side by side. It is also the
 * one structural idea every reference shared — pure-white cards on an off-white
 * page, with the colour difference doing the work a shadow usually does badly.
 *
 * Two deliberate departures from the apps this was modelled on:
 *
 *   - **No price.** Their rows advertise ₹/min. Ours is one token per message for
 *     everyone — an invariant with a SQL parity test behind it — so a
 *     per-provider price would be a lie or a schema change.
 *   - **Reply latency instead.** The most-upvoted negative review of the app this
 *     was studied from is about a listener who never replied while the meter ran.
 *     Publishing a median reply time makes that the provider's problem rather
 *     than the member's discovery.
 *
 * The avatar is never `warm`. Washing one stranger's mark in the brand colour
 * reads as a recommendation, and nobody made one.
 */
function ProviderRowView({ provider, index, onPress }: Props) {
  const styles = useStyles(makeStyles);
  const initial = initialOf(provider.display_name);
  const shortGender = provider.gender ? (GENDER_SHORT[provider.gender] ?? '') : '';
  const identity = [shortGender, provider.age !== null ? `${provider.age}` : null]
    .filter(part => part !== null && part !== '')
    .join(' · ');
  const latency = replyLatency(provider.median_reply_seconds);

  const accessibility = [
    `Message ${provider.display_name}`,
    provider.is_available ? 'available now' : 'away',
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
        press="card"
        morph={MORPH}
        style={styles.card}>
        <View style={styles.head}>
          <Avatar initial={initial} size={42} online={provider.is_available} />
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

            {provider.headline !== null && provider.headline !== '' ? (
              <Text allowFontScaling numberOfLines={2} style={styles.headline}>
                {provider.headline}
              </Text>
            ) : null}

            {provider.languages.length > 0 ? (
              <View style={styles.tags}>
                {provider.languages.slice(0, 3).map(lang => (
                  <View key={lang} style={styles.tag}>
                    <Text allowFontScaling style={styles.tagText}>
                      {lang}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.foot}>
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
          {provider.is_available ? (
            <View style={styles.presence}>
              <View style={styles.presenceDot} />
              <Text allowFontScaling style={styles.presenceText}>
                Here now
              </Text>
            </View>
          ) : latency !== null ? (
            <Text testID="provider-latency" allowFontScaling style={styles.meta}>
              {latency}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const ProviderRow = memo(ProviderRowView);

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.lg,
    backgroundColor: t.color.bg.raised,
    borderWidth: 1,
    borderColor: t.color.border.hairline,
    ...TOKENS.elevation.card,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.sm,
  },
  label: {
    flex: 1,
    gap: 3,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: TOKENS.space['2xs'],
  },
  name: {
    ...TOKENS.typography.labelMedium,
    color: t.color.text.primary,
    flexShrink: 1,
  },
  identity: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  headline: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.secondary,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space['2xs'],
    paddingTop: TOKENS.space['2xs'],
  },
  tag: {
    paddingHorizontal: TOKENS.space.xs,
    paddingVertical: 3,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: t.color.bg.sunken,
  },
  tagText: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: TOKENS.space.sm,
    paddingTop: TOKENS.space.sm,
    borderTopWidth: 1,
    borderTopColor: t.color.border.hairline,
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
  presence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  presenceDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: t.color.state.available,
  },
  presenceText: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.positive,
  },
});
