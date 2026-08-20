import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import type { Persona } from '../lib/personas';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  persona: Persona;
  index: number;
  divider: boolean;
  onPress: (persona: Persona) => void;
}

function CompanionRowView({ persona, index, divider, onPress }: Props) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).duration(TOKENS.motion.duration.base)}>
      <Pressable
        onPress={() => onPress(persona)}
        testID={`persona-${persona.id}`}
        accessibilityLabel={`Chat with ${persona.name}. ${persona.tagline}`}
        style={[styles.row, divider && styles.divider]}>
        <View style={styles.inner}>
          <Avatar initial={persona.initial} size={42} online={persona.online} />
          <View style={styles.label}>
            <Text allowFontScaling style={styles.name}>
              {persona.name}
            </Text>
            <Text allowFontScaling style={styles.tagline}>
              {persona.tagline}
            </Text>
          </View>
          <Icon glyph="chevron-right" size={16} color={TOKENS.color.text.secondary} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export const CompanionRow = memo(CompanionRowView);

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
  tagline: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
});
