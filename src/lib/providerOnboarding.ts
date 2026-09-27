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

import { BLOOM_PALETTES, type BloomPalette } from './bloom';
import type { Phase } from './onboarding';

/**
 * Which palette the bloom field wears, given where the provider flow is.
 *
 * The palette changes on every step advance, so the field turns over on each
 * tap — the same feedback mechanism as the member onboarding, where the colour
 * reassignment is what makes the flow feel alive rather than feel like form
 * pages. `done` drains the field to white for the completion row.
 */
export function providerPaletteFor(phase: Phase, stepIndex: number): BloomPalette {
  // `leaving` already wears the first step's palette: colour and position exit
  // together, as in the source (see `paletteFor` in ./onboarding.ts).
  if (phase === 'welcome') {
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
