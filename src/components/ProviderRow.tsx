import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import type { ProviderSummary } from '../lib/database.types';
import { availabilityLabel, initialOf } from '../lib/display';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  provider: ProviderSummary;
  index: number;
  divider: boolean;
  onPress: (provider: ProviderSummary) => void;
}

/**
 * A row in the directory. Where the persona row carried a hand-written tagline,
 * this carries availability — the only thing about a real person that is both
 * true right now and worth a member's attention before they open a thread.
 */
function ProviderRowView({ provider, index, divider, onPress }: Props) {
  const initial = initialOf(provider.display_name);
  const availability = availabilityLabel(provider.is_available);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).duration(TOKENS.motion.duration.base)}>
      <Pressable
        onPress={() => onPress(provider)}
        testID={`provider-${provider.id}`}
        accessibilityLabel={`Message ${provider.display_name}. ${availability}`}
        style={[styles.row, divider && styles.divider]}>
        <View style={styles.inner}>
          <Avatar initial={initial} size={42} online={provider.is_available} />
          <View style={styles.label}>
            <Text allowFontScaling style={styles.name}>
              {provider.display_name}
            </Text>
            <Text allowFontScaling style={styles.meta}>
              {availability}
            </Text>
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
    gap: 2,
  },
  name: {
    ...TOKENS.typography.bodyLarge,
    fontWeight: '500',
    color: TOKENS.color.text.primary,
  },
  meta: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
});
