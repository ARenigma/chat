import {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  type WithSpringConfig,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { CarouselSlot } from '../lib/carousel';
import { TOKENS } from './tokens';

/**
 * The only place in the app allowed to know how motion behaves.
 *
 * Every number here comes from `design/tokens.json` via the generator, and no
 * component may write a damping, a stiffness or a duration of its own. That is
 * not tidiness for its own sake: motion is the one part of a design system that
 * gets tuned by feel, and if four components each hold their own spring then
 * "make the app feel calmer" becomes four edits and a diff nobody can review.
 *
 * Four springs, and the choice between them is semantic rather than aesthetic:
 *
 *   snap  , anything under a finger. Ratio 0.93, settles in ~216ms.
 *   smooth, anything that moves a surface. Critically damped: a sheet that
 *             overshoots reads as broken, not lively.
 *   bounce, the send, and nothing else. Ratio 0.59, so it visibly overshoots.
 *   gentle, entrances. Arrives with weight without wobbling.
 *
 * Durations exist only for opacity and colour. Nothing that changes position or
 * size is ever animated with a curve, because a curve cannot accept the velocity
 * a finger left behind and a spring can.
 */

export const SPRING = TOKENS.motion.spring;
export const PRESS = TOKENS.motion.press;
export const DURATION = TOKENS.motion.duration;
export const STAGGER = TOKENS.motion.stagger;
export const DECAY = TOKENS.motion.decay;
export const GESTURE = TOKENS.motion.gesture;
/**
 * The two opacities a state is allowed to be expressed in.
 *
 * `neighbour` (10%) hides information and keeps shape; `inactive` (25%) keeps
 * information and drops emphasis. They are not interchangeable and the gap
 * between them is the reason there are two. See the token note.
 *
 * Neither is a contrast claim. `scripts/check-contrast.mjs` measures token pairs
 * and cannot see a composited opacity, so anything one of these hides has to be
 * reachable another way, which in practice means a screen-reader label.
 */
export const OPACITY = TOKENS.motion.opacity;
/** Material 3 state-layer opacities and the 48dp minimum target. */
export const INTERACTION = TOKENS.interaction;

export type SpringName = keyof typeof SPRING;

/**
 * `withSpring` with a named token, and optionally the velocity a gesture ended
 * with.
 *
 * The velocity argument is the whole reason this wrapper exists. A sheet that
 * springs back from `translateY = 120` looks the same whether the finger was
 * moving or still; one that springs back *carrying the finger's velocity* is the
 * difference between an animation and an object. Reanimated takes it as spring
 * config, so it costs one field.
 */
export function springTo(
  to: number,
  name: SpringName = 'snap',
  velocity?: number,
): number {
  'worklet';
  const config: WithSpringConfig =
    velocity === undefined ? SPRING[name] : { ...SPRING[name], velocity };
  return withSpring(to, config);
}

/** Opacity and colour only. */
export function fadeTo(to: number, ms: number = DURATION.fast): number {
  'worklet';
  return withTiming(to, { duration: ms, easing: Easing.out(Easing.quad) });
}

/**
 * Rule 4: a step label being promoted or demoted.
 *
 * 150ms, which is measured: the Fuse clip promotes within one 111ms sample. The
 * number is only half the rule though: it is deliberately FASTER than the 220ms
 * accent cross-fade happening behind it, so the content lands before its colour
 * does, and that ordering is what stops a step change reading as the screen
 * sliding sideways.
 *
 * Opacity only. The reference's active step also carries larger type, and that is
 * the one thing here not copied: swapping a type style reflows the row on the
 * frame the state changes while the opacity takes 150ms to catch up, so the label
 * jumps and then fades. Rule 7 says nothing scales text, and between the two
 * rules rule 7 wins.
 */
export function promoteTo(active: boolean): number {
  'worklet';
  return fadeTo(active ? 1 : OPACITY.inactive, DURATION.stepPromote);
}

/**
 * Rule 2: the accent moving from one step's colour to the next.
 *
 * Returns progress along a ramp, not a colour. The component feeds it to
 * `interpolateColor`, because the endpoints are theme values and this module
 * knows about physics rather than about light and dark.
 *
 * The reference cross-fades between three hues and passes through a visibly
 * desaturated midpoint. Ours is coral-only by settled decision, so cross-fading
 * coral to coral would be nothing at all. What transfers is the ramp: interpolate
 * from the neutral border grey up through the bright coral to the deep one, in
 * RGB, and the midpoints genuinely are desaturated mid-corals. That is rule 2
 * doing real work as a progress signal rather than as decoration.
 */
export function accentTo(phase: number): number {
  'worklet';
  return fadeTo(phase, DURATION.accentShift);
}

/**
 * Rule 1: one row of the word carousel, looping forever.
 *
 * Built on the JS thread and handed to a shared value, which is the point: the
 * loop then lives on the UI thread and keeps running while JavaScript is busy and
 * across the hand-off to the system browser and back. That is this codebase's
 * honest translation of the clip's "keeps running behind a presented modal": we
 * present nothing over the auth screen, but we do lose the JS thread to OAuth.
 *
 * `ReduceMotion.Never`, and it needs saying why, because it looks like the one
 * thing every other animation in this file gets right. A `withRepeat(-1)` whose
 * inner timings have been short-circuited to their final value does not stop, it
 * spins at frame rate doing nothing, an infinite loop of zero-length
 * animations. So the reduce-motion decision cannot live here; it has to be "do
 * not start", which only the component can do. `WordCarousel` gates on
 * `useReducedMotion()` and renders one word statically, and this function is
 * never called in that case.
 *
 * Linear easing on purpose: the shape of the cross-fade is carried by the plateau
 * in `carouselSlot`, so easing on top of it would ease an already-shaped curve.
 */
export function carouselLoop(slot: CarouselSlot): number {
  const legs = slot.steps.map(step =>
    withTiming(step.to, {
      duration: step.ms,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never,
    }),
  );
  // withSequence needs at least one leg; an empty slot means there is nothing to
  // advance to and the caller should not have called this.
  const sequence =
    legs.length === 0 ? withTiming(1, { duration: DURATION.instant }) : withSequence(...legs);
  // The offset sits OUTSIDE the repeat. Inside, it is re-applied every lap and
  // the rows drift a word apart. See CarouselSlot.
  return withDelay(
    slot.delayMs,
    withRepeat(sequence, -1, false, undefined, ReduceMotion.Never),
    ReduceMotion.Never,
  );
}

/**
 * Rule 7: a text node whose content just changed.
 *
 * A fade-in on the new string with no exit on the old one, which is a
 * fade-through rather than a true cross-fade, and the difference is worth being
 * straight about. A real cross-fade needs both strings mounted at once, and two
 * mounted Texts in a flex column either reflow the block or have to be
 * absolutely positioned inside a reserved height, which for a paragraph whose
 * length changes with its content is a height nobody can reserve honestly.
 *
 * What the rule actually forbids is scale and translate, and this has neither.
 * Applied by giving the node a `key` of its own content, so React remounts it
 * and Reanimated runs the entrance.
 *
 * Hoisted, like every other builder here: they allocate on construction, so one
 * built inside a render is a new object per render.
 */
export const fadeSwap = FadeIn.duration(DURATION.base).reduceMotion(
  ReduceMotion.System,
);

/** The same swap at the speed of a tap, for a button label that just narrated itself. */
export const fadeSwapFast = FadeIn.duration(DURATION.fast).reduceMotion(
  ReduceMotion.System,
);

/**
 * Entrances, hoisted.
 *
 * Reanimated builders allocate on every call, so building one inside a render
 * means a new object per row per frame. Hoisting them to module scope is the
 * documented guidance; the delay is the only thing that varies, so these are
 * factories over a small fixed set of indices rather than free functions.
 *
 * Every one carries `.reduceMotion(ReduceMotion.System)`. An entrance is exactly
 * the kind of animation someone with vestibular sensitivity has asked the OS to
 * stop, and honouring it is one call.
 */
const SPRINGIFY = <T extends { springify: () => T }>(b: T): T => b.springify();

function stagger(base: number, index: number, cap: number): number {
  return base * Math.min(index, cap);
}

/** A list row arriving. Capped at eight so a long list does not crawl in. */
export function enterRow(index: number) {
  return FadeInDown.delay(stagger(STAGGER.row, index, 8))
    .duration(DURATION.base)
    .damping(SPRING.gentle.damping)
    .stiffness(SPRING.gentle.stiffness)
    .mass(SPRING.gentle.mass)
    .reduceMotion(ReduceMotion.System);
}

/** An avatar in the "here now" rail. Faster cascade, it is a shorter row. */
export function enterRail(index: number) {
  return SPRINGIFY(FadeIn.delay(stagger(STAGGER.rail, index, 6)))
    .duration(DURATION.base)
    .reduceMotion(ReduceMotion.System);
}

/** Screen furniture: headline, hero, actions. */
export function enterBlock(order: number) {
  return FadeInDown.delay(STAGGER.row * order * 2)
    .duration(DURATION.base)
    .damping(SPRING.gentle.damping)
    .stiffness(SPRING.gentle.stiffness)
    .mass(SPRING.gentle.mass)
    .reduceMotion(ReduceMotion.System);
}

/**
 * The signature moment: a sent message launching out of the composer.
 *
 * Squash-and-stretch, which is the oldest trick in animation and still the one
 * that reads as *mass*. The bubble starts narrow and tall, as if it has just
 * been squeezed through the send button, then the `bounce` spring resolves all
 * three properties at once, overshooting slightly before settling. Because one
 * spring drives width, height and position together, the overshoot is coherent:
 * the bubble arrives as a single object rather than three properties finishing
 * at their own pace.
 *
 * One of two places `bounce` is used. The other is the onboarding completion
 * check in `src/components/CompletionRow.tsx`, added 2026-08-26: the reference
 * flow resolves that mark with `.bouncy(duration: 1)`, and it is the single
 * moment in the product that is allowed to celebrate. A rule that reserved the
 * overshoot for a sent message and denied it to "you're in" would be enforcing
 * the letter of the restraint against its point.
 */
export function bubbleLaunch() {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 18 }, { scaleX: 0.84 }, { scaleY: 1.16 }],
    },
    animations: {
      opacity: withTiming(1, { duration: DURATION.instant }),
      transform: [
        { translateY: withSpring(0, SPRING.bounce) },
        { scaleX: withSpring(1, SPRING.bounce) },
        { scaleY: withSpring(1, SPRING.bounce) },
      ],
    },
  };
}

/**
 * A peer's message arriving. Deliberately *not* the launch animation.
 *
 * Their message did not come out of your composer, so giving it the same
 * squash would be a small lie about where it came from. It slides in from the
 * left edge with `gentle` and no overshoot.
 */
export function bubbleArrive() {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateX: -14 }, { scale: 0.96 }],
    },
    animations: {
      opacity: withTiming(1, { duration: DURATION.fast }),
      transform: [
        { translateX: withSpring(0, SPRING.gentle) },
        { scale: withSpring(1, SPRING.gentle) },
      ],
    },
  };
}

/**
 * A horizontal refusal, the field says no without losing what you typed.
 *
 * Used when a verification code is rejected. The alternative that most apps pick
 * is clearing the field, and it is the single most disliked behaviour in an OTP
 * flow: a wrong code is nearly always one mistyped character, and clearing makes
 * you retype all six. So nothing is cleared; only the position moves.
 *
 * Four decaying hops on `snap` rather than a timing loop, because a spring is
 * what a physical object actually does when it is stopped short, the amplitudes
 * fall off and the last one returns to rest. `ReduceMotion.System` is threaded
 * through so this becomes a no-op for anyone who has asked the OS for less
 * movement, which matters more here than elsewhere: this animation fires at the
 * exact moment someone is already frustrated.
 *
 * Lives here rather than in the component because every spring in the app lives
 * here, a `withSpring` call in a component is a physics decision made where
 * nobody will find it again, and there is a test that says so.
 */
export function shakeX(): number {
  'worklet';
  const hop = (to: number) =>
    withSpring(to, { ...SPRING.snap, reduceMotion: ReduceMotion.System });
  return withSequence(hop(-9), hop(7), hop(-4), hop(0));
}

/**
 * The collapsing large-title bar, re-exported so the design system keeps one
 * front door.
 *
 * The arithmetic itself lives in `src/lib/collapse.ts` rather than here, and that
 * is a deliberate exception to "motion lives in one module" rather than a hole in
 * it. This module imports `react-native-reanimated`, and reanimated cannot be
 * imported under jest: its worklets module throws while loading native unpackers.
 * So everything declared in this file is testable only by regex over its own
 * source, which is enough to prove a token is referenced and worth nothing at all
 * for proving a curve is correct.
 *
 * `src/lib/spinner.ts` set this precedent for exactly the same reason, and the
 * rule's own test agrees: it forbids raw physics in `src/components` and
 * `src/screens`, not in `src/lib`. What stays here is the policy that a component
 * imports motion from one place; what moved is the arithmetic that a test needs to
 * be able to run.
 *
 * Nothing in `collapse.ts` is a spring or an easing. The moment it wants to be
 * either, it belongs back in this file.
 */
export {
  COLLAPSE_TRAVEL,
  COLLAPSE_WINDOW,
  collapseFrame,
  type CollapseFrame,
} from '../lib/collapse';
