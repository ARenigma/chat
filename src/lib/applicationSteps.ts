/**
 * The provider application, in three steps.
 *
 * It was one scroll of six fields. That is not a stylistic complaint: the
 * screen's own reason for existing is that Clarity's applicants get "Something
 * Missing" with no indication which thing, and the client-side age gate is there
 * so a 17-year-old is refused immediately rather than after filling in six
 * fields. Date of birth was the THIRD of those six, so the screen did not deliver
 * on either promise: it asked for a headline and a life story before it asked
 * the one question that can end the conversation.
 *
 * Grouping fixes both. Date of birth moves into the first step, so the refusal
 * arrives after three fields instead of six, and `missing_fields` can now open
 * the step that holds the first flagged field rather than dropping somebody at
 * the top of a form and asking them to hunt.
 *
 * The steps are a UI grouping over ONE mutation. `submit_provider_application`
 * is unchanged, takes all six fields at once, and is still the authority on what
 * is missing. Nothing here validates anything, and nothing here is sent.
 */

/** Exactly the field names `submit_provider_application` returns in `missing_fields`. */
export type ApplicationField =
  | 'display_name'
  | 'gender'
  | 'date_of_birth'
  | 'headline'
  | 'languages'
  | 'about';

export interface ApplicationStep {
  /** The stepper label. Short enough to sit beside two others on a 360pt row. */
  readonly title: string;
  readonly fields: readonly ApplicationField[];
}

export const APPLICATION_STEPS: readonly ApplicationStep[] = [
  // Date of birth is here, first, and that is the point of the regrouping.
  { title: 'You', fields: ['display_name', 'gender', 'date_of_birth'] },
  { title: 'How you talk', fields: ['languages', 'headline'] },
  { title: 'Why you', fields: ['about'] },
];

/** Every field, in the order a person meets it. */
export const APPLICATION_FIELDS: readonly ApplicationField[] =
  APPLICATION_STEPS.flatMap(step => step.fields);

/**
 * Which step holds `field`, or -1 for a name this build does not know.
 *
 * -1 rather than a throw: the server owns the field list, so a newer server
 * returning a seventh name must not crash the screen that is trying to tell
 * somebody what is missing. The caller shows it in the summary and leaves it
 * unlocated, which is worse than locating it and much better than a blank screen.
 */
export function stepOfField(field: string): number {
  return APPLICATION_STEPS.findIndex(step =>
    (step.fields as readonly string[]).includes(field),
  );
}

/**
 * The step to open when the server has told us what is missing.
 *
 * Earliest flagged step, not the first step and not the last one visited: someone
 * resubmitting is here to fix a named thing, and the flow should already be on
 * it. Falls back to 0 when nothing is flagged, or when everything flagged is
 * unknown to this build.
 */
export function firstFlaggedStep(missing: readonly string[]): number {
  const located = missing.map(stepOfField).filter(index => index >= 0);
  return located.length === 0 ? 0 : Math.min(...located);
}

/** The flagged fields belonging to one step, for that step's own summary. */
export function missingOnStep(
  missing: readonly string[],
  step: number,
): readonly string[] {
  return missing.filter(field => stepOfField(field) === step);
}
