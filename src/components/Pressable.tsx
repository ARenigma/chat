import React, { memo, type ReactNode } from 'react';
import {
  Pressable as RNPressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { INTERACTION, PRESS, springTo } from '../theme/motion';

/** Which press token this surface uses. `none` still handles the tap. */
export type PressKind = keyof typeof PRESS | 'none';

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
  /** `card` for rows, `button` for actions, `chip` for pills, `send` for the one. */
  press?: PressKind;
  /**
   * Animate the corner radius under the finger, from resting to pressed. Both
   * numbers must come from `radius` tokens — see Button for the canonical pair.
   */
  morph?: { from: number; to: number };
  /**
   * The surface's ON colour, for the Material 3 state layer. Defaults to the ink
   * used on light surfaces; pass `text.onInverse` on a dark or coral fill.
   */
  onColor?: string;
  /** Rendered size of a round control, so the 48dp target can be guaranteed. */
  size?: number;
  onLongPress?: () => void;
}

/**
 * The only interactive primitive, and the one place Material 3's interaction
 * model is implemented.
 *
 * Three things make this an M3 control rather than a button that shrinks.
 *
 * **One spring, not three.** A single 0→1 shared value drives scale, corner
 * radius, the Y squash and the state layer together, and every derived property
 * is computed from it inside the worklet. Running a spring per property is the
 * usual mistake: they are independent oscillators, so they overshoot and settle
 * at slightly different moments and the surface appears to wobble in two
 * directions at once. Driving one value and deriving the rest guarantees they
 * resolve as one object.
 *
 * **A state layer.** M3 responds to touch by overlaying the container's ON
 * colour at 10% — not by moving. It is the half of the model a scale-only press
 * leaves out, and it is what makes a large surface (a card, a row) feel pressed
 * when a 2.5% scale change is almost invisible on it. The opacity is a token.
 *
 * **The radius morphs.** Rounding that tightens under the finger is the cheapest
 * physical cue available, and it is M3 Expressive's shape-morphing. Opt-in,
 * because it is wrong on a circle.
 *
 * Touch targets are met with `hitSlop` rather than by inflating the visual,
 * which is exactly what M3 does: its icon buttons are a 40dp visual inside a
 * 48dp target. Passing `size` makes that arithmetic explicit instead of relying
 * on the default happening to be enough.
 *
 * All of it runs on the UI thread, so it stays responsive while JavaScript is
 * busy reconciling an incoming message.
 */
function PressableView({
  onPress,
  accessibilityLabel,
  accessibilityHint,
  children,
  style,
  disabled = false,
  testID,
  press = 'card',
  morph,
  onColor = TOKENS.color.text.primary,
  size,
  onLongPress,
}: Props) {
  const p = useSharedValue(0);
  // Read out of the token tables once, on the JS thread: indexing them inside a
  // worklet would capture the whole table into the animation closure.
  const target = press === 'none' ? 1 : PRESS[press];
  const squashY = press === 'send' ? PRESS.sendSquashY : 1;
  const from = morph?.from;
  const to = morph?.to;
  const layerOpacity = INTERACTION.statePressed;

  const animated = useAnimatedStyle(() => {
    const t = p.value;
    const scale = 1 - (1 - target) * t;
    const scaleY = 1 - (1 - squashY) * t;
    return {
      transform: [{ scale }, { scaleY }],
      ...(from !== undefined && to !== undefined
        ? { borderRadius: from + (to - from) * t }
        : null),
      opacity: disabled ? 0.45 : 1,
    };
  });

  const layer = useAnimatedStyle(() => ({ opacity: p.value * layerOpacity }));

  const slop =
    size === undefined ? 8 : Math.max(8, Math.ceil((INTERACTION.minTarget - size) / 2));

  return (
    <RNPressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        p.value = springTo(1, 'snap');
      }}
      onPressOut={() => {
        p.value = springTo(0, 'snap');
      }}
      disabled={disabled}
      hitSlop={slop}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}>
      <Animated.View style={[styles.clip, style, animated]}>
        {children}
        {/* Absolutely positioned and last, so it sits over the content without
            affecting layout, and `overflow: hidden` on the wrapper clips it to
            whatever radius the caller set — including a radius that is currently
            animating. Giving the layer its own radius would mean maintaining the
            same number in two places and getting it wrong on the circles. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.layer, { backgroundColor: onColor }, layer]}
        />
      </Animated.View>
    </RNPressable>
  );
}

export const Pressable = memo(PressableView);

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
