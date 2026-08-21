import React, { memo, type ReactNode } from 'react';
import { Pressable as RNPressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { PRESS, springTo } from '../theme/motion';

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
  onLongPress?: () => void;
  hitSlop?: number;
}

/**
 * The only interactive primitive.
 *
 * Two things make this feel like an object rather than a button that shrinks.
 *
 * **One spring, not three.** A single 0→1 shared value drives scale, corner
 * radius and the Y squash together, and every derived property is computed from
 * it inside the worklet. Running a spring per property is the usual mistake: they
 * are independent oscillators, so they overshoot and settle at slightly
 * different moments and the surface appears to wobble in two directions at once.
 * Driving one value and deriving the rest guarantees they resolve as one object.
 *
 * **The radius morphs.** Rounding that tightens under the finger is the cheapest
 * physical cue available — it reads as the surface taking the pressure — and it
 * comes straight out of Material 3 Expressive's shape-morphing. It is opt-in
 * because it is wrong on a circle.
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
  onLongPress,
  hitSlop = 8,
}: Props) {
  const p = useSharedValue(0);
  // Read out of the token table once, on the JS thread: indexing PRESS inside a
  // worklet would capture the whole table into the animation closure.
  const target = press === 'none' ? 1 : PRESS[press];
  const squashY = press === 'send' ? PRESS.sendSquashY : 1;
  const from = morph?.from;
  const to = morph?.to;

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
      hitSlop={hitSlop}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </RNPressable>
  );
}

export const Pressable = memo(PressableView);
