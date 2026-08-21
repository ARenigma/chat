import {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  withSpring,
  withTiming,
  type WithSpringConfig,
} from 'react-native-reanimated';
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
 *   snap    — anything under a finger. Ratio 0.93, settles in ~216ms.
 *   smooth  — anything that moves a surface. Critically damped: a sheet that
 *             overshoots reads as broken, not lively.
 *   bounce  — the send, and nothing else. Ratio 0.59, so it visibly overshoots.
 *   gentle  — entrances. Arrives with weight without wobbling.
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
 * that reads as *mass*. The bubble starts narrow and tall — as if it has just
 * been squeezed through the send button — then the `bounce` spring resolves all
 * three properties at once, overshooting slightly before settling. Because one
 * spring drives width, height and position together, the overshoot is coherent:
 * the bubble arrives as a single object rather than three properties finishing
 * at their own pace.
 *
 * This is the only place `bounce` is used anywhere in the app.
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
