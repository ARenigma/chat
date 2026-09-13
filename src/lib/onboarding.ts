import type { IconName } from '../components/Icon';
/**
 * The onboarding flow's state machine, kept pure so it can be tested.
 *
 * Same split as `src/lib/bloom.ts` and for the same reason: anything importing
 * `react-native` cannot be imported under jest.
 *
 * This is `OnboardingFlow.swift` and `MultiStepForm.swift` translated, with one
 * deliberate structural change explained under `visibleSteps`.
 *
 * **The whole flow is one screen.** There is no navigation anywhere in it. The
 * source models the entire thing as an integer `phase` plus a `currentStep`
 * index over a fixed array, with a single field rendered behind both, and every
 * visual change is a SwiftUI transition on that state rather than a push. That
 * is not an implementation detail — it is why the reference feels continuous,
 * and it is the property that would be lost first by rebuilding this as a
 * navigator with four routes.
 */

import { BLOOM_PALETTES, type BloomPalette } from './bloom';

/**
 * The four phases, from the source's `phase` integer plus its `hasFinishedForm`.
 *
 *   welcome  — carousel and CTA, field pooled at the bottom
 *   leaving  — content gone, field alone on screen. The source holds 1.2s here
 *              and that pause IS the transition rather than a gap before one.
 *   form     — the step checklist
 *   done     — completion, field drained to white
 */
export type Phase = 'welcome' | 'leaving' | 'form' | 'done';

/**
 * How the member is signing in.
 *
 * Google OR phone, never both. The source's three steps are sequential because
 * a wallet genuinely needs all three keys; ours are alternatives, so the list
 * branches where the reference's does not.
 */
export type Route = 'undecided' | 'google' | 'phone';

/** The rows the checklist can hold. */
export type StepKey = 'choose' | 'number' | 'code' | 'age' | 'languages';

/**
 * What the flow is currently asking for, within the form.
 *
 * `choose` is the fork, and it exists because our first step is a question where
 * the source's is a command. `number` and `code` are the phone branch; Google
 * never leaves `choose`, it just goes busy in place. There is deliberately no
 * confirm stage: the locked product decision drops WhatsApp's redundant
 * “is this number correct?” alert because OTP verification already proves it.
 *
 * This, and not `StepKey`, is what the field's colour follows — see `paletteFor`.
 */
export type IdentifyStage = 'choose' | 'number' | 'code';

export interface StepSpec {
  readonly key: StepKey;
  readonly title: string;
  readonly description: string;
  /*
   * Constrained to glyphs `Icon` actually draws. Widening this to `string` would
   * make a typo a runtime blank rather than a compile error, and the icon set is
   * hand-drawn here so there is no fallback glyph to land on.
   */
  readonly glyph: IconName;
}

export const STEPS: Readonly<Record<StepKey, StepSpec>> = {
  choose: {
    key: 'choose',
    title: 'Choose a way in',
    description:
      'One tap with Google, or your number if you would rather not use it.',
    glyph: 'chat',
  },
  number: {
    key: 'number',
    title: 'Your number',
    description: "We'll text a 6-digit code to confirm it's you.",
    /*
     * `call`, the handset. It can read as a smile at the collapsed 20pt size the
     * `code` note below warns about, but "your number" has no better abstract
     * mark and this row spends little time collapsed — you either send within
     * seconds or tap it to change the number — so the risk is small.
     */
    glyph: 'call',
  },
  code: {
    key: 'code',
    title: 'Your code',
    // The active step's supporting line sits directly above the boxes, so it is
    // the instruction, not trivia (Amit, 2026-09-03): "enter your OTP below".
    // The "sent to your number / expires shortly" detail is carried by the
    // preceding "Your number" step, so it need not repeat here.
    description: 'Enter your OTP below.',
    /*
     * `receipt`, a slip with two lines on it, and NOT `phone`.
     *
     * The phone glyph is semantically the obvious choice and the third place in
     * this build where it has failed visually: its handset is a quarter-arc plus
     * two end-caps, and beside anything larger than a tab-bar label the arc is
     * all that reads, which looks like a smile. A slip with digits on it is what
     * an SMS code actually is, and it survives being small and grey, which is
     * how this row spends most of its life.
     */
    glyph: 'code',
  },
  age: {
    key: 'age',
    title: 'How old are you?',
    description:
      'A rough band is enough. Pappal is for adults.',
    /*
     * `person`, not `people` or `calendar`.
     *
     * The age step is about the individual declaring something about themselves,
     * not about a group or a date. `person` is a standing figure — direct and
     * unambiguous — which survives being small and grey beside a collapsed
     * checklist row, which is where this glyph spends most of its life.
     */
    glyph: 'person',
  },
  languages: {
    key: 'languages',
    title: 'Which languages?',
    /*
     * The description says what the answer DOES, and says that skipping is
     * allowed, because both facts change whether the question is worth
     * answering. A multi-select with no stated consequence reads as a form
     * field; "we'll put them first" reads as a setting. And the step is
     * genuinely optional (see `includeLanguages`), so a member who does not
     * care needs to know that before they start tapping.
     */
    description: "Pick any you're comfortable in. We'll put them first.",
    /*
     * `globe`, not `chat` and not `people`.
     *
     * `chat` is already the choose step's mark and would say "conversation"
     * twice; `people` is a group, and this is a statement about the member. The
     * globe is the one glyph in this set that means language without meaning a
     * particular one, and — the constraint that actually decides it here — it is
     * a closed circular outline with interior strokes, so unlike `call` and
     * `phone` (see the notes above) it does not lose its meaning when this row
     * collapses to 20pt grey, which is where it spends the rest of the flow.
     */
    glyph: 'globe',
  },
};

export interface VisibleStepsOptions {
  /**
   * Include the age-declaration step as the final checklist row.
   *
   * Set to `true` once auth succeeds so the step appears the moment Google or
   * phone verification completes, before `finish()` is called. False (default)
   * during the auth phase so the age row does not appear as a promise that has
   * not been earned yet.
   */
  includeAge?: boolean;
  /**
   * Include the language-preference step as the final checklist row.
   *
   * Same contract as `includeAge` and set at the same moment: the two are the
   * post-auth questions and both are appended once auth succeeds, so the list
   * grows through the same offset-plus-opacity transition rather than the
   * screen changing.
   *
   * It is a SEPARATE flag rather than being folded into `includeAge` because
   * the two are asked of different people. Age is a hard gate the app boot
   * re-checks (`needsAgeBracket`, and `App.tsx` blocks entry on it), so a
   * member who already has a bracket never sees that row; the language
   * preference is optional and can be undeclared for a member whose age is
   * long since set. Either row can therefore appear without the other.
   */
  includeLanguages?: boolean;
}

/**
 * Which rows the checklist shows, given the route.
 *
 * **This is the one structural departure from the source, and it is forced.**
 * `MultiStepForm` renders `ForEach(steps)` over a fixed array, so its checklist
 * is the same height from the first frame: three rows, one expanded, two greyed
 * ahead of it. That works because its three steps are sequential — every user
 * does all of them.
 *
 * Ours are exclusive. Signing in with Google means there is no code to verify,
 * so a permanently-visible "Your code" row would be a promise the Google route
 * never keeps, and greying out a row that will never activate is worse than not
 * showing it. So the list grows by one when, and only when, the phone route is
 * taken. The growth uses the same offset-plus-opacity transition as everything
 * else, so it reads as part of the flow rather than as a layout jump.
 *
 * `options.includeAge` appends the age-declaration step after auth completes,
 * and `options.includeLanguages` appends the language-preference step after it.
 * That order is fixed and is not alphabetical luck: age is the gate the app
 * cannot start without, so it is asked first, and the optional preference is
 * the last thing between the member and the product.
 */
export function visibleSteps(
  route: Route,
  options: VisibleStepsOptions = {},
): readonly StepSpec[] {
  const choose = STEPS.choose;
  if (choose === undefined) {
    throw new Error('choose step missing');
  }
  const steps: StepSpec[] = [choose];
  if (route === 'phone') {
    const number = STEPS.number;
    const code = STEPS.code;
    if (number === undefined || code === undefined) {
      throw new Error('phone steps missing');
    }
    steps.push(number, code);
  }
  if (options.includeAge) {
    const age = STEPS.age;
    if (age === undefined) {
      throw new Error('age step missing');
    }
    steps.push(age);
  }
  if (options.includeLanguages) {
    const languages = STEPS.languages;
    if (languages === undefined) {
      throw new Error('languages step missing');
    }
    steps.push(languages);
  }
  return steps;
}

/**
 * Which palette the field wears, given where the flow is.
 *
 * The source reassigns `gradient` inside the same `withAnimation` that advances
 * the step, so the colour change and the step change are one event. Deriving the
 * palette from the state rather than storing it separately is what guarantees
 * they can never disagree.
 *
 * `done` is the source's `gradient = (.clear, .clear, .clear)` on the final
 * submit: the field drains to white without unmounting, which is what leaves the
 * completion list on a clean page while the layers are still there.
 */
export function paletteFor(phase: Phase, stage: IdentifyStage): BloomPalette {
  if (phase === 'welcome') {
    return BLOOM_PALETTES.welcome;
  }
  /*
   * `leaving` wears the FORM's palette, not the welcome one. That is the source:
   * in `OnboardingFlow.swift:69-74` the Continue handler assigns
   * `gradient = form.first.gradient` INSIDE the same
   * `withAnimation(.smooth(duration: 0.7))` that sets `phase = 1`, so the colour
   * turns over together with the exit from t=0. Each RadialGradient's
   * `.animation(.smooth.delay(x), value: phase > 0)` is keyed on `phase > 0`
   * only — it delays the centre and radius, not the colour.
   *
   * This shipped the other way round (welcome palette held through `leaving`,
   * colour swapped at the 1.2s handoff) and that was the visible jerk: the field
   * finished its exit at 1150ms and then started a SECOND full cross-fade fifty
   * milliseconds later, in the same tick that mounted the whole form. With the
   * palette changing here, `stage` is identical for `leaving` and `form`, so
   * the handoff does no field work at all.
   */
  if (phase === 'done') {
    return BLOOM_PALETTES.done;
  }
  /*
   * Keyed on the SUB-STAGE, not on the step key, and that distinction is the
   * whole bug it fixes. Keyed on the step there were two palettes across three
   * interactions, so tapping "use my number" changed nothing and the field
   * shifted once in the entire flow instead of on every tap.
   */
  if (stage === 'number') {
    return BLOOM_PALETTES.number;
  }
  if (stage === 'code') {
    return BLOOM_PALETTES.code;
  }
  return BLOOM_PALETTES.choose;
}

/**
 * Whether the layers' solid cores have collapsed.
 *
 * True everywhere except the welcome screen. The core is what makes the field
 * read as a saturated pool rather than a wash, and the source only wants that at
 * rest: `startRadius: phase > 0 ? 0 : 300`.
 */
export function coresCollapsed(phase: Phase): boolean {
  return phase !== 'welcome';
}

/**
 * How far through the field's POSITION animation a phase sits.
 *
 * Only the welcome screen has the field at the bottom. Everything after it has
 * the field at the top, so this is a two-valued function and not a ramp — the
 * ramp happens inside the animation between these two values.
 */
export function fieldAtRest(phase: Phase): boolean {
  return phase === 'welcome';
}

/**
 * The state of one control: idle, working, done, or failed.
 *
 * The source's `FieldState`. Worth having as four values rather than a boolean
 * because `success` and `idle` look different — a completed step greys its input
 * and disables its button rather than resetting it — and because `error` has to
 * be distinguishable from `idle` or a failed submit silently looks like nothing
 * happened.
 */
export type FieldState = 'idle' | 'loading' | 'success' | 'error';

/** A submit may only start from a state that is not already working or done. */
export function canSubmit(state: FieldState): boolean {
  return state === 'idle' || state === 'error';
}

/**
 * The source's `.smooth(duration: 0.5)` on a step advance.
 *
 * Shorter than the 0.7s the welcome exit uses, because a step change moves less:
 * one row collapses, one expands, and the field turns over. Matching them would
 * make the middle of the flow feel slower than its beginning.
 */
export const STEP_ADVANCE_MS = 500;

/**
 * How long a description takes to leave, from the source's `.animation(.smooth(duration: 0.2))`
 * on the `Step` description transition.
 *
 * Deliberately shorter than `STEP_ADVANCE_MS`: the answer to a step should feel
 * like it clears out of the way, not like it is being escorted off.
 */
export const STEP_EXIT_MS = 200;

/**
 * How long the description waits before it appears, once its step expands.
 *
 * The step's own promote runs first; the description arriving on the same frame
 * made the two read as one block sliding rather than a label settling and its
 * detail following. Named because it was a raw `.delay(80)` at the call site,
 * which is the shape the motion gate exists to catch.
 */
export const STEP_DESCRIPTION_DELAY_MS = 80;

/** How long the completion row waits before it appears. The source's `.delay(0.4)`. */
export const COMPLETION_DELAY_MS = 400;

/**
 * How long the completion row shows its working state before it resolves.
 *
 * The source's `CompletionStep` runs `await onSubmit()` and only then flips to
 * completed, so the working state lasts exactly as long as the real work. Ours
 * has no work left to await — the session already exists by the time this row
 * appears — but the moment is not instantaneous either: Supabase has to
 * propagate the session and the first query has to land. A fixed beat is honest
 * about that and avoids a check mark that appears before anything has happened,
 * which reads as fake.
 */
export const COMPLETION_WORK_MS = 1200;

/**
 * How long the completed state holds before the app moves on.
 *
 * The source's `DispatchQueue.main.asyncAfter(deadline: .now() + 1)`. Zero here
 * and the check mark is replaced in the same frame it finishes animating in,
 * which throws away the only moment in the flow that says it worked.
 */
export const COMPLETION_HOLD_MS = 1000;

/**
 * The reference's own measurements, in one place, so later screens can inherit
 * the same system instead of re-deriving it from taste.
 *
 * Every number below is read off `OnboardingFlow.swift` and its `Views/`, not
 * chosen. They are kept here rather than mapped onto the nearest space token
 * because several of them have no token: the checklist-to-control gap is 64 and
 * the scale stops at 40. Rounding 64 down to 40 to make it "token-clean" changes
 * the layout the reference actually has, and that is the wrong trade — the token
 * scale exists to stop arbitrary values, not to override a measured one.
 *
 * Where we deliberately depart, the constant says so.
 */
export const SOURCE_METRICS = {
  /** `padding(42)` on both the welcome block and the form. */
  blockPad: 42,
  /** `padding(.top, 120)` / `padding(.horizontal, 48)` on the carousel. */
  columnTop: 120,
  columnInset: 48,
  /** `VStack(alignment: .leading, spacing: 20)` in WelcomeScreen. */
  welcomeGap: 20,
  /** `Image(logo).frame(width: 50)`. */
  logo: 50,
  /**
   * DEPARTURE: source carousel artwork is capped at 38pt. Pappal's line icons
   * share the step icon's 32pt family; above it their strokes lose proportion.
   */
  carouselGlyph: 32,

  /** `MultiStepForm`'s outer `VStack(spacing: 64)`: checklist to control. */
  formGap: 64,
  /** Its inner `VStack(alignment: .leading, spacing: 32)`: step to step. */
  stepGap: 32,

  /** `Step.swift`: `VStackLayout(spacing: 12)` expanded, `HStackLayout(spacing: 24)` collapsed. */
  stepOpenGap: 12,
  stepShutGap: 24,
  /** `.font(.system(size: isExpanded ? 32 : 20))` on the icon. */
  iconOpen: 32,
  iconShut: 20,
  /** `.font(.system(size: isExpanded ? 42 : 24))` on the title. */
  titleOpen: 42,
  titleShut: 24,

  /** `CompletionStep`: `HStack(spacing: 24)`, `VStack(spacing: 12)`, 24pt icon and title. */
  doneGap: 24,
  doneBodyGap: 12,
  doneIcon: 24,
  doneTitle: 24,

  /** `InputField`: 20pt medium text, `.padding(.leading, 24)`, `.padding(.trailing, 16)`. */
  inputText: 20,
  inputLeading: 24,
  inputTrailing: 16,
  /**
   * `ContinueButton`'s `.padding(16)` around a `.headline`, which resolves to
   * about 53pt tall. Expressed as a height because React Native has no
   * intrinsic-content button to pad.
   */
  buttonHeight: 53,
  /**
   * A DEPARTURE, and the only one in this table. The source's input submit is
   * `padding(.vertical, 8).padding(.horizontal, 16)` around a 24pt glyph, which
   * lands near 40pt. Android's own guidance puts the minimum touch target at
   * 48dp (`TOKENS.interaction.minTarget`), and the app standardises on that
   * everywhere, so the larger of the two wins for the TARGET. A test asserts
   * this equals `minTarget` so it cannot drift back below the floor.
   */
  submitTarget: 48,

  /**
   * The PAINTED disc inside that target — 40dp, the reference's own size.
   *
   * Split out on 2026-09-13 (Amit: "the go button arrow is too big -- fix this
   * immediately and use our standard button size"). The target and the disc had
   * been one number, so raising the target to Android's 48dp floor also
   * inflated the circle, and a 48dp filled disc beside a 56dp field is what
   * "too big" was. The app's own interaction token already states the rule:
   * "M3's own icon buttons are a 40dp visual inside a 48dp target."
   *
   * WHY NOT hitSlop, which is the usual way to say that: `hitSlop` extends
   * touch DISPATCH but not `AccessibilityNodeInfo` bounds, measured on device
   * (see the hitSlop note in project memory). A 40dp Pressable with slop reads
   * as a 40dp target to TalkBack and Accessibility Scanner — an accessibility
   * regression traded for a visual one. So the Pressable stays a real 48dp box
   * and the fill moved to a 40dp CHILD, which is the one arrangement that gives
   * a 48dp node and a 40dp circle at the same time.
   */
  submitDisc: 40,
} as const;
