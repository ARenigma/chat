import React, { memo, useEffect, type ReactNode } from 'react';
import {
  Pressable as RNPressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { INTERACTION, PRESS, springTo } from '../theme/motion';

/**
 * Which press token this surface uses. `none` still handles the tap.
 *
 * Spelled out rather than `keyof typeof PRESS`, which also admitted
 * `press="sendSquashY"`, a real value in the token table and meaningless as a
 * press kind.
 */
export type PressKind = 'card' | 'row' | 'button' | 'chip' | 'send' | 'none';

/**
 * Which platform's press model this surface uses.
 *
 * `material` is the default and nothing existing changes: scale, an optional
 * radius morph, and the container's ON colour at 10%. `ios` is the other half of
 * the decision recorded in theme.test.ts: a UIKit control does not scale and does
 * not change shape under a finger, it flashes the whole cell systemGray4. Rows,
 * table cells and stars ask for it; buttons and chips keep the state layer.
 */
export type Highlight = 'material' | 'ios';

interface Props {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /**
   * A request is in flight. Holds the surface compressed and swallows taps, and
   * is **not** a synonym for `disabled`. See the note on the component.
   */
  busy?: boolean;
  accessibilityHint?: string;
  testID?: string;
  /** `card` for rows, `button` for actions, `chip` for pills, `send` for the one. */
  press?: PressKind;
  /** `ios` forces no scale, no morph, and a full-bleed cell fill. */
  highlight?: Highlight;
  /**
   * Animate the corner radius under the finger, from resting to pressed. Both
   * numbers must come from `radius` tokens, see Button for the canonical pair.
   */
  morph?: { from: number; to: number };
  /**
   * The surface's ON colour, for the Material 3 state layer. Defaults to the
   * theme's primary ink; pass `text.onInverse` on a dark or coral fill.
   */
  onColor?: string;
  /** Rendered size of a round control, so the 48dp target can be guaranteed. */
  size?: number;
  onLongPress?: () => void;
  /** Fires on finger-down, before release. Use for prefetch / head-start work. */
  onPressIn?: () => void;
  /**
   * Override the default `button` role. A nav item is a `tab`, so TalkBack says
   * "Home, tab, selected" rather than "Home, button" — the role tells a screen
   * reader this is one of a group, which a button does not.
   *
   * `menuitem`, `radio` and `checkbox` are here because the M3 components that
   * need them are ours: the anchored Paper menu's rows, the age-bracket chips
   * (one-of-many), and the policy consent tick. Narrowing this union again would
   * force those call sites to lie about what they are.
   */
  accessibilityRole?: 'button' | 'tab' | 'link' | 'menuitem' | 'radio' | 'checkbox';
  /** Selected state, surfaced through `accessibilityState` (not baked into the label). */
  selected?: boolean;
  /**
   * Checked state for `radio` and `checkbox` roles.
   *
   * Separate from `selected` because TalkBack reads them differently: a selected
   * tab announces "selected", a radio announces "checked"/"not checked". The
   * age-bracket chips are one-of-many, so they need the second one.
   */
  checked?: boolean;
  /**
   * Whether this is its own accessibility node. `false` folds it into its parent,
   * which is how a nested control (an avatar tap inside a row) avoids becoming a
   * second, overlapping TalkBack target.
   */
  accessible?: boolean;
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
 * colour at 10%, not by moving. It is the half of the model a scale-only press
 * leaves out, and it is what makes a large surface (a card, a row) feel pressed
 * when a 2.5% scale change is almost invisible on it. The opacity is a token.
 *
 * **The radius morphs.** Rounding that tightens under the finger is the cheapest
 * physical cue available, and it is M3 Expressive's shape-morphing. Opt-in,
 * because it is wrong on a circle.
 *
 * **Busy is not disabled.** `busy` holds the surface at `press.busy` and swallows
 * the tap, and it stays at full opacity. Every call site in the app used to pass
 * `disabled` while a mutation was pending, which routed into the 45% dim below,
 * so the self-narrating label that rule 5 exists to introduce ("Submitting
 * application") was being rendered at 45% opacity, which defeats the entire point
 * of it narrating. Disabled means you cannot do this; busy means it is happening.
 * They look different because they are different.
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
  busy = false,
  testID,
  press = 'card',
  highlight = 'material',
  morph,
  onColor,
  size,
  onLongPress,
  onPressIn: onPressInProp,
  accessibilityRole = 'button',
  selected,
  checked,
  accessible,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const ios = highlight === 'ios';
  // Resolved in the body, not as a default parameter: the default is a theme
  // value and a hook cannot be called in a parameter list.
  //
  // On the iOS model the layer is not a tint of the content's ink at 10%, it IS
  // the cell fill, so it takes bg/selected at full opacity. That is why the two
  // models cannot share one number.
  const layerColor = ios ? theme.color.bg.selected : onColor ?? theme.color.text.primary;
  const p = useSharedValue(0);
  // Read out of the token tables once, on the JS thread: indexing them inside a
  // worklet would capture the whole table into the animation closure.
  const target = press === 'none' || ios ? 1 : PRESS[press];
  const squashY = press === 'send' && !ios ? PRESS.sendSquashY : 1;
  // `morph` is ignored under the iOS model rather than being an error: a caller
  // can pass one shape to both platforms and the platform decides.
  const from = ios ? undefined : morph?.from;
  const to = ios ? undefined : morph?.to;
  const layerOpacity = ios ? 1 : INTERACTION.statePressed;

  /**
   * The held compression, on its own value rather than folded into `p`.
   *
   * It has to be separate: `p` springs back on press-out, and a press-out is
   * exactly what happens the instant a request starts: the finger lifts, which
   * is what fires the request in the first place. Multiplying two values keeps
   * "pressed" and "working" independent, so a second tap during a request still
   * gets its own press feedback even though the tap does nothing.
   */
  const held = useSharedValue(1);
  useEffect(() => {
    held.value = springTo(busy ? PRESS.busy : 1, 'snap');
  }, [busy, held]);

  const animated = useAnimatedStyle(() => {
    const progress = p.value;
    const scale = (1 - (1 - target) * progress) * held.value;
    const scaleY = 1 - (1 - squashY) * progress;
    return {
      transform: [{ scale }, { scaleY }],
      ...(from !== undefined && to !== undefined
        ? { borderRadius: from + (to - from) * progress }
        : null),
      opacity: disabled ? 0.45 : 1,
    };
  });

  const layer = useAnimatedStyle(() => ({ opacity: p.value * layerOpacity }));

  // Derived from the target in every case, not only when `size` is passed. The
  // old default of a flat 8 was a guess that happened to rescue the two controls
  // measured at the time (ReviewSheet's ~38pt star reached 54 with it) and said
  // nothing about the target it was there to meet. Without a size there is no
  // arithmetic to do, so it takes the largest slop the target could ever need.
  const slop =
    size === undefined
      ? Math.ceil(INTERACTION.minTarget / 6)
      : Math.max(8, Math.ceil((INTERACTION.minTarget - size) / 2));

  /**
   * Box sizing has to reach the touchable root, not only the inner clip view.
   *
   * `style` is applied to the Animated.View inside `RNPressable` so the press
   * scale and the state layer share the caller's radius. That left the root
   * unstyled, so a caller writing `flex: 1` — the contract RN's own Pressable
   * has, where `style` lands on the root — got a root sized by its content and
   * an inner `flex: 1` resolving against an indefinite height: it collapsed to
   * zero and the children vanished without an error. That is what emptied the
   * Favourites square cards.
   *
   * Only the box properties are hoisted, and they are left on the inner view as
   * well so it fills the root. Padding, margin and background stay put: applying
   * those twice would double the inset and paint the fill under the state layer.
   */
  const box = StyleSheet.flatten(style) as ViewStyle | undefined;
  const rootStyle: ViewStyle | undefined =
    box === undefined
      ? undefined
      : {
          ...(box.flex !== undefined ? { flex: box.flex } : null),
          ...(box.flexGrow !== undefined ? { flexGrow: box.flexGrow } : null),
          ...(box.flexShrink !== undefined ? { flexShrink: box.flexShrink } : null),
          ...(box.flexBasis !== undefined ? { flexBasis: box.flexBasis } : null),
          ...(box.width !== undefined ? { width: box.width } : null),
          ...(box.height !== undefined ? { height: box.height } : null),
          ...(box.minWidth !== undefined ? { minWidth: box.minWidth } : null),
          ...(box.minHeight !== undefined ? { minHeight: box.minHeight } : null),
          ...(box.maxWidth !== undefined ? { maxWidth: box.maxWidth } : null),
          ...(box.maxHeight !== undefined ? { maxHeight: box.maxHeight } : null),
          ...(box.aspectRatio !== undefined ? { aspectRatio: box.aspectRatio } : null),
        };

  return (
    <RNPressable
      style={rootStyle}
      // Swallowed rather than disabled, so a second tap mid-request still gets
      // its press feedback: the surface says "felt that, still working" instead
      // of going dead under the finger.
      onPress={busy ? () => {} : onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        p.value = springTo(1, 'snap');
        onPressInProp?.();
      }}
      onPressOut={() => {
        p.value = springTo(0, 'snap');
      }}
      disabled={disabled}
      hitSlop={slop}
      testID={testID}
      accessible={accessible}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      // `busy` is its own AccessibilityState field on both platforms, so a screen
      // reader can say "in progress" without being told the control is disabled,
      // which is what conflating the two used to make it say. `selected` is folded
      // in for tab/segmented controls that carry a chosen state.
      accessibilityState={{
        disabled,
        busy,
        ...(selected !== undefined ? { selected } : null),
        ...(checked !== undefined ? { checked } : null),
      }}>
      <Animated.View style={[styles.clip, style, animated]}>
        {/* Absolutely positioned and FIRST, so it paints between the caller's
            background and the content. It used to come last, which tinted the
            label as well as the surface, tolerable at M3's 10%, and fatal under
            the iOS model, where the layer is the cell fill at full opacity and
            would simply hide the row's text.
            `overflow: hidden` on the wrapper clips it to whatever radius the
            caller set, including one that is currently animating. Giving the
            layer its own radius would mean the same number in two places and
            getting it wrong on the circles. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.layer, { backgroundColor: layerColor }, layer]}
        />
        {children}
      </Animated.View>
    </RNPressable>
  );
}

export const Pressable = memo(PressableView);

const makeStyles = (_t: Theme) => StyleSheet.create({
  clip: {
    overflow: 'hidden',
    // iOS-only and a no-op on Android, so it costs nothing and every rounded
    // surface in the app inherits the squircle by going through this primitive.
    borderCurve: 'continuous',
  },
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
