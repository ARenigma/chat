import { useEffect, useRef, useState } from 'react';
import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  ReduceMotion,
  makeMutable,
  runOnJS,
  type SharedValue,
  type WithSpringConfig,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
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
export const GESTURE = TOKENS.motion.gesture;

/**
 * The Material 3 screen/surface transition physics (standard scheme).
 *
 * Separate from `SPRING`, which is the four hand-tuned interaction springs, and
 * deliberately so: these six carry the app-wide transition language (push/pop,
 * sheets, menus, rows) while the four carry press feedback and gestures. The
 * split is the M3 spatial-vs-effects distinction — spatial springs move and
 * resize, effects springs carry opacity and colour. See `design/tokens.json`
 * `motion.m3` and `design/references/motion-system.md`.
 */
export const M3 = TOKENS.motion.m3;

/**
 * The three M3 easing curves, precomputed once.
 *
 * Decelerate for entering (arrives and slows), accelerate for exiting (speeds up
 * as it leaves), standard for in-place changes. Built at module scope, not in
 * each worklet, because `Easing.bezier` allocates and the curve never varies.
 */
const EMPH_DECEL = Easing.bezier(
  M3.easing.emphasizedDecelerate[0],
  M3.easing.emphasizedDecelerate[1],
  M3.easing.emphasizedDecelerate[2],
  M3.easing.emphasizedDecelerate[3],
);
/**
 * Telegram's push/pop curve — Android `DecelerateInterpolator(1.5f)`, a cubic
 * ease-out — for the 150ms screen fade only. See the token note for why
 * M3's emphasized-decelerate cannot carry a fade that short.
 */
const SCREEN_DECEL = Easing.bezier(
  M3.easing.decelerate[0],
  M3.easing.decelerate[1],
  M3.easing.decelerate[2],
  M3.easing.decelerate[3],
);
/**
 * Telegram's EASE_OUT_QUINT (0.23,1,0.32,1) — the curve it reveals the send
 * button on (`ChatActivityEnterView.java:8217`). A hard, early ease-out that
 * makes a scale-from-nothing feel like it snaps into being rather than grows.
 */
const EASE_OUT_QUINT = Easing.bezier(
  M3.easing.easeOutQuint[0],
  M3.easing.easeOutQuint[1],
  M3.easing.easeOutQuint[2],
  M3.easing.easeOutQuint[3],
);
/**
 * Standard CSS ease-out (0,0,0.58,1) — a decelerating curve for timed
 * animations that have no finger velocity to carry. Used for the press-ramp
 * in (the scale-down on a cell or icon button press) where the movement is
 * caused by a tap, not a drag. Named `easeOut` in the token to distinguish it
 * from the quint variant: quint is the much harder early deceleration used for
 * the send-button reveal; this is the softer general-purpose version.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function#ease-out
 */
export const EASE_OUT = Easing.bezier(
  M3.easing.easeOut[0],
  M3.easing.easeOut[1],
  M3.easing.easeOut[2],
  M3.easing.easeOut[3],
);
/**
 * Standard CSS ease (0.25,0.1,0.25,1) — a gentle start-and-end curve for
 * in-place timed changes that want a softer character than ease-out: camera
 * slot collapse, composer multi-line growth, etc. Named `ease` in the token.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function#ease
 */
export const EASE = Easing.bezier(
  M3.easing.ease[0],
  M3.easing.ease[1],
  M3.easing.ease[2],
  M3.easing.ease[3],
);
/**
 * The keyboard's own curve, for a panel that stands in for the keyboard.
 *
 * `CubicBezierInterpolator(0.19919472913616398, 0.010644531250000006,
 * 0.27920937042459737, 0.91025390625)` — Telegram's
 * `ChatListItemAnimator.DEFAULT_INTERPOLATOR` (`:47`), which is what it runs
 * every IME-adjacent translation on for `AdjustPanLayoutHelper.keyboardDuration`
 * = 250ms (`AdjustPanLayoutHelper.java:41-42`). A docked emoji or attach panel
 * is replacing the keyboard, so it has to travel on the same curve or the swap
 * reads as two different mechanisms.
 */
export const KEYBOARD_CUBIC = Easing.bezier(
  M3.easing.keyboard[0],
  M3.easing.keyboard[1],
  M3.easing.keyboard[2],
  M3.easing.keyboard[3],
);

/** Telegram's deferred animator start, in ms (`ChatActivityEnterView.java:12710`). */
export const DOCK_DELAY_MS = 50;

/**
 * Slide a docked surface to `to` on the keyboard's curve.
 *
 * Telegram animates only when the keyboard is NOT already visible
 * (`showPopup`: `smoothKeyboard && !keyboardVisible && ...`,
 * `ChatActivityEnterView.java:12687`) — a swap made with the keyboard up is not
 * animated at all, because the keyboard sliding away IS the animation and a
 * second one on top of it reads as a stutter. `animate: false` is that case.
 *
 * The 50ms delay is Telegram's too
 * (`AndroidUtilities.runOnUIThread(runEmojiPanelAnimation, 50)`, `:12710`): the
 * panel's first layout and its first animated frame in the same frame is what
 * produces the artefact frame, so the travel starts one beat after the content
 * exists.
 */
export function dockTo(to: number, animate: boolean) {
  'worklet';
  if (!animate) {
    return to;
  }
  return withDelay(
    DOCK_DELAY_MS,
    withTiming(to, {
      duration: M3.duration.medium1,
      easing: KEYBOARD_CUBIC,
      // The OS setting decides, not this module. `ReduceMotion.System` makes
      // Reanimated jump straight to the target when the user has asked for less
      // motion, which is the correct behaviour for a travel like this — the
      // panel still appears, it just does not slide.
      reduceMotion: ReduceMotion.System,
    }),
  );
}

/**
 * Scale a pressable element to its named press scale over `pressRamp` ms.
 *
 * The rule that governs the curve: a spring where a finger's velocity is being
 * continued; a timed curve where it is not. A tap has no accumulated velocity
 * so the ramp is `EASE_OUT`, not a spring. The short duration (100ms) keeps
 * feedback attached to the finger — Telegram's emoji cell presses to 0.8 in
 * ~80ms (`EmojiView.java`). `ReduceMotion.System` collapses the scale to
 * nothing under the OS "remove animations" setting; the element still responds
 * (the state change fires), it just does not move.
 */
export function pressIn(kind: keyof typeof PRESS): number {
  'worklet';
  return withTiming(PRESS[kind], {
    duration: DURATION.pressRamp,
    easing: EASE_OUT,
    reduceMotion: ReduceMotion.System,
  });
}

/**
 * True while a screen or surface transition is running.
 *
 * W5 #6 gates deferred work on this value — realtime message inserts,
 * EmojiPicker pre-mount, image fetches, Avatar loads and ChatWallpaper are
 * buffered here and flushed only after `onTransitionSettled` fires. Mutation
 * is through `setTransitioning`; the transition builders (push/pop/sheetIn)
 * are the only callers. Reading from any component or hook is safe.
 */
export const transitioning = makeMutable<boolean>(false);

type SettledCallback = () => void;
const _settledCallbacks = new Set<SettledCallback>();

/**
 * Subscribe to the moment the current transition settles.
 *
 * Returns an unsubscribe function — call it from a `useEffect` cleanup to
 * prevent a leak when the subscribing component unmounts mid-transition.
 *
 * Callbacks run synchronously on the JS thread in insertion order the moment
 * `setTransitioning(false)` is called, which is after the animation has
 * completed and the UI thread has reported its final position.
 *
 * W5 #6 wires the five deferral call sites; this primitive is only built here.
 */
export function onTransitionSettled(cb: SettledCallback): () => void {
  _settledCallbacks.add(cb);
  return () => {
    _settledCallbacks.delete(cb);
  };
}

/* -------------------------------------------------------------------------
 * Holding a screen's entrance until it has DATA, not just geometry
 * ------------------------------------------------------------------------- */

/**
 * Telegram's safety net, in ms. If the arriving screen never reports itself
 * ready, the animation runs anyway at this deadline.
 *
 * `ActionBarLayout.java:2270-2282` posts its delayed-open runnable with a 200ms
 * delay and `:1920-1927` (`resumeDelayedFragmentAnimation`) cancels it when the
 * data lands first. So 200 is a CEILING, not a wait: on a warm cache the
 * release usually arrives in a few frames.
 */
const ENTER_HOLD_CEILING_MS = 200;

let _entryHolds = 0;
const _readyCallbacks = new Set<SettledCallback>();

/**
 * Declare that the screen now mounting is not ready to be animated in yet.
 *
 * The gap it is aimed at, measured on the S22 at 60Hz: a push/pop landed 65% of
 * its frames inside a 16.68ms budget with a 15.40ms median, against Telegram's
 * 97.5% and 7.55ms — while plain scrolling matched them almost exactly. The
 * animation runs while the screen is still becoming itself: hooks firing,
 * queries resolving, a list computing its first layout.
 *
 * WHAT THIS HOLD ITSELF BUYS IS UNMEASURED, and that is stated rather than
 * implied. An A/B on the Redmi (debug build, 60Hz), three runs each arm,
 * alternated, chat push/pop targeted by resource-id and verified per cycle:
 *
 *   with hold     within-budget 10.8 / 33.3 / 14.2 %   p50 26.5 / 24.5 / 29.7 ms
 *   without hold  within-budget 21.7 / 21.7 / 18.3 %   p50 29.6 / 28.8 / 28.1 ms
 *
 * p50 favours the hold by ~2ms; within-budget favours its absence; frames past
 * two budgets are level. The `with` arm's within-budget spread is 22.5 points
 * across three IDENTICAL runs, so the run-to-run variance of a debug build on a
 * 2019 phone is larger than the effect being looked for. No conclusion is
 * available from that data and none is claimed.
 *
 * It is kept because it is faithful to the mechanism it copies, it is safe by
 * construction (ceiling, unmount release, opt-in), and its cost is bounded at
 * one frame. Where it could actually be proven: the S22 on a RELEASE build with
 * the panel genuinely at 120Hz, where the budget halves to 8.3ms and mount
 * contention weighs twice as heavily against it.
 *
 * Telegram does not start on geometry, it starts on DATA.
 * `ChatActivity.needDelayOpenAnimation()` (ChatActivity.java:27014) returns
 * `firstLoading`, and the animation is held with the incoming view at alpha 0
 * and translateX 48dp until the first message batch has rendered, at which
 * point `:20613` calls `resumeDelayedFragmentAnimation`.
 *
 * CALL THIS DURING THE SCREEN'S FIRST RENDER, not from an effect. A child
 * renders before its parent's `onLayout` fires, so a hold taken in render is
 * already visible to `useScreenEnter`; a hold taken in an effect would arrive
 * after the animation had started and do nothing.
 *
 * The default is NOT to hold. Every screen that says nothing animates
 * immediately, exactly as before — otherwise a screen nobody had thought about
 * would silently pay the ceiling on every push.
 *
 * Returns its own release, which is idempotent and MUST be called from an
 * unmount cleanup as well as when the data lands. A hold left standing by a
 * screen the user backed out of would make the NEXT push wait the ceiling.
 */
export function holdScreenEnter(): () => void {
  _entryHolds += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    _entryHolds = Math.max(0, _entryHolds - 1);
    if (_entryHolds === 0) {
      for (const cb of _readyCallbacks) {
        cb();
      }
    }
  };
}

/** Whether any arriving screen is still holding its entrance. */
export function isScreenEnterHeld(): boolean {
  return _entryHolds > 0;
}

/**
 * Run `cb` when the last hold is released. Returns an unsubscribe; call it from
 * a cleanup, and call it before running `cb` yourself so a late release cannot
 * start a second animation.
 */
export function onScreenEnterReady(cb: SettledCallback): () => void {
  _readyCallbacks.add(cb);
  return () => {
    _readyCallbacks.delete(cb);
  };
}

/**
 * True once the current screen transition has settled — or immediately, if
 * there was never one to wait for.
 *
 * The shared form of the deferral the chat wallpaper and the emoji panel each
 * hand-rolled: subscribe to `onTransitionSettled`, with an idle callback as an
 * unconditional fallback so nothing can be stranded if the settle never
 * arrives, and first-one-wins between them.
 *
 * Use it to hold back work that is expensive and invisible — an image decode
 * behind a placeholder that already exists. Do NOT use it to hold back content
 * whose fallback means something different: swapping an avatar's initials for a
 * photo mid-transition reads as the wrong person, not as loading.
 */
export function useAfterTransition(): boolean {
  const [settled, setSettled] = useState(!transitioning.value);
  useEffect(() => {
    if (settled) {
      return;
    }
    let done = false;
    const go = () => {
      if (done) {
        return;
      }
      done = true;
      setSettled(true);
    };
    const unsubscribe = onTransitionSettled(go);
    // The fallback is unconditional on purpose: a lock that never lowers must
    // not be able to leave a photo permanently unmounted.
    const idle = requestIdleCallback(go);
    return () => {
      unsubscribe();
      cancelIdleCallback(idle);
    };
  }, [settled]);
  return settled;
}

/**
 * Mark a transition as started or finished.
 *
 * Call with `true` when a screen push/pop, sheet open or panel swap begins,
 * and with `false` in the animation's completion callback once it has settled.
 * Setting `false` notifies every `onTransitionSettled` subscriber in insertion
 * order, then clears nothing — subscribers remain registered until they call
 * their own unsubscribe return value.
 */
export function setTransitioning(active: boolean): void {
  transitioning.value = active;
  if (!active) {
    for (const cb of _settledCallbacks) {
      cb();
    }
  }
}

const EMPH_ACCEL = Easing.bezier(
  M3.easing.emphasizedAccelerate[0],
  M3.easing.emphasizedAccelerate[1],
  M3.easing.emphasizedAccelerate[2],
  M3.easing.emphasizedAccelerate[3],
);

/** Every spring by name, the four interaction springs and the six M3 springs. */
const ALL_SPRINGS = { ...SPRING, ...M3.spring };
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
/** Material 3 state-layer opacities, the 48dp minimum target, and scrim opacity. */
export const INTERACTION = TOKENS.interaction;

export type SpringName = keyof typeof SPRING;
export type M3SpringName = keyof typeof M3.spring;
export type AnySpringName = keyof typeof ALL_SPRINGS;

/**
 * Forward vs back, read at the moment a screen builder runs.
 *
 * A shared value rather than a prop because the disappearing view's `exiting`
 * animation is built at unmount, after its props are gone; and the entering
 * view must know whether it is a push (slide from the right) or a back (slide
 * from the left) without the route state machine re-rendering it to tell it.
 * The navigation helpers in `App.tsx` set this immediately before changing the
 * route, and the builders below read it inside their worklet.
 */
export const navDirection = makeMutable<'forward' | 'back'>('forward');
export function setNavDirection(direction: 'forward' | 'back'): void {
  navDirection.value = direction;
}

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
  name: AnySpringName = 'snap',
  velocity?: number,
): number {
  'worklet';
  const config: WithSpringConfig = {
    ...ALL_SPRINGS[name],
    reduceMotion: ReduceMotion.System,
    ...(velocity === undefined ? {} : { velocity }),
  };
  return withSpring(to, config);
}

/**
 * Opacity and colour only.
 *
 * Eased with Material 3 Expressive's `emphasized_decelerate` curve
 * (`cubic-bezier(0.05, 0.7, 0.1, 1.0)`) rather than a plain `out(quad)`: it
 * moves faster in the first phase and settles softer at the end, which is the
 * single most noticeable step toward the M3 motion feel (#7). Timing-only —
 * no spring or duration change, so no device rebuild needed.
 */
export function fadeTo(to: number, ms: number = DURATION.fast): number {
  'worklet';
  return withTiming(to, { duration: ms, easing: Easing.bezier(0.05, 0.7, 0.1, 1.0) });
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
 * Opening and closing search: a CROSSFADE in place, both directions, 150ms.
 *
 * Telegram's, read from source rather than guessed. `toggleSearch` animates the
 * search container's alpha against the action bar's menu icons — the field
 * fades up exactly as the icons fade out, `setDuration(150)`, and closing runs
 * the same animation in reverse (`ActionBarMenuItem.java:1013` opening,
 * `:1020` closing). Nothing slides and nothing moves: the search field arrives
 * in the row the icons were in, which is why it reads as the same bar changing
 * its mind rather than a new screen.
 *
 * `searchToggle` is its own token for that reason — it happens to equal
 * `stepPromote`, and they are unrelated measurements (design/tokens.json).
 */
export const searchIn = FadeIn.duration(DURATION.searchToggle).reduceMotion(
  ReduceMotion.System,
);

export const searchOut = FadeOut.duration(DURATION.searchToggle).reduceMotion(
  ReduceMotion.System,
);

/**
 * A bar that docks in at the TOP of a screen and leaves the same way.
 *
 * Hoisted for the reason every builder here is: they allocate on construction,
 * so one built inside a render is a new object per render. These two were the
 * last raw `.duration()` calls left in a screen — `220`/`160` written by hand at
 * the call site, close enough to `base`/`fast` to look like the tokens and
 * different enough to drift from them.
 *
 * In is slower than out on purpose, and it is the app's existing asymmetry
 * rather than a new opinion: `fadeSwap`/`fadeSwapFast` are the same `base`/`fast`
 * pair, and it matches the reference's own send-button reveal (~220ms in,
 * ~150ms out, `ChatActivityEnterView.java:8217, 10302-10319`). Arriving is an
 * announcement and wants to be seen; leaving should get out of the way.
 */
export const barIn = FadeInDown.duration(DURATION.base).reduceMotion(
  ReduceMotion.System,
);
export const barOut = FadeOutUp.duration(DURATION.fast).reduceMotion(
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
function stagger(base: number, index: number, cap: number): number {
  return base * Math.min(index, cap);
}

/**
 * A screen pushed onto the stack, or the one revealed when it pops.
 *
 * The M3 forward/back pattern: a short slide under a fade-through, never a
 * full-width push. Direction comes from `navDirection` read at build time, so
 * one builder serves both — a push enters from the right, a back enters from the
 * left.
 *
 * The geometry is Telegram's, measured from `ActionBarLayout.java` (see the
 * `distance.push` and `duration.short3` token notes): 48dp of travel under a
 * 150ms alpha ramp on a decelerate curve, push and pop symmetric. The first cut
 * used M3's medium2 (300ms) and 24dp and read as slow and wobbly on a device;
 * this is the snap a chat app is judged against. `spatialDefault` (k=700, ζ=0.9)
 * settles in ~168ms, the closest M3 spring to that 150ms, and M3's
 * emphasized-decelerate is the same family of curve as Android's
 * `DecelerateInterpolator`.
 *
 * Opacity is `Never` so the fade always runs, and the slide is `System` (via
 * `springTo`) so it collapses to a pure fade under reduce-motion — which is
 * exactly "reduced motion → fades only".
 */
/**
 * A two-thing cross-fade toggle, for a slot that swaps one control for another
 * (the composer's send ⇆ mic).
 *
 * Telegram reveals its send button by scaling it from 0.1 and fading it in over
 * ~220ms on EASE_OUT_QUINT while the mic scales away (`ChatActivityEnterView.java:
 * 8217, 10302-10319`); the reverse is quicker (~150ms). The two returned styles
 * are opposite phases of one shared value, so exactly one control is ever
 * substantial and they never both sit at full size mid-swap. `Never` on the
 * timing: this is discrete UI feedback, not a decorative flourish, and a user on
 * reduce-motion still needs to see which control is live — the cross-fade is the
 * signal, not an embellishment.
 */
export function useCrossfade(shown: boolean): {
  shownStyle: ReturnType<typeof useAnimatedStyle>;
  hiddenStyle: ReturnType<typeof useAnimatedStyle>;
} {
  const p = useSharedValue(shown ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(shown ? 1 : 0, {
      duration: shown ? M3.duration.short4 : M3.duration.short3,
      easing: EASE_OUT_QUINT,
      reduceMotion: ReduceMotion.Never,
    });
  }, [shown, p]);
  const shownStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 0.1 + 0.9 * p.value }],
  }));
  const hiddenStyle = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ scale: 0.1 + 0.9 * (1 - p.value) }],
  }));
  return { shownStyle, hiddenStyle };
}

export function useScreenEnter(): {
  style: ReturnType<typeof useAnimatedStyle>;
  onLayout: () => void;
  progress: SharedValue<number>;
  shift: SharedValue<number>;
} {
  /*
   * A layout-started entrance, NOT a Reanimated `entering` layout animation and
   * NOT an effect-started one either. Both were tried and frame-stepped on a
   * device (2026-09-02):
   *
   *   - `entering` (custom worklet and stock `FadeIn` alike) never ran on this
   *     mount path, while `exiting` on the same view did.
   *   - Starting the ramp from `useEffect` ran, but the clock started at MOUNT
   *     and a heavy screen (ChatScreen) takes several frames to lay out and
   *     paint for the first time — so its first visible frame was already
   *     two-thirds of the way through a 150ms fade: a jump, then a short tail.
   *
   * So the view mounts at opacity 0 / offset 48 (the style's initial values are
   * read from shared values, which IS applied before the first paint) and the
   * ramp starts from `onLayout`, which fires once the screen has real geometry
   * — content first, then the animation, which is exactly Telegram's
   * `needDelayOpenAnimation` (ActionBarLayout.java:2280). `onLayout` can fire
   * more than once; the ramp is started once.
   *
   * Direction is read once at mount, which is after the navigation helper set
   * it and before anything paints.
   */
  const back = navDirection.value === 'back';
  const progress = useSharedValue(0);
  const shift = useSharedValue(back ? -M3.distance.push : M3.distance.push);
  const started = useSharedValue(false);
  const onLayout = () => {
    if (started.value) {
      return;
    }
    started.value = true;
    /*
     * ONE FRAME between the mount commit and the animation's first frame.
     *
     * `onLayout` fires in the same frame as the screen's first React commit, so
     * the animation's opening frames were competing with the mount itself:
     * hooks firing, queries subscribing, FlashList computing its first layout.
     * Measured on the S22 at 60Hz, a push/pop had a p50 frame of 17.85ms
     * against Telegram's 7.55ms, with 44% of frames inside budget against
     * their 97.5% — while plain scrolling matched them almost exactly. The
     * transition was the whole gap.
     *
     * Telegram solves this with a DATA signal, not a geometry one:
     * `needDelayOpenAnimation()` holds the incoming screen at alpha 0 and
     * translateX 48dp until the first message batch has rendered
     * (ChatActivity.java:27014 returning `firstLoading`, cleared at :20613,
     * which calls `resumeDelayedFragmentAnimation`), with a 200ms timeout as
     * the safety net (ActionBarLayout.java:2270-2282, :1920-1927).
     *
     * We cannot see that signal from here — this hook knows nothing about any
     * particular screen's queries — so we take the part that generalises: give
     * the commit one whole frame to itself before starting. The screen sits
     * invisible for one extra frame (16.7ms at 60Hz), which is below the
     * threshold at which a tapped transition reads as delayed.
     *
     * `started.value` is set OUTSIDE the callback, so a second `onLayout`
     * arriving before the frame fires cannot start a second animation.
     */
    /*
     * Wait for the screen's DATA if it asked us to, and start regardless at the
     * ceiling. `holdScreenEnter`'s header carries the full reasoning and the
     * Telegram citations.
     *
     * Both paths are one-shot through `begin`, so a release arriving in the
     * same tick as the ceiling cannot start two animations. The subscription
     * and the timer are torn down by whichever fires first, and by the
     * disposer below if the screen is popped mid-wait.
     */
    let begun = false;
    const begin = () => {
      if (begun) {
        return;
      }
      begun = true;
      unsubscribe();
      clearTimeout(ceiling);
      ramp();
    };
    const unsubscribe = isScreenEnterHeld()
      ? onScreenEnterReady(begin)
      : () => undefined;
    const ceiling = isScreenEnterHeld()
      ? setTimeout(begin, ENTER_HOLD_CEILING_MS)
      : (undefined as unknown as ReturnType<typeof setTimeout>);
    cancelWait.current = () => {
      begun = true;
      unsubscribe();
      clearTimeout(ceiling);
    };
    if (!isScreenEnterHeld()) {
      begin();
    }
  };

  /*
   * Popped mid-wait: drop the subscription and the timer so nothing animates a
   * view that is on its way out, and so the ceiling cannot fire into an
   * unmounted component.
   */
  const cancelWait = useRef<() => void>(() => undefined);
  useEffect(() => () => cancelWait.current(), []);

  const ramp = () => {
    requestAnimationFrame(() => {
    /*
     * The transition lock is raised HERE, not at the call site.
     *
     * Every push in both trees goes through this hook, so raising it here means
     * a new pushed screen cannot forget to. The write side has to exist at all
     * or the lock is dead code: `transitioning` would read false forever and
     * every deferral that reads it (the wallpaper mount, the message-insert
     * scroll, the emoji pre-mount) would silently take its immediate branch.
     *
     * Lowered from the FADE's completion rather than the spring's. The spring
     * is `spatialDefault` and settles asymptotically, so waiting on it would
     * hold the lock well past the point anything is still visibly moving; the
     * 200ms fade is the part a deferred insert would actually have collided
     * with. `finished` is checked because an interrupted animation still calls
     * back, and a lock left raised is worse than the jank it avoids.
     */
    setTransitioning(true);
    // 200ms (short4), not Telegram's 150: at 150 the fade read as abrupt on the
    // S22 by hand (Amit, 2026-09-02); the slide keeps Telegram's 48dp.
    progress.value = withTiming(
      1,
      {
        duration: M3.duration.short4,
        easing: SCREEN_DECEL,
        reduceMotion: ReduceMotion.Never,
      },
      () => {
        runOnJS(setTransitioning)(false);
      },
    );
    shift.value = springTo(0, 'spatialDefault');
    });
  };
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: shift.value }],
  }));
  return { style, onLayout, progress, shift };
}

/**
 * Home's half of the M3 back transition, driven from the pop itself.
 *
 * Home is always mounted, so it has no `entering`: when a pushed screen pops,
 * Home would simply be there once the overlay is gone. M3's back pattern has the
 * predecessor slide in from the left as the leaving screen slides right, so Home
 * gets that slide from a module-level shared value.
 *
 * Kicked by the navigation helpers BEFORE the route changes (see App.tsx's
 * `popRoute` and the back handler), not from an effect on the new route: an
 * effect runs after the overlay has already begun fading, so the jump to -48
 * was visible through it (a 28-unit spike in the frame diff, 2026-09-02). Set
 * while the overlay is still opaque, the jump is hidden and only the settle is
 * seen. Same `spatialDefault` spring as `screenOut`, so the two halves move as
 * one.
 */
export const homeShift = makeMutable(0);
export function revealHome(): void {
  homeShift.value = -M3.distance.push;
  homeShift.value = springTo(0, 'spatialDefault');
}
export function useHomeRevealStyle() {
  return useAnimatedStyle(() => ({
    transform: [{ translateX: homeShift.value }],
  }));
}

/**
 * The screen leaving, mirror of `useScreenEnter`: same 150ms, opposite direction.
 * This one IS a layout animation (`exiting`), because that half runs reliably
 * and there is no mounted component left to hold a shared value for it.
 */
export function screenOut() {
  'worklet';
  const back = navDirection.value === 'back';
  return {
    initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
    animations: {
      opacity: withTiming(0, {
        duration: M3.duration.short4,
        // The outgoing screen holds, then goes: emphasized-accelerate (M3's exit
        // curve). Telegram mirrors its decelerate here (alpha drops fast,
        // ActionBarLayout.java:1899-1907) and that read as a cut by hand on the
        // S22 (Amit, 2026-09-02); the slow-start curve keeps the leaving screen
        // legible while Home settles in beneath it.
        easing: EMPH_ACCEL,
        reduceMotion: ReduceMotion.Never,
      }),
      transform: [
        { translateX: springTo(back ? M3.distance.push : -M3.distance.push, 'spatialDefault') },
      ],
    },
  };
}

/**
 * Top-level destination swap (the tab layers, boot phases).
 *
 * The M3 top-level pattern is a fade-through with no slide and no shared
 * element. It is written here WITHOUT the "out, then in" delay: the tab layers
 * sit over an always-mounted Home, so a gap between the outgoing fade and the
 * incoming one shows Home for 100ms — a flash, verified on device 2026-09-02 —
 * rather than the neutral surface the pattern assumes. A straight cross-fade of
 * the two layers over Home reads as one dissolve. `Never`, because a fade IS
 * the reduced-motion answer for a top-level change, not something to remove.
 */
export const topLevelIn = FadeIn.duration(M3.duration.short4)
  .easing(EMPH_DECEL)
  .reduceMotion(ReduceMotion.Never);
export const topLevelOut = FadeOut.duration(M3.duration.short2)
  .easing(EMPH_ACCEL)
  .reduceMotion(ReduceMotion.Never);

/**
 * A bottom sheet rising and settling. Position only — the sheet body never fades.
 *
 * M3 is explicit that a bottom sheet should not fade as it enters or exits; the
 * scrim behind it fades instead (see `fadeTo(INTERACTION.scrim, …)` in the
 * dismiss hook). `spatialDefault` is the M3 "sheets rising and falling" spring,
 * and the optional velocity is the finger's speed at the end of a drag so a
 * flicked sheet keeps going at the speed it was thrown.
 */
export function sheetIn(velocity?: number): number {
  'worklet';
  return springTo(0, 'spatialDefault', velocity);
}
export function sheetOut(y: number, velocity?: number): number {
  'worklet';
  return springTo(y, 'spatialDefault', velocity);
}

/**
 * A menu or popover expanding from the edge nearest its anchor.
 *
 * M3's enter/exit pattern for a container that opens from a control: it expands
 * along one axis away from the anchoring edge. `scaleY` on `spatialFast` (small,
 * quick component) with the fade on effects timing; the anchor edge is set by
 * the consumer via `transformOrigin` on the card style, because only the caller
 * knows whether the menu opened above or below its trigger.
 */
export function menuIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scaleY: 0.85 }] },
    animations: {
      opacity: withTiming(1, {
        duration: M3.duration.short2,
        easing: EMPH_DECEL,
        reduceMotion: ReduceMotion.Never,
      }),
      transform: [{ scaleY: springTo(1, 'spatialFast') }],
    },
  };
}
export const menuOut = FadeOut.duration(M3.duration.short2)
  .easing(EMPH_ACCEL)
  .reduceMotion(ReduceMotion.Never);

/**
 * A list row arriving, capped at eight so a long list does not crawl in.
 *
 * Replaces `enterRow`, which set `.duration()` AND `.springify()` — the duration
 * was silently ignored the moment the spring config was present. This is a plain
 * worklet builder: opacity on effects timing (`Never`, always fades), translateY
 * on `spatialSlow` (`System`, snaps under reduce-motion), staggered by delay.
 */
export function rowIn(index: number) {
  const delay = stagger(STAGGER.row, index, 8);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 12 }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, {
            duration: M3.duration.short4,
            easing: EMPH_DECEL,
            reduceMotion: ReduceMotion.Never,
          }),
        ),
        transform: [{ translateY: withDelay(delay, springTo(0, 'spatialSlow')) }],
      },
    };
  };
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
 * squash would be a small lie about where it came from.
 *
 * Rule (motion-system.md, 2026-09-06): a spring where a finger's velocity is
 * being continued; a timed curve where it is not. A received message has no
 * gesture behind it, so both channels are timed — the previous version used
 * `SPRING.gentle` for both translate and scale, which overshoots for no reason
 * a user caused. Re-cut to:
 *
 *   opacity  — 120ms (`listAdd`) on emphasized-decelerate: the fade is the
 *              accessible fallback and must always run (`Never`).
 *   translateX — 250ms (`medium1`) on the keyboard cubic: the same curve and
 *              duration the IME panel travels on, so the bubble arrives as if
 *              it came from the same slot the keyboard did. Collapses under
 *              reduce-motion (`System`).
 *
 * Scale is removed entirely: a scale with no gesture behind it reads as the
 * animation just making the object smaller for a moment, rather than
 * expressing mass or direction.
 *
 * Source: `design/references/motion-system.md` §Refinement 2026-09-06.
 */
export function bubbleArrive() {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateX: -14 }],
    },
    animations: {
      opacity: withTiming(1, {
        duration: DURATION.listAdd,
        easing: EMPH_DECEL,
        reduceMotion: ReduceMotion.Never,
      }),
      transform: [
        {
          translateX: withTiming(0, {
            duration: M3.duration.medium1,
            easing: KEYBOARD_CUBIC,
            reduceMotion: ReduceMotion.System,
          }),
        },
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
