import {
  APPLICATION_FIELDS,
  APPLICATION_STEPS,
  firstFlaggedStep,
  missingOnStep,
  stepOfField,
} from '../src/lib/applicationSteps';

/**
 * The provider application's three steps.
 *
 * Two things here are worth a test rather than a comment. The first is
 * completeness: a field that exists on the form and in no step is a field the
 * server can flag and the screen cannot show, which turns "we will name what is
 * missing" into a dead end. The second is that date of birth is in the first
 * step, which is the entire reason the form was regrouped, the age gate's own
 * promise is that a 17-year-old hears no immediately, and DOB used to be third of
 * six.
 */
describe('APPLICATION_STEPS', () => {
  it('covers every field the server can flag, exactly once', () => {
    // Kept as a literal list rather than derived from the steps, so this is a
    // real cross-check: `submit_provider_application` returns these six names in
    // `missing_fields`, and the steps have to account for all of them.
    expect([...APPLICATION_FIELDS].sort()).toEqual([
      'about',
      'date_of_birth',
      'display_name',
      'gender',
      'headline',
      'languages',
    ]);
    expect(new Set(APPLICATION_FIELDS).size).toBe(APPLICATION_FIELDS.length);
  });

  it('asks for the birth date in the first step', () => {
    // The age gate refuses after three fields instead of six. This is the
    // assertion that stops a later tidy-up moving DOB back next to the headline.
    expect(stepOfField('date_of_birth')).toBe(0);
  });

  it('leaves the long answer for last', () => {
    // Nobody writes about why they are good at listening before being told
    // whether they are old enough to.
    expect(stepOfField('about')).toBe(APPLICATION_STEPS.length - 1);
  });

  it('gives every step a label short enough to sit beside the others', () => {
    expect(APPLICATION_STEPS).toHaveLength(3);
    for (const step of APPLICATION_STEPS) {
      expect(step.title.length).toBeLessThanOrEqual(14);
      expect(step.fields.length).toBeGreaterThan(0);
    }
  });
});

describe('stepOfField', () => {
  it('locates a known field', () => {
    expect(stepOfField('display_name')).toBe(0);
    expect(stepOfField('languages')).toBe(1);
  });

  it('returns -1 for a name this build does not know', () => {
    // Not a throw. The server owns the field list, so a newer server returning a
    // seventh name must not crash the screen that is trying to explain itself.
    expect(stepOfField('pronouns')).toBe(-1);
    expect(stepOfField('')).toBe(-1);
  });
});

describe('firstFlaggedStep', () => {
  it('opens on the earliest gap, not the first step', () => {
    expect(firstFlaggedStep(['about'])).toBe(2);
    expect(firstFlaggedStep(['about', 'gender'])).toBe(0);
    expect(firstFlaggedStep(['headline', 'about'])).toBe(1);
  });

  it('falls back to the beginning when there is nothing to land on', () => {
    expect(firstFlaggedStep([])).toBe(0);
    // Everything flagged is unknown to this build, so there is no step to open.
    expect(firstFlaggedStep(['pronouns'])).toBe(0);
  });
});

describe('missingOnStep', () => {
  it('shows a step only its own gaps', () => {
    const missing = ['display_name', 'headline', 'about'];
    expect(missingOnStep(missing, 0)).toEqual(['display_name']);
    expect(missingOnStep(missing, 1)).toEqual(['headline']);
    expect(missingOnStep(missing, 2)).toEqual(['about']);
  });

  it('drops what it cannot place rather than showing it everywhere', () => {
    expect(missingOnStep(['pronouns'], 0)).toEqual([]);
    expect(missingOnStep(['pronouns'], 2)).toEqual([]);
  });
});
