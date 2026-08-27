/**
 * The provider application flow's state helpers, kept pure so they can be tested.
 *
 * Mirrors the shape of `onboarding.ts` for the provider flow: a palette selector
 * keyed on phase and step index, and the step spec array that drives the
 * OnboardingStep checklist.
 *
 * Timing constants (BLOOM_FIELD_MS, BLOOM_CONTENT_MS, BLOOM_HOLD_MS,
 * STEP_ADVANCE_MS, COMPLETION_DELAY_MS, SOURCE_METRICS) live in `bloom.ts` and
 * `onboarding.ts` respectively; import from there rather than duplicating them.
 */

import type { IconName } from '../components/Icon';
import { BLOOM_PALETTES, type BloomPalette } from './bloom';
import type { Phase } from './onboarding';
import { APPLICATION_STEPS } from './applicationSteps';

/**
 * The three checklist row keys for the provider application.
 *
 * Separate from `StepKey` in onboarding.ts, which is `'identify' | 'verify'`
 * and belongs to the member sign-in flow. These are provider-specific values
 * that map to `APPLICATION_STEPS[0..2]`.
 */
export type ProviderStepKey = 'you' | 'how' | 'why';

/**
 * One row of the provider checklist.
 *
 * Mirrors the shape of `StepSpec` from onboarding.ts — same four fields, same
 * purposes — with `key` typed to `ProviderStepKey` instead of `StepKey`.
 * `OnboardingStep` only reads `title`, `description`, and `glyph` at runtime;
 * the caller casts via `as unknown as StepSpec` at the call site so `tsc` stays
 * clean while the runtime stays correct.
 */
export interface ProviderStepSpec {
  readonly key: ProviderStepKey;
  readonly title: string;
  readonly description: string;
  readonly glyph: IconName;
}

/**
 * The three checklist rows, in order.
 *
 * Titles are pulled from `APPLICATION_STEPS` so they cannot drift: the stepper
 * used to declare its own "You / How you talk / Why you" literals, which were a
 * second source of truth for names the server cares about.
 *
 * Descriptions are the `STEP_INTRO` copy from the previous screen, now living
 * here alongside the glyph so both are versioned together.
 */
export const PROVIDER_STEPS: readonly ProviderStepSpec[] = [
  {
    key: 'you',
    title: APPLICATION_STEPS[0]?.title ?? 'You',
    description:
      'Enough that somebody can decide whether to talk to you. Your date of birth is never shown.',
    glyph: 'person',
  },
  {
    key: 'how',
    title: APPLICATION_STEPS[1]?.title ?? 'How you talk',
    description: 'What you speak, and one line people will see first.',
    glyph: 'chat',
  },
  {
    key: 'why',
    title: APPLICATION_STEPS[2]?.title ?? 'Why you',
    description: 'The part a reviewer actually reads.',
    glyph: 'heart',
  },
] as const;

/**
 * Which palette the bloom field wears, given where the provider flow is.
 *
 * The palette changes on every step advance, so the field turns over on each
 * tap — the same feedback mechanism as the member onboarding, where the colour
 * reassignment is what makes the flow feel alive rather than feel like form
 * pages. `done` drains the field to white for the completion row.
 */
export function providerPaletteFor(phase: Phase, stepIndex: number): BloomPalette {
  if (phase === 'welcome' || phase === 'leaving') {
    return BLOOM_PALETTES.welcome;
  }
  if (phase === 'done') {
    return BLOOM_PALETTES.done;
  }
  if (stepIndex === 1) {
    return BLOOM_PALETTES.providerHow;
  }
  if (stepIndex === 2) {
    return BLOOM_PALETTES.providerWhy;
  }
  return BLOOM_PALETTES.providerYou;
}
