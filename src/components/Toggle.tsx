import React, { memo, useEffect } from 'react';
import { Pressable as RNPressable, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { INTERACTION, springTo } from '../theme/motion';

interface Props {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
  /**
   * Which token fills the track when on.
   *
   * `accent` is the default because the coral is the app's signal and a toggle
   * is an action — a control in a colour that appears nowhere else reads as
   * belonging to a different system, which is exactly how the stock Android teal
   * looked before this component existed.
   *
   * `presence` exists for one switch: the provider's availability. Sage means
   * "someone is there" everywhere else in the app — on the dot, on the rail, on
   * the "Here now" label — so the control that *sets* that state should be the
   * same colour as the state it sets.
   */
  tone?: 'accent' | 'presence';
}

const T = TOKENS.toggle;
const BORDER = 2;
/**
 * The thumb's *centre* is what travels, which is the only model that stays
 * correct while the thumb is also changing size.
 *
 * M3 centres the off thumb in the leading 32dp of a 52dp track and the on thumb
 * the same distance from the trailing edge, so the centre runs from 16 to 36.
 * The first version animated a left offset instead and the thumb hung off the
 * right edge of the track at rest and burst out of it while held — both visible
 * in a screenshot, neither caught by the token test, which was only ever
 * checking that the *numbers* were M3's.
 */
const CENTRE_OFF = T.trackHeight / 2;
const CENTRE_ON = T.trackWidth - T.trackHeight / 2;
/** The thumb renders at its largest and scales down, so only transforms animate. */
const BOX = T.thumbPressed;

/**
 * A Material 3 switch, built rather than borrowed.
 *
 * React Native's `Switch` was the one platform control left in the app, and it
 * was also the only element that ignored the design system completely: on the
 * emulator it rendered Android's stock teal, and no token or test could have
 * caught that because the colours were chosen by the OS. Handing it
 * `trackColor` fixes the colour and still leaves the anatomy wrong.
 *
 * M3's anatomy is the point. A 52×32 track, and a thumb that is **16dp when
 * off, 24dp when on, and 28dp while held** — the thumb growing as you commit is
 * what makes an M3 switch read as a physical latch rather than a dot sliding in
 * a slot. RN's Switch cannot express any of that.
 *
 * Building it also buys backward compatibility outright: this renders
 * identically on API 24 and API 36, whereas a platform widget renders whatever
 * that OEM's framework version draws, and Material You would recolour it from
 * the user's wallpaper on API 31+. For a product whose colour carries meaning —
 * coral is "act", sage is "present" — letting the wallpaper pick is not a
 * feature.
 *
 * One spring drives offset, size and colour together, so the thumb arrives as
 * one object. Track and thumb colours are interpolated on the UI thread rather
 * than swapped at the midpoint, which is what stops the change reading as a
 * flicker.
 */
function ToggleView({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  testID,
  tone = 'accent',
}: Props) {
  const fill =
    tone === 'presence' ? TOKENS.color.state.available : TOKENS.color.bg.accentStrong;
  // 0 = off, 1 = on. `held` is separate because the pressed thumb size applies
  // in both states, and folding it into one value would make "off and held"
  // indistinguishable from "half on".
  const on = useSharedValue(value ? 1 : 0);
  const held = useSharedValue(0);

  useEffect(() => {
    on.value = springTo(value ? 1 : 0, 'snap');
  }, [value, on]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [TOKENS.color.bg.pressed, fill]),
    borderColor: interpolateColor(on.value, [0, 1], [TOKENS.color.border.strong, fill]),
  }));

  const thumb = useAnimatedStyle(() => {
    // The pressed thumb is 28 in BOTH states, so `held` interpolates from
    // whichever size the current state has rather than adding a fixed amount —
    // adding made the held-while-off thumb 20 instead of 28.
    const resting = T.thumbOff + (T.thumbOn - T.thumbOff) * on.value;
    const size = resting + (T.thumbPressed - resting) * held.value;
    const centre = CENTRE_OFF + (CENTRE_ON - CENTRE_OFF) * on.value;
    return {
      // Scale rather than width/height: the box stays BOX square and scales
      // about its own centre, so the visual centre is fixed at BOX/2 whatever
      // the size, and the position arithmetic below has one term instead of two.
      transform: [
        { translateX: centre - BOX / 2 - BORDER },
        { scale: size / BOX },
      ],
      backgroundColor: interpolateColor(
        on.value,
        [0, 1],
        [TOKENS.color.border.strong, TOKENS.color.bg.raised],
      ),
    };
  });

  return (
    <RNPressable
      onPress={() => onValueChange(!value)}
      onPressIn={() => {
        held.value = springTo(1, 'snap');
      }}
      onPressOut={() => {
        held.value = springTo(0, 'snap');
      }}
      disabled={disabled}
      // The track is 32 tall against a 48 minimum, so the slop is not cosmetic.
      hitSlop={Math.ceil((INTERACTION.minTarget - T.trackHeight) / 2)}
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}>
      <Animated.View style={[styles.track, disabled && styles.disabled, track]}>
        <Animated.View style={[styles.thumb, thumb]} />
      </Animated.View>
    </RNPressable>
  );
}

export const Toggle = memo(ToggleView);

const styles = StyleSheet.create({
  track: {
    width: T.trackWidth,
    height: T.trackHeight,
    borderRadius: T.trackHeight / 2,
    borderWidth: 2,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    left: 0,
    // Vertically centred by layout rather than by transform: the padding box is
    // trackHeight - 2*border tall, so a BOX-square child with the track's
    // `justifyContent: center` and `alignSelf` default is already on the axis.
    top: (T.trackHeight - 2 * BORDER - BOX) / 2,
    width: BOX,
    height: BOX,
    borderRadius: BOX / 2,
  },
  disabled: {
    opacity: 0.45,
  },
});
