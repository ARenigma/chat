import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { DURATION, fadeTo, springTo } from '../theme/motion';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  onPress: () => void;
  disabled: boolean;
  /** Increments on each successful send, triggering one bloom. */
  bloomKey: number;
}

const SIZE = 40;

/**
 * The most-touched element in the app, and the one place the signature motion
 * lives.
 *
 * Pressing it **squashes** rather than shrinks: `press="send"` scales to 0.86
 * and then multiplies Y by a further 0.78, so the circle briefly flattens like
 * something taking weight. Uniform scaling reads as "the button got smaller";
 * non-uniform scaling reads as mass. The bubble that arrives a moment later
 * enters with the matching stretch (see `bubbleLaunch`), so the two halves of
 * one gesture rhyme — squeezed here, released there.
 *
 * On release it emits a single ring. One ring, not a particle system: the point
 * is to confirm a token was spent, and confirmation is a full stop rather than a
 * celebration. The ring is driven 1 → 0 so an idle button carries no halo, which
 * an earlier version did — a permanent 18% wash that looked like a rendering bug.
 */
function SendButtonView({ onPress, disabled, bloomKey }: Props) {
  const bloom = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (bloomKey === 0) {
      return;
    }
    bloom.value = 1;
    bloom.value = fadeTo(0, DURATION.slow);
    // The ring's *size* is a spring while its opacity is a fade. That split is
    // deliberate: a ring that expands on a curve looks like a loading state,
    // and one that fades on a spring flickers at the tail.
    ring.value = 0;
    ring.value = springTo(1, 'gentle');
  }, [bloomKey, bloom, ring]);

  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloom.value * 0.2,
    transform: [{ scale: 1 + ring.value * 0.85 }],
  }));

  return (
    <View style={styles.host}>
      <Animated.View pointerEvents="none" style={[styles.bloom, bloomStyle]} />
      <Pressable
        onPress={onPress}
        disabled={disabled}
        press="send"
        testID="composer-send"
        accessibilityLabel="Send message"
        accessibilityHint="Spends one token"
        style={[styles.button, disabled && styles.buttonDisabled]}>
        <Icon
          glyph="arrow-up"
          size={20}
          color={disabled ? TOKENS.color.text.tertiary : TOKENS.color.text.onAccent}
        />
      </Pressable>
    </View>
  );
}

export const SendButton = memo(SendButtonView);

const styles = StyleSheet.create({
  host: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloom: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: TOKENS.color.bg.accent,
  },
  // accentStrong, not accent: the glyph inside is white, and the lighter coral
  // does not carry white text. The measured pair is 5.2:1.
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.accentStrong,
  },
  buttonDisabled: {
    backgroundColor: TOKENS.color.bg.sunken,
  },
});
