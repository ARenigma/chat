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
export const EASE_OUT_QUINT = Easing.bezier(
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
 * A genuine sinusoidal breathe, for slow looping pulse animations.
 *
 * `Easing.inOut(Easing.sin)` is the mathematically correct breath curve: sine
 * is smooth at both turning points (velocity is zero at peak and trough) and
 * `inOut` pumps it symmetrically. The result is one uninterrupted sinusoid per
 * cycle — no tick at the reversal. Use this for any loop whose purpose is
 * "present and alive" rather than "loading" or "progress".
 */
export const EASE_BREATHE = Easing.inOut(Easing.sin);

/**
 * Constant-velocity motion only: marquee, indeterminate progress, a conveyor.
 *
 * LINEAR IS BANNED FOR ENTRANCES AND EXITS. A linear curve on something that
 * starts or stops reads as mechanical because real objects accelerate. Use this
 * only where the motion never starts or stops from the user's perspective — a
 * sweep that wraps, a ticker that runs forever, an indeterminate bar that has
 * no meaningful end point. AUDIT rule: "Constant motion (marquee, progress) →
 * linear". For anything entering or exiting, reach for EASE_OUT instead.
 */
export const EASE_CONSTANT = Easing.linear;

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
export const fadeSwap = FadeIn.duration(DURATION.base)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

/** The same swap at the speed of a tap, for a button label that just narrated itself. */
export const fadeSwapFast = FadeIn.duration(DURATION.fast)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

/**
 * Opening and closing search: a CROSSFADE in place, both directions, 350ms on
 * EASE_OUT_QUINT.
 *
 * Telegram's, read from source. Nothing slides and nothing moves: the search
 * field arrives in the row the icons were in, which is why it reads as the same
 * bar changing its mind rather than a new screen.
 *
 * CORRECTED 2026-09-07, and the correction is the whole reason this docblock is
 * long. The 150ms these two used to run was read from
 * `ActionBar/ActionBarMenuItem.java` — Telegram's LEGACY action-bar search,
 * which the dialogs list has not used for several versions (a 36dp bare
 * `EditTextBoldCursor` with `setBackgroundResource(0)`, no pill), and the two
 * `setDuration(150)` calls in it are at `:1019` and `:973`, not the `:1013` /
 * `:1020` the old comment cited. Neither the class nor the line numbers were
 * right, and no `.easing()` was set at all, so the curve was Reanimated's
 * default `Easing.inOut(Easing.quad)`
 * (https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming)
 * — a symmetric ease, against a reference that eases out hard.
 *
 * The field the reference ships is `Components/FragmentSearchField.java`, built
 * at `DialogsActivity.java:3285` and added to the content view at `:5344`. It
 * opens and closes on `BoolAnimator animatorSearchVisible`, constructed with
 * `CubicBezierInterpolator.EASE_OUT_QUINT` and `350`
 * (`DialogsActivity.java:307-308`), symmetric in both directions — hence one
 * token for both halves here rather than the in/out pair the rest of this file
 * uses. EASE_OUT_QUINT is `(.23, 1, .32, 1)`
 * (`CubicBezierInterpolator.java:13`), which is `M3.easing.easeOutQuint`.
 *
 * `.easing()` is a layout-animation modifier on the same builder chain as
 * `.duration()`:
 * https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/entering-exiting-animations
 *
 * `reduceMotion(System)` is kept from the previous version: under the OS
 * "remove animations" setting the row still swaps, it just swaps instantly.
 */
export const searchIn = FadeIn.duration(DURATION.searchField)
  .easing(EASE_OUT_QUINT)
  .reduceMotion(ReduceMotion.System);

export const searchOut = FadeOut.duration(DURATION.searchField)
  .easing(EASE_OUT_QUINT)
  .reduceMotion(ReduceMotion.System);

/* -------------------------------------------------------------------------
 * The other half of opening search: the CONTENT underneath swaps
 * ------------------------------------------------------------------------- */

/**
 * The results layer's away scale, 1.05 — it lives ABOVE the directory.
 *
 * `ObjectAnimator.ofFloat(searchViewPager, View.SCALE_X, show ? 1.0f : 1.05f)`
 * (`DialogsActivity.java:7573-7574`, with `SCALE_Y` on the second of the two;
 * the pager is also INITIALISED at that value, `searchViewPager.setScaleX(1.05f)`
 * / `setScaleY(1.05f)` at `:13284-13285`). A one-value `ObjectAnimator` runs from
 * the view's CURRENT value, so the results arrive 1.05 -> 1 and leave 1 -> 1.05:
 * they always sit slightly nearer the eye than the list they cover, and the swap
 * reads as depth rather than as two things trading places.
 *
 * CITATION CORRECTED 2026-09-07. This said `:7602-7603`, which is inside the
 * animator's `onAnimationEnd` listener and sets no scale at all — the value was
 * right and the pointer was not, which is worse than no pointer because it sends
 * the next reader to a line that quietly disagrees with the comment above it.
 * Re-read against the 12.10.1 (7038) tree, clone `62b56a07`, the same one
 * `src/components/SearchBar.tsx` is measured off.
 */
const SEARCH_RESULTS_AWAY = 1.05;

/**
 * The directory layer's away scale, 0.95 — it lives BELOW the results.
 *
 * `ObjectAnimator.ofFloat(viewPages[0], View.SCALE_X, show ? 0.95f : 1.0f)`
 * (`DialogsActivity.java:7556-7557`). Mirror of the above: the list leaves
 * 1 -> 0.95 and comes back 0.95 -> 1.
 *
 * BOTH away scales are guarded, and it is the same guard: `if (!budget)`
 * (`:7555` and `:7572`), where `budget` is
 * `getDevicePerformanceClass() == PERFORMANCE_CLASS_LOW || !LiteMode.isEnabled(
 * FLAG_CHAT_SCALE)` (`:7530`). On a low-end device, or with the chat-scale lite
 * flag off, the reference drops the scale animators entirely, sets both pagers
 * to 1 and animates ALPHA ONLY. That is the same split `contentArrive` /
 * `contentLeave` make below — opacity `ReduceMotion.Never`, scale
 * `ReduceMotion.System` — arrived at from the other end: Telegram drops the 5%
 * for a slow phone, we drop it for someone who asked the OS for less motion, and
 * in both cases the fade is the part that carries the meaning.
 */
const SEARCH_DIRECTORY_AWAY = 0.95;

/**
 * `searchAnimator.setStartDelay(20)`, and only on the close half
 * (`if (!show)`, `DialogsActivity.java:7593-7595`).
 *
 * Twenty milliseconds is a little over one frame at 60Hz, and it is not
 * decoration: closing search restores the dialogs list, which has been frozen
 * (`setDialogsListFrozen(true)`, `:7547`) and has to re-bind its rows. Starting
 * the fade one frame late means the first animated frame is drawn from real
 * content rather than from a half-built list. Applied to the OPEN half too would
 * make a tap on the search icon feel a frame late for no gain, which is exactly
 * why the reference guards it.
 */
const SEARCH_CLOSE_DELAY_MS = 20;

/**
 * A content layer arriving over its counterpart: alpha 0->1 and scale
 * `away`->1, timed and delayed by the caller.
 *
 * A worklet builder rather than `FadeIn.withInitialValues(...)`, because
 * `FadeIn` animates opacity ONLY — giving it an initial `transform` would set
 * the scale and never animate it away. The custom shape is
 * `{ initialValues, animations }` with the same style properties in both, which
 * is the documented requirement:
 * https://docs.swmansion.com/react-native-reanimated/docs/layout-animations/custom-animations
 *
 * Hoisted through a factory for the reason every builder in this file is: they
 * allocate on construction, so one built inside a render is a new object per
 * render.
 *
 * Opacity is `Never` and the scale is `System`. That split is this file's rule,
 * not a preference: the fade is what tells you which surface is live and must
 * always run, while a 5% scale is the decorative half and is exactly what
 * someone with vestibular sensitivity asked the OS to stop.
 */
function contentArrive(away: number, duration: number, delay: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: away }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(1, {
            duration,
            easing: EASE_OUT,
            reduceMotion: ReduceMotion.Never,
          }),
        ),
        transform: [
          {
            scale: withDelay(
              delay,
              withTiming(1, {
                duration,
                easing: EASE_OUT,
                reduceMotion: ReduceMotion.System,
              }),
            ),
          },
        ],
      },
    };
  };
}

/** Mirror of `contentArrive`: alpha 1->0 and scale 1->`away`. */
function contentLeave(away: number, duration: number, delay: number) {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: {
        opacity: withDelay(
          delay,
          withTiming(0, {
            duration,
            easing: EASE_OUT,
            reduceMotion: ReduceMotion.Never,
          }),
        ),
        transform: [
          {
            scale: withDelay(
              delay,
              withTiming(away, {
                duration,
                easing: EASE_OUT,
                reduceMotion: ReduceMotion.System,
              }),
            ),
          },
        ],
      },
    };
  };
}

/*
 * The four halves of the swap, and WHICH TOKEN EACH TAKES IS NOT A TYPO.
 *
 * The reference runs one `AnimatorSet` for the whole swap and times it by the
 * DIRECTION OF THE SESSION, not by which view is arriving:
 * `searchAnimator.setDuration(show ? 200 : 180)` (`DialogsActivity.java:7590`)
 * with `EASE_OUT` (`:7591`) for every child animator. So entering search is
 * 200ms for BOTH the results arriving and the directory leaving, and leaving
 * search is 180ms — plus the 20ms delay — for both of its halves. `searchEnter`
 * and `searchExit` are named for the session for that reason.
 *
 * `directoryIn` also runs on the first load after the skeleton, which the
 * reference has no equivalent of (its list is simply there). Stated rather than
 * hidden, per RULE 1 §6: it is the same 180ms EASE_OUT arrival, it reads as the
 * content landing rather than as a second mechanism, and the alternative — a
 * module-level "are we closing search" flag read at build time, the
 * `navDirection` trick — is more machinery than the difference is worth.
 */
export const searchResultsIn = contentArrive(
  SEARCH_RESULTS_AWAY,
  DURATION.searchEnter,
  0,
);
export const searchResultsOut = contentLeave(
  SEARCH_RESULTS_AWAY,
  DURATION.searchExit,
  SEARCH_CLOSE_DELAY_MS,
);
export const directoryIn = contentArrive(
  SEARCH_DIRECTORY_AWAY,
  DURATION.searchExit,
  SEARCH_CLOSE_DELAY_MS,
);
export const directoryOut = contentLeave(
  SEARCH_DIRECTORY_AWAY,
  DURATION.searchEnter,
  0,
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
export const barIn = FadeInDown.duration(DURATION.base)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);
export const barOut = FadeOutUp.duration(DURATION.fast)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

/* -------------------------------------------------------------------------
 * A section of a card that its own master switch reveals and hides
 * ------------------------------------------------------------------------- */

/**
 * How far the revealed block travels, in dp — `space.xs`, one M3 spacing step.
 *
 * It starts tucked UP behind the row that owns it and settles down into the
 * space the card just opened, which is the direction an accordion actually
 * unfolds. Deliberately small: the card has no `overflow: 'hidden'` (a clip
 * would cost a layer), so the only thing keeping the block off the row above at
 * the start of the travel is that it is still at opacity 0. Eight dp is under
 * one line of leading, so it is invisible in the frames where opacity is low
 * enough to matter and legible in the frames where it is not.
 */
const SECTION_SHIFT = TOKENS.space.xs;

/**
 * A collapsible section arriving, and the same section leaving.
 *
 * WHY THIS IS A LAYOUT ANIMATION AND NOT AN ANIMATED HEIGHT. An accordion is
 * usually written as a height ramp, and a height ramp is the one shape that is
 * specifically wrong here: `height` re-runs Yoga every frame for the node AND
 * its siblings, which on Android is the pattern that measures fine on a
 * flagship in dev and drops frames on a three-year-old phone. The rule the rest
 * of this file already follows — transform and opacity only, everything else is
 * a layout pass — gives the same answer, and the sanctioned tool for an element
 * that mounts and unmounts is `entering` / `exiting`. So the block is
 * conditionally rendered and the card's height changes ONCE per direction (at
 * mount, and at the end of the exit) rather than sixty times a second, while
 * the part the eye actually follows — the fade and the short travel — runs on
 * the UI runtime with no React render behind it.
 *
 * The cost of that choice, stated rather than glossed: the card's own height is
 * a step, not a ramp, so whatever sits below it moves in one jump. On the way
 * in the jump is hidden (the space opens, then the content arrives into it); on
 * the way out it lands after the content has already faded, which is the same
 * order `barIn` / `barOut` produce and the same order every other
 * appearing/disappearing block in this app already reads as.
 *
 * Timing is `barIn` / `barOut`'s, for the same reason and from the same pair of
 * tokens: `base` in, `fast` out — arriving is an announcement and wants to be
 * seen, leaving should get out of the way. `EASE_OUT` both ways rather than
 * M3's emphasized-accelerate on the exit half, which is a departure from the
 * curve `screenOut` and `menuOut` take and is named here as one: an accelerate
 * curve starts slow, and this block is dismissed by the switch directly above
 * it, so the first frames are exactly where the eye is. Ease-out on both halves
 * is what `barIn` / `barOut` already do for the same shape of change.
 *
 * Opacity is `Never` and the travel is `System`, this file's standing split:
 * the fade is what says the section went away and must always run, the 8dp is
 * the decorative half and is precisely what somebody with vestibular
 * sensitivity asked the OS to stop.
 */
export function sectionIn() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: -SECTION_SHIFT }] },
    animations: {
      opacity: withTiming(1, {
        duration: DURATION.base,
        easing: EASE_OUT,
        reduceMotion: ReduceMotion.Never,
      }),
      transform: [
        {
          translateY: withTiming(0, {
            duration: DURATION.base,
            easing: EASE_OUT,
            reduceMotion: ReduceMotion.System,
          }),
        },
      ],
    },
  };
}

export function sectionOut() {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
    animations: {
      opacity: withTiming(0, {
        duration: DURATION.fast,
        easing: EASE_OUT,
        reduceMotion: ReduceMotion.Never,
      }),
      transform: [
        {
          translateY: withTiming(-SECTION_SHIFT, {
            duration: DURATION.fast,
            easing: EASE_OUT,
            reduceMotion: ReduceMotion.System,
          }),
        },
      ],
    },
  };
}

/* -------------------------------------------------------------------------
 * The tab strip's ACTIVE INDICATOR, which is a Material component's motion and
 * not a decision this app gets to make
 * ------------------------------------------------------------------------- */

/**
 * M3's `standard` easing, cubic-bezier(0.2, 0, 0, 1), precomputed once.
 *
 * The exact string, from the platform's own token file:
 * `<string name="m3_sys_motion_easing_standard">cubic-bezier(0.2, 0, 0, 1)</string>`
 * — material-components-android
 * `lib/java/com/google/android/material/motion/res/values/tokens.xml`, which is
 * the same four numbers already in the token map as `motion.m3.easing.standard`.
 * M3's own guidance is that `standard` is the curve for a simple in-place change,
 * which is what an indicator moving inside a strip that is not itself moving is.
 *
 * WHY THIS AND NOT THE CURVE THE REFERENCE ACTUALLY USES, stated because it is a
 * departure and RULE 1 §6 requires departures to be named. `TabLayout` runs the
 * indicator on `motionEasingEmphasizedInterpolator`
 * (`lib/java/com/google/android/material/tabs/TabLayout.java:663-665`), and M3's
 * `emphasized` easing is NOT a single cubic bezier — it is a two-segment path,
 * `path(M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1 1,1)`
 * (the same `motion/res/values/tokens.xml`, rendered by a `pathInterpolator`).
 * `Easing.bezier` takes four control values and cannot express two joined
 * cubics, and `design/tokens.json` carries only the emphasized DECELERATE and
 * ACCELERATE halves plus `standard`, so the reference's own curve is not
 * available as a token here. Adding it would mean editing
 * `design/tokens.json` — which is outside this change set — AND writing a
 * hand-rolled path easing, which RULE 1 §3 argues against. `standard` is the
 * closest curve the token map actually holds; the shape of the motion is carried
 * by the two sine functions below, which ARE the reference's, exactly.
 */
const M3_STANDARD = Easing.bezier(
  M3.easing.standard[0],
  M3.easing.standard[1],
  M3.easing.standard[2],
  M3.easing.standard[3],
);

/**
 * The timing of one indicator move, taken from the M3 tab style.
 *
 * `Base.Widget.Material3.TabLayout` sets
 * `<item name="tabIndicatorAnimationDuration">?attr/motionDurationLong2</item>`
 * (material-components-android
 * `lib/java/com/google/android/material/tabs/res/values/styles.xml`), and
 * `motionDurationLong2` resolves to `m3_sys_motion_duration_long2` = **500**
 * (`lib/java/com/google/android/material/motion/res/values/tokens.xml`,
 * mapped in `theme/res/values/themes_base.xml`). That is `M3.duration.long2`
 * here, exactly — the first consumer of a token the map had reserved.
 *
 * 500 is longer than it sounds because the M3 indicator does not merely
 * translate: it STRETCHES across the gap and contracts on arrival (see
 * `tabIndicatorLead` / `tabIndicatorTrail`), and a stretch needs time to be
 * read as one object rather than as a jump. `TabLayout`'s own pre-M3 default is
 * `ANIMATION_DURATION = 300` (`TabLayout.java:200`), which is `M3.duration.
 * medium2`, if this ever needs to be quicker — that is a one-token swap, not a
 * new number.
 *
 * `ReduceMotion.System` because the travel is the decorative half: under the OS
 * "remove animations" setting the indicator jumps to the tab that was tapped,
 * which still says which tab is live (the label's ink changes too, so the state
 * is never carried by movement alone).
 */
export const TAB_INDICATOR = {
  duration: M3.duration.long2,
  easing: M3_STANDARD,
  reduceMotion: ReduceMotion.System,
} as const;

/**
 * Drive the indicator's progress toward a tab index.
 *
 * A TIMED CURVE rather than a spring, and against this file's opening rule that
 * nothing which changes position or size is animated with a curve — so it is
 * worth saying why. That rule exists because a curve cannot accept the velocity
 * a finger left behind. A tab is TAPPED: there is no gesture, no velocity, and
 * nothing to continue, which is the same reasoning `pressIn` already states for
 * the press ramp. And the reference is unambiguous — the indicator is a
 * `ValueAnimator` with an interpolator and a duration
 * (`TabLayout.java:3379-3386`), not a `SpringAnimation`. Where a spring WOULD be
 * right is a swipe between tab pages, which this strip does not have:
 * `TabLayout` drives that case from the pager's own offset instead
 * (`setIndicatorPositionFromTabPosition`, `TabLayout.java:3157`).
 */
export function tabIndicatorTo(index: number): number {
  'worklet';
  return withTiming(index, TAB_INDICATOR);
}

/**
 * The LEADING edge's share of the move — ease-out sine, so it leaves first.
 *
 * `ElasticTabIndicatorInterpolator.decInterp`: `(float) Math.sin((fraction *
 * Math.PI) / 2.0)`, material-components-android
 * `lib/java/com/google/android/material/tabs/ElasticTabIndicatorInterpolator.java`.
 * The class exists because the M3 tab style asks for it —
 * `<item name="tabIndicatorAnimationMode">elastic</item>` in
 * `Base.Widget.Material3.TabLayout` — and its own docstring says it "translates
 * the left and right sides of a selected tab indicator independently to make the
 * indicator grow and shrink between destinations".
 *
 * Applied to the edge the indicator is travelling TOWARD (`isMovingRight ?
 * rightFraction = decInterp : leftFraction = decInterp`), so that edge covers
 * most of the gap early while the other lags: the bar stretches out of the tab
 * it is leaving and gathers back in at the tab it arrives at.
 */
export function tabIndicatorLead(fraction: number): number {
  'worklet';
  return Math.sin((fraction * Math.PI) / 2);
}

/**
 * The TRAILING edge's share — ease-in sine, so it leaves last.
 *
 * `ElasticTabIndicatorInterpolator.accInterp`: `(float) (1.0 - Math.cos((
 * fraction * Math.PI) / 2.0))`, same file. Given to the edge the indicator is
 * travelling AWAY from. The pair is what makes the move elastic rather than a
 * rigid slide, and both are exact — a sine is not something that had to be
 * approximated into a bezier.
 */
export function tabIndicatorTrail(fraction: number): number {
  'worklet';
  return 1 - Math.cos((fraction * Math.PI) / 2);
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
