import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import { TOKENS } from '../theme/tokens';

type Size = 26 | 32 | 42 | 56;

interface Props {
  initial: string;
  size?: Size;
  /** Warm applies the accent tint. Reserved for the 56pt mark — see accent budget. */
  tone?: 'neutral' | 'warm';
  online?: boolean;
  /** Slow breathing scale, so she reads as present rather than static. */
  breathing?: boolean;
  testID?: string;
}

const FONT: Record<Size, number> = { 26: 11, 32: 13, 42: 15, 56: 20 };

function AvatarView({
  initial,
  size = 42,
  tone = 'neutral',
  online = false,
  breathing = false,
  testID,
}: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!breathing) {
      return;
    }
    const half = TOKENS.motion.duration.breath / 2;
    scale.value = withRepeat(
      withSequence(withTiming(1.015, { duration: half }), withTiming(1, { duration: half })),
      -1,
      false,
    );
  }, [breathing, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const dot = size <= 32 ? 10 : 13;

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.host,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor:
            tone === 'warm' ? TOKENS.color.bg.accentTint : TOKENS.color.bg.sunken,
        },
        animated,
      ]}>
      <Text
        allowFontScaling={false}
        style={[styles.initial, { fontSize: FONT[size] }]}>
        {initial}
      </Text>
      {online ? (
        <View
          style={[
            styles.ring,
            { width: dot, height: dot, borderRadius: dot / 2 },
          ]}>
          <View
            style={{
              width: dot - 4,
              height: dot - 4,
              borderRadius: (dot - 4) / 2,
              backgroundColor: TOKENS.color.state.available,
            }}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

export const Avatar = memo(AvatarView);

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: '500',
    color: TOKENS.color.text.primary,
  },
  ring: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.base,
  },
});
