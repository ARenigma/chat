import {
  Easing,
  FadeIn,
  
  
  FadeOut,
  
  
  ReduceMotion,
  type WithSpringConfig,
  
  
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

const SPRING = TOKENS.motion.spring;
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
 * the reference app's EASE_OUT_QUINT (0.23,1,0.32,1) — the curve it reveals the send
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
 * Scale a pressable element to its named press scale over `pressRamp` ms.
 *
 * The rule that governs the curve: a spring where a finger's velocity is being
 * continued; a timed curve where it is not. A tap has no accumulated velocity
 * so the ramp is `EASE_OUT_QUINT`, not a spring. The short duration (100ms) keeps
 * feedback attached to the finger — the reference app's emoji cell presses to 0.8 in
 * ~80ms (`EmojiView.java`). `ReduceMotion.System` collapses the scale to
 * nothing under the OS "remove animations" setting; the element still responds
 * (the state change fires), it just does not move.
 *
 * The `'tab'` kind uses this curve rather than a spring per the owner ruling on
 * 2026-09-25: "100ms withTiming". `EASE_OUT_QUINT` is the reference app's
 * own interpolator for UI feedback (`CubicBezierInterpolator.EASE_OUT_QUINT`).
 */
export function pressIn(kind: keyof typeof PRESS): number {
  'worklet';
  return withTiming(PRESS[kind], {
    duration: DURATION.pressRamp,
    easing: EASE_OUT_QUINT,
    reduceMotion: ReduceMotion.System,
  });
}

/**
 * Return a pressable element to its rest scale after the finger lifts.
 *
 * Symmetric with `pressIn`: same duration, same curve, same reduce-motion
 * treatment. Scale returns to 1 (the worklet's own animation target, not a
 * progress value) so callers that hold the scale directly use this directly.
 */
export function pressOut(): number {
  'worklet';
  return withTiming(1, {
    duration: DURATION.pressRamp,
    easing: EASE_OUT_QUINT,
    reduceMotion: ReduceMotion.System,
  });
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

export type AnySpringName = keyof typeof ALL_SPRINGS;

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
  reduceMotion?: ReduceMotion,
): number {
  'worklet';
  // The default is resolved HERE, not as `= ReduceMotion.System` in the
  // parameter list. The worklets plugin captures the identifiers a worklet's
  // body reads; a default parameter's expression is not part of that, so on
  // the UI thread `ReduceMotion` was undefined and every spring threw
  // "Property 'ReduceMotion' doesn't exist" (S22, 2026-09-26).
  const config: WithSpringConfig = {
    ...ALL_SPRINGS[name],
    reduceMotion: reduceMotion ?? ReduceMotion.System,
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
export function fadeTo(to: number, ms?: number): number {
  'worklet';
  // Default resolved in the body for the reason given on springTo: a worklet
  // default parameter is not captured by the plugin.
  return withTiming(to, { duration: ms ?? DURATION.fast, easing: Easing.bezier(0.05, 0.7, 0.1, 1.0) });
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
 * The OUT half of that swap, and on the Notify control it is the only half.
 *
 * Amit, on the device 2026-09-17: "fade out not fade in". With `entering` alone
 * on a keyed view the old label is unmounted the instant the key changes and the
 * new one fades up from nothing, so the eye reads a blink and then a slow
 * arrival. Reanimated keeps an EXITING view mounted for the length of its
 * animation, and the replacement is already in place underneath it, so
 * `exiting` alone dissolves the old label OFF the new one. The control never
 * shows an empty state, and the change reads as the word being replaced rather
 * than as the button repainting itself.
 *
 * EMPH_ACCEL, not EASE_OUT: this module's own header says decelerate for
 * entering and accelerate for exiting, and this is an exit. Shorter than
 * `fast` for the reason `barOut` is shorter than `barIn` two blocks down -
 * arriving is an announcement and wants to be seen, leaving should get out of
 * the way.
 */
export const fadeSwapOutFast = FadeOut.duration(DURATION.fast * 0.75)
  .easing(EMPH_ACCEL)
  .reduceMotion(ReduceMotion.System);

/** The `base`-paced sibling, for a swap that is read rather than glanced at. */
export const fadeSwapOut = FadeOut.duration(DURATION.base * 0.75)
  .easing(EMPH_ACCEL)
  .reduceMotion(ReduceMotion.System);

/**
 * Opening and closing search: a CROSSFADE in place, both directions, 350ms on
 * EASE_OUT_QUINT.
 *
 * the reference app's, read from source. Nothing slides and nothing moves: the search
 * field arrives in the row the icons were in, which is why it reads as the same
 * bar changing its mind rather than a new screen.
 *
 * CORRECTED 2026-09-07, and the correction is the whole reason this docblock is
 * long. The 150ms these two used to run was read from
 * `ActionBar/ActionBarMenuItem.java` — the reference app's LEGACY action-bar search,
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
 * `ReduceMotion.System` — arrived at from the other end: the reference app drops the 5%
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
 * module-level "are we closing search" flag read at build time — is more
 * machinery than the difference is worth.
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
 * The tab strip's ACTIVE INDICATOR has no timing of its own any more
 * ------------------------------------------------------------------------- */

/*
 * Removed 2026-09-27 with the move to a pager (owner decision: Bluesky's
 * mechanics exactly). The indicator used to be a 500ms `withTiming` on M3's
 * standard curve with the elastic lead/trail edges of
 * `ElasticTabIndicatorInterpolator` — the TabLayout answer for a TAPPED tab
 * with nothing underneath it to follow. That case no longer exists: a tap now
 * asks the pager to scroll (`ViewPager2.setCurrentItem(item, true)`), and the
 * indicator follows the page's own offset frame by frame, which is the case
 * the old note here already named as the one where TabLayout "drives that case
 * from the pager's own offset instead" (`setIndicatorPositionFromTabPosition`).
 * So the timing is the platform's page scroll, and there is no curve left in
 * this file to own. See src/components/ProviderPager.tsx.
 */

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
