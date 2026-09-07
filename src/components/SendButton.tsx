import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION, fadeTo, springTo } from '../theme/motion';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

interface Props {
  onPress: () => void;
  disabled: boolean;
  /** Increments on each successful send, triggering one confirmation halo. */
  sendHaloKey: number;
}

// 38: a prominent circular send, the Sweprek proportion Amit asked to match
// (the 32 iOS-sized button read as small against the field). hitSlop from
// INTERACTION.minTarget still carries the target.
const SIZE = 38;

/**
 * The most-touched element in the app, and the one place the signature motion
 * lives.
 *
 * Pressing it **squashes** rather than shrinks: `press="send"` scales to 0.86
 * and then multiplies Y by a further 0.78, so the circle briefly flattens like
 * something taking weight. Uniform scaling reads as "the button got smaller";
 * non-uniform scaling reads as mass. The bubble that arrives a moment later
 * enters with the matching stretch (see `bubbleLaunch`), so the two halves of
 * one gesture rhyme, squeezed here, released there.
 *
 * **This is a deliberate brand exception to the iOS pass, not an oversight.**
 * Every other press model in the app moved to `highlight="dim"`, which does not
 * scale at all; iOS's own send button scales *up* briefly and dims. The squash
 * stays because it is the one moment the product is built around and because it
 * rhymes with the bubble's arrival, which nothing on the platform does. Stated
 * here so the next reader does not "finish" the pass by deleting it.
 *
 * On release it emits a single ring. One ring, not a particle system: the point
 * is to confirm a token was spent, and confirmation is a full stop rather than a
 * celebration. The ring is driven 1 → 0 so an idle button carries no halo, which
 * an earlier version did, a permanent 18% wash that looked like a rendering bug.
 */
function SendButtonView({ onPress, disabled, sendHaloKey }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const haloOpacity = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (sendHaloKey === 0) {
      return;
    }
    haloOpacity.value = 1;
    haloOpacity.value = fadeTo(0, DURATION.slow);
    // The ring's *size* is a spring while its opacity is a fade. That split is
    // deliberate: a ring that expands on a curve looks like a loading state,
    // and one that fades on a spring flickers at the tail.
    ring.value = 0;
    ring.value = springTo(1, 'gentle');
  }, [sendHaloKey, haloOpacity, ring]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value * 0.2,
    transform: [{ scale: 1 + ring.value * 0.85 }],
  }));

  return (
    <View style={styles.host}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <Pressable
        onPress={onPress}
        disabled={disabled}
        press="send"
        testID="composer-send"
        accessibilityLabel="Send message"
        accessibilityHint="Spends one token"
        style={[styles.button, disabled && styles.buttonDisabled]}>
        <Icon
          name="arrowUp"
          size={TOKENS.icon.md}
          color={disabled ? theme.color.text.tertiary : theme.color.text.onAccent}
        />
      </Pressable>
    </View>
  );
}

export const SendButton = memo(SendButtonView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: t.color.bg.accent,
  },
  // accentStrong, not accent: the glyph inside is white, and the lighter coral
  // does not carry white text. The measured pair is 5.2:1.
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.accentStrong,
  },
  buttonDisabled: {
    backgroundColor: t.color.bg.sunken,
  },
});
