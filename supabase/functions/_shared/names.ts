/**
 * A person's name in a notification: the first name only. First for providers
 * (Amit, 2026-09-27: "always render only first name of provider"), then for
 * everyone (Amit, 2026-10-03: "always show only first name everywhere whether
 * in app or notification").
 *
 * The same rule as `providerFirstName` in src/lib/display.ts, restated because
 * an Edge Function cannot import the app's source. Trimmed, then the first
 * whitespace-separated token; a single-token name is kept whole; null and blank
 * come back null so each sender keeps its own 'Someone' fallback.
 * __tests__/firstName.test.ts runs both copies over one table.
 *
 * Members too since 2026-10-03: a member's display name ("Amit ranjan") was
 * pushed whole. A handle is one token, so it is unchanged.
 */
const COURTESY_TITLE = /^(dr|mr|mrs|ms|miss|prof|shri|sri|smt)\.?$/iu;

/*
 * A leading courtesy title is skipped when a name follows it ("Dr. Kavya Iyer"
 * reads "Kavya"): Dr, Mr, Mrs, Ms, Miss, Prof, Shri, Sri, Smt, with or without
 * a full stop. "Pandit" and "Acharya" are kept on purpose: for an astrologer
 * they are the name members know, not a courtesy.
 */
export function providerFirstName(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const [first, second] = trimmed.split(/\s+/u) as [string, string | undefined];
  return second !== undefined && COURTESY_TITLE.test(first) ? second : first;
}

/** The same rule under the name the app uses (src/lib/display.ts `firstName`). */
export const firstName = providerFirstName;

/**
 * The name to put in a push: the first name, whoever sent it. `isProvider` is
 * kept so callers need not change; it no longer decides anything.
 */
export function pushName(displayName: string | null | undefined, _isProvider: boolean): string | null {
  return providerFirstName(displayName);
}
