import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import type { ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  provider: ProviderSummary;
  index: number;
  divider: boolean;
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

/**
 * A row in the directory.
 *
 * Rebuilt from the Clarity/WeHeal listing, whose rows carry a photo, name,
 * gender and age, a star rating with a review count, a one-line bio and a price.
 * Ours carried a name and "Available now", which means a member choosing between
 * two names is choosing at random — the directory was the weakest screen in the
 * app and it is the one that decides whether anyone spends anything.
 *
 * Two deliberate departures:
 *
 *   - **No price.** Clarity's rows advertise ₹/min. Ours is one token per
 *     message for everyone — an invariant with a SQL parity test behind it — so
 *     a per-provider price would be a lie or a schema change.
 *   - **Reply latency instead.** The most-upvoted negative review of Clarity is
 *     about a listener who never replied while the meter ran. Publishing a median
 *     reply time makes that the provider's problem rather than the member's
 *     discovery.
 */
function ProviderRowView({ provider, index, divider, onPress }: Props) {
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
    <Animated.View
      entering={FadeInDown.delay(index * 50).duration(TOKENS.motion.duration.base)}>
      <Pressable
        onPress={() => onPress(provider)}
        testID={`provider-${provider.id}`}
        accessibilityLabel={accessibility}
        style={[styles.row, divider && styles.divider]}>
        <View style={styles.inner}>
          <Avatar initial={initial} size={42} online={provider.is_available} />
          <View style={styles.label}>
            <View style={styles.topLine}>
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {provider.display_name}
              </Text>
              {identity !== '' ? (
                <Text allowFontScaling style={styles.identity}>
                  {identity}
                </Text>
              ) : null}
            </View>

            {provider.headline !== null && provider.headline !== '' ? (
              <Text allowFontScaling numberOfLines={1} style={styles.headline}>
                {provider.headline}
              </Text>
            ) : null}

            <View style={styles.metaLine}>
              {/* A rating with two reviews behind it is noise dressed as signal,
                  so the count is always shown next to it. */}
              {provider.rating_count > 0 ? (
                <Text testID="provider-rating" allowFontScaling style={styles.meta}>
                  ★ {provider.rating_avg?.toFixed(1)} · {provider.rating_count}
                </Text>
              ) : (
                <Text allowFontScaling style={styles.meta}>
                  New
                </Text>
              )}
              {latency !== null ? (
                <Text testID="provider-latency" allowFontScaling style={styles.meta}>
                  {latency}
                </Text>
              ) : null}
              {provider.languages.length > 0 ? (
                <Text allowFontScaling numberOfLines={1} style={styles.meta}>
                  {provider.languages.slice(0, 2).join(', ')}
                </Text>
              ) : null}
            </View>
          </View>
          <Icon glyph="chevron-right" size={16} color={TOKENS.color.text.secondary} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const ProviderRow = memo(ProviderRowView);

const styles = StyleSheet.create({
  row: {
    paddingVertical: TOKENS.space.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.color.border.hairline,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
  },
  label: {
    flex: 1,
    gap: 3,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: TOKENS.space.xs,
  },
  name: {
    ...TOKENS.typography.bodyLarge,
    fontWeight: '500',
    color: TOKENS.color.text.primary,
    flexShrink: 1,
  },
  identity: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  headline: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.primary,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
  },
  meta: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
});
