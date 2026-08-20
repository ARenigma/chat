import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { Avatar } from './Avatar';

const AVATAR_SLOT = 26;

interface AssistantProps {
  message: string;
  initial: string;
  /** First of a group shows the avatar; continued turns keep the slot, hide the mark. */
  first: boolean;
  timestamp?: string;
  animate?: boolean;
}

/**
 * Her words are not in a bubble. The reply IS the content, and a container around
 * it adds chrome carrying no information. The avatar slot is always reserved so
 * the text edge never shifts between a first and a continued turn.
 */
function AssistantTurnView({ message, initial, first, timestamp, animate }: AssistantProps) {
  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(TOKENS.motion.duration.base).springify() : undefined}
      style={styles.assistantRow}>
      <View style={styles.slot}>
        {first ? <Avatar initial={initial} size={26} /> : null}
      </View>
      <View style={styles.assistantColumn}>
        <Text testID="bubble-assistant" allowFontScaling style={styles.assistantText}>
          {message}
        </Text>
        {timestamp ? <Text style={styles.stamp}>{timestamp}</Text> : null}
      </View>
    </Animated.View>
  );
}

export const AssistantTurn = memo(AssistantTurnView);

interface UserProps {
  message: string;
  timestamp?: string;
}

/** His words get the container. That asymmetry separates the voices without colour. */
function UserTurnView({ message, timestamp }: UserProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
      style={styles.userColumn}>
      <View style={styles.bubble}>
        <Text testID="bubble-user" allowFontScaling style={styles.userText}>
          {message}
        </Text>
      </View>
      {timestamp ? <Text style={styles.stamp}>{timestamp}</Text> : null}
    </Animated.View>
  );
}

export const UserTurn = memo(UserTurnView);

const styles = StyleSheet.create({
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.xs,
  },
  slot: {
    width: AVATAR_SLOT,
  },
  assistantColumn: {
    flex: 1,
    paddingRight: TOKENS.space.xl + TOKENS.space['2xs'],
    gap: TOKENS.space['2xs'],
  },
  assistantText: {
    ...TOKENS.typography.bodyLarge,
    color: TOKENS.color.text.primary,
  },
  userColumn: {
    alignItems: 'flex-end',
    gap: TOKENS.space['2xs'],
  },
  bubble: {
    maxWidth: '76%',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    backgroundColor: TOKENS.color.bg.inverse,
    borderTopLeftRadius: TOKENS.radius.lg,
    borderTopRightRadius: TOKENS.radius.lg,
    borderBottomLeftRadius: TOKENS.radius.lg,
    borderBottomRightRadius: TOKENS.radius.tail,
  },
  userText: {
    ...TOKENS.typography.bodyLarge,
    color: TOKENS.color.text.onInverse,
  },
  stamp: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
});
