/**
 * The arithmetic of the collapsing large-title bar.
 *
 * Pure and free of react-native so it can be tested without a device, which is
 * the same split `src/lib/spinner.ts` uses and for the same reason: `motion.ts`
 * imports `react-native-reanimated`, and reanimated cannot be imported under
 * jest at all. Its worklets module throws while loading its native unpackers, so
 * every existing test of `motion.ts` is a regex over the source text. That is
 * fine for asserting a token is referenced and useless for asserting a curve is
 * right.
 *
 * So the numbers live here, where they can be checked, and `motion.ts`
 * re-exports them so the design system still has one front door.
 *
 * Why the interpolation is written out rather than imported from reanimated:
 * these are clamped piecewise-linear ramps over a monotonic input, which is a
 * fully specified operation, and writing the five lines is what makes the whole
 * module importable. Nothing here is a spring or an easing, and the moment it
 * wants to be either it belongs in `motion.ts` instead.
 */

/**
 * How far the bar travels between expanded and collapsed.
 *
 * 52, which is the height of the title strip alone, and NOT 104. The search
 * strip below it stays visible in the collapsed bar, so only the strip holding
 * the wordmark is given up: `148 = 44 content row + 52 title strip + 52 search
 * strip` collapses to `97 = 44 + 52 + 1 hairline`. Measured off the Figma frames
 * `Pappal Home, large title expanded` (54:4) and `Pappal Home, title collapsed`
 * (56:11).
 *
 * That the search field survives the collapse is a decision, not an oversight of
 * WhatsApp's `hidesSearchBarWhenScrolling`. Search here spans the directory as
 * well as the inbox, and `src/screens/InboxScreen.tsx` records why it was
 * deliberately made always-visible: an empty inbox is exactly when finding
 * somebody matters most, and the version that hid the field hid it from the one
 * person it was built for.
 */
export const COLLAPSE_TRAVEL = 52;

/**
 * The four windows, each derived from the travel or from a space step, so that
 * retuning the bar is one number rather than four.
 *
 * `hairlineIn` is the shortest on purpose: the separator under the bar answers
 * "has this list moved at all", so it wants to be certain long before anything
 * else has finished.
 *
 * `titleHold` keeps the wordmark at full strength for the first half of the
 * travel. A brand that starts dissolving on a two-point scroll reads as fragile.
 *
 * `titleGone` is one hairline window short of the end, so that in the settled
 * collapsed state the wordmark is fully absent rather than sitting at some small
 * residual opacity that never quite resolves.
 *
 * `inlineIn` is one 4pt step after the wordmark begins to leave, which is what
 * stops the two titles ever being at rest together. They cross over, but neither
 * is at full strength while the other is still legible.
 *
 * The two space steps are written as literals here rather than imported from the
 * generated tokens, because importing `../theme/tokens` would pull the theme into
 * a module whose whole purpose is to have no dependencies. `__tests__` asserts
 * they equal `TOKENS.space.xs` and `TOKENS.space['2xs']`, so a token change still
 * cannot drift away from this file silently.
 */
const SPACE_XS = 8;
const SPACE_2XS = 4;

export const COLLAPSE_WINDOW = {
  hairlineIn: SPACE_XS,
  titleHold: COLLAPSE_TRAVEL / 2,
  titleGone: COLLAPSE_TRAVEL - SPACE_XS,
  inlineIn: COLLAPSE_TRAVEL / 2 + SPACE_2XS,
} as const;

/**
 * A clamped piecewise-linear ramp, which is what `interpolate(..., 'clamp')` is
 * for a monotonically increasing input list.
 *
 * Outside the ends it holds the end value rather than extrapolating, which is the
 * behaviour the bar needs at both extremes: an over-scroll at the top must not
 * push opacity above 1, and a long list must not drive it below 0.
 */
export function ramp(value: number, input: number[], output: number[]): number {
  'worklet';
  const last = input.length - 1;
  if (value <= (input[0] ?? 0)) {
    return output[0] ?? 0;
  }
  if (value >= (input[last] ?? 0)) {
    return output[last] ?? 0;
  }
  for (let i = 0; i < last; i++) {
    const lo = input[i] ?? 0;
    const hi = input[i + 1] ?? 0;
    if (value <= hi) {
      // A zero-width segment would divide by zero. It cannot happen with the
      // windows above, and returning the segment's start is the honest answer if
      // somebody ever writes one.
      if (hi === lo) {
        return output[i] ?? 0;
      }
      const t = (value - lo) / (hi - lo);
      return (output[i] ?? 0) + ((output[i + 1] ?? 0) - (output[i] ?? 0)) * t;
    }
  }
  return output[last] ?? 0;
}

export interface CollapseFrame {
  /** The large title's vertical offset. Negative: it rides up and out. */
  titleY: number;
  titleOpacity: number;
  inlineOpacity: number;
  hairlineOpacity: number;
}

/**
 * One scroll offset in, the whole bar's state out.
 *
 * **`'worklet'` is load-bearing and its absence is a hard crash, not a warning.**
 * This is called from inside `useAnimatedStyle`, which runs on the UI runtime.
 * Without the directive Reanimated treats an ordinary imported function as a
 * *remote* function and throws `[Worklets] Tried to synchronously call a Remote
 * Function` on the first frame the bar renders, taking the app down. Nothing in
 * the test suite can see that: jest imports this module into the JS runtime where
 * the function is perfectly callable. `src/lib/spinner.ts` carries the same note,
 * because the same omission already shipped once and was found by opening a
 * screen rather than by a gate.
 *
 * **One function, four outputs, rather than four hooks.** Every value is a pure
 * read of the same offset, so computing them together guarantees they describe one
 * instant. Four separate `useAnimatedStyle` calls would each sample the shared
 * value independently, which is how a header ends up with its title and its
 * hairline disagreeing about where the list is by a frame.
 *
 * **Driven by offset, never by a duration.** `design/tokens.json` carries the rule
 * that nothing positional is animated with a curve, and a collapsing bar is the
 * case that most tempts you to break it: the finger is the clock, so a timing
 * function would race the gesture instead of following it.
 *
 * **The title does not scale from 34 down to 17.** That is the obvious
 * implementation and it is wrong: swapping type styles mid-gesture reflows the row
 * on one frame while opacity catches up over several. `src/theme/motion.ts` lines
 * 96 to 101 already document that exact failure for the stepper, where rule 7,
 * opacity only, won. The inline title is a separate node that fades in.
 */
export function collapseFrame(scrollY: number): CollapseFrame {
  'worklet';
  const { hairlineIn, titleHold, titleGone, inlineIn } = COLLAPSE_WINDOW;
  // Clamped both ends: a rubber-band over-scroll gives a negative offset, and
  // pushing the title DOWN out of the bar is not a state the bar has.
  const spent = Math.min(Math.max(scrollY, 0), COLLAPSE_TRAVEL);
  return {
    // The ternary is only there to avoid negative zero. `-0` renders exactly like
    // `0` and compares equal to it with `===`, so this changes nothing on screen;
    // it keeps the value straightforward to assert against and stops `-0` turning
    // up in a diff one day looking like a bug.
    titleY: spent === 0 ? 0 : -spent,
    titleOpacity: ramp(scrollY, [0, titleHold, titleGone], [1, 1, 0]),
    inlineOpacity: ramp(scrollY, [inlineIn, COLLAPSE_TRAVEL], [0, 1]),
    hairlineOpacity: ramp(scrollY, [0, hairlineIn], [0, 1]),
  };
}
