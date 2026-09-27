/**
 * A provider's name in a notification: the first name only (Amit, 2026-09-27:
 * "always render only first name of provider").
 *
 * The same rule as `providerFirstName` in src/lib/display.ts, restated because
 * an Edge Function cannot import the app's source. Trimmed, then the first
 * whitespace-separated token; a single-token name is kept whole; null and blank
 * come back null so each sender keeps its own 'Someone' fallback.
 * __tests__/providerFirstName.test.ts runs both copies over one table.
 *
 * Only for a PROVIDER. A member's public name is their handle and is sent as it
 * is, so every caller says which one it holds.
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

/** The name to put in a push: first name for a provider, unchanged otherwise. */
export function pushName(displayName: string | null | undefined, isProvider: boolean): string | null {
  return isProvider ? providerFirstName(displayName) : (displayName ?? null);
}
