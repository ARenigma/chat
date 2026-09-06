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
 * radius morph, and the container's ON colour at 10%. `dim` is the other half of
 * the decision recorded in theme.test.ts: a UIKit control does not scale and does
 * not change shape under a finger, it flashes the whole cell systemGray4. Rows,
 * table cells and stars ask for it; buttons and chips keep the state layer.
 *
 * `ripple` replaces the animated state layer with Android's native ink ripple:
 * borderless (extends beyond the view bounds), radius `interaction.rippleRadius`,
 * and drawn in the foreground so it is visible on top of a filled surface.
 * `foreground: true` is what makes the ripple visible on a coloured fill;
 * without it the ripple renders behind the child views and is hidden by any
 * background colour.  On iOS `android_ripple` is a no-op, so this mode is
 * Android-only in effect — callers that want a cross-platform response should
 * combine it with a lightweight iOS fallback or accept the platform split.
 * https://reactnative.dev/docs/pressable#android_ripple
 */
export type Highlight = 'material' | 'dim' | 'ripple';

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
  /**
   * `dim` forces no scale, no morph, and a full-bleed cell fill.
   *
   * It was called `ios` until 2026-09-06, which named a PLATFORM in an
   * Android-only app and told a reader nothing about what it does — it also
   * implied cross-platform branching that does not exist here. The behaviour it
   * describes is the UIKit one (a row greys under the finger, no ink radiates),
   * chosen deliberately for list and settings rows; `ripple` is the Material
   * alternative. Amit's call, 2026-09-06: keep the behaviour, fix the name.
   */
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
  const dim = highlight === 'dim';
  const ripple = highlight === 'ripple';
  // Resolved in the body, not as a default parameter: the default is a theme
  // value and a hook cannot be called in a parameter list.
  //
  // On the iOS model the layer is not a tint of the content's ink at 10%, it IS
  // the cell fill, so it takes bg/selected at full opacity. That is why the two
  // models cannot share one number.
  // On the ripple model the native Android ink wave IS the feedback, so the
  // Reanimated state layer is hidden (opacity 0) to avoid doubling up.
  const layerColor = dim ? theme.color.bg.selected : onColor ?? theme.color.text.primary;
  const p = useSharedValue(0);
  // Read out of the token tables once, on the JS thread: indexing them inside a
  // worklet would capture the whole table into the animation closure.
  const target = press === 'none' || dim || ripple ? 1 : PRESS[press];
  const squashY = press === 'send' && !dim && !ripple ? PRESS.sendSquashY : 1;
  // `morph` is ignored under the iOS and ripple models rather than being an
  // error: a caller can pass one shape to both platforms and the platform decides.
  const from = dim || ripple ? undefined : morph?.from;
  const to = dim || ripple ? undefined : morph?.to;
  const layerOpacity = dim ? 1 : ripple ? 0 : INTERACTION.statePressed;

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
   * Box sizing MOVES to the root rather than being copied to both. Padding,
   * margin, background, radius and the layout of the caller's own children stay
   * on the inner view: applying padding twice would double the inset and paint
   * the fill under the state layer.
   *
   * **Leaving a copy on the inner view is what broke the provider tab bar.**
   * `flex: 1` there is not "fill the root" — RN expands it to
   * `flexBasis: 0; flexGrow: 1`, and a zero basis that grows resolves to ZERO
   * whenever the root's own main axis is content-sized. The tab row is exactly
   * that: `flexDirection: 'row'` with no height, so each tab's root took its
   * height from the inner view, which had collapsed to nothing. The row rendered
   * as a ~21dp sliver of clipped glyphs with no labels (verified on the Redmi,
   * 2026-09-05; `uiautomator` reported both tabs at `bounds="[0,0][0,0]"`).
   * The square Favourites cards survived the same bug only because their parents
   * gave the root a definite height, so there was free space for the grow to eat.
   *
   * `flexGrow: 1` is the correct "fill": its basis stays `auto`, so the inner
   * measures its content when the root is content-sized and stretches when the
   * root is not. Cross-axis fill needs nothing — `alignItems: 'stretch'` is
   * already the default.
   */
  const split = splitBox(StyleSheet.flatten(style) as ViewStyle | undefined);
  const rootStyle = split?.root;
  const innerStyle = split?.inner;

  return (
    <RNPressable
      style={rootStyle}
      // `android_ripple` is a no-op on iOS, so this only activates on Android.
      // borderless lets the wave extend past the view bounds; foreground draws
      // it over the child views rather than behind them, which is what makes the
      // ripple visible on a filled surface. radius comes from the token so every
      // ripple in the app can be retuned in one place.
      // https://reactnative.dev/docs/pressable#android_ripple
      android_ripple={
        ripple
          ? { borderless: true, radius: INTERACTION.rippleRadius, foreground: true }
          : undefined
      }
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
      <Animated.View style={[styles.clip, innerStyle, animated]}>
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

/**
 * The box-sizing properties, which size the view itself. Everything else —
 * padding, margin, background, radius, and the layout of the caller's own
 * children — describes the inside and stays on the inner view.
 */
const BOX_KEYS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'aspectRatio',
] as const satisfies readonly (keyof ViewStyle)[];

/**
 * Splits a caller's style into the part that sizes the touchable root and the
 * part that describes its inside. See the comment at the call site for why the
 * box properties must MOVE rather than be copied.
 */
function splitBox(box: ViewStyle | undefined):
  | { root: ViewStyle; inner: ViewStyle }
  | undefined {
  if (box === undefined) {
    return undefined;
  }
  const root: Record<string, unknown> = {};
  const inner: Record<string, unknown> = { ...box };
  for (const key of BOX_KEYS) {
    if (box[key] !== undefined) {
      root[key] = box[key];
    }
    delete inner[key];
  }
  // Set AFTER the strip, or the loop deletes it again.
  inner.flexGrow = 1;
  return { root: root as ViewStyle, inner: inner as ViewStyle };
}

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
