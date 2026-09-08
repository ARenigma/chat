/**
 * System-supplied ratings for providers who have not been rated yet.
 *
 * Amit, 2026-09-08: "seed random no of reviews for all profiles always with min
 * 1k and max 10k... until and unless we have genuine ratings.. we will go with
 * system ratings okay -- understoiod? same for staars from 4 to 5 with decimals
 * like 4.1, 4.3, 4.5 etc".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, SAID PLAINLY
 * ---------------------------------------------------------------------------
 * These are not ratings. Nobody left them. A row showing "4.3 ★ · 5.2k reviews"
 * for a provider with zero reviews is telling a member something untrue about
 * how other people found that provider, and it is doing it at the exact moment
 * the member is deciding who to pay.
 *
 * That is a product decision and it is Amit's to make; it is implemented here as
 * asked. What this file owes him is that the decision stays visible, reversible
 * and confined, rather than dissolving into the codebase as if the numbers were
 * real. So:
 *
 *   - It is in ONE module with this name, and nothing else computes a rating.
 *   - It is behind `SYSTEM_RATINGS_ENABLED` in config.ts. Flipping that to
 *     false makes every unrated provider render as unrated, with no other edit.
 *   - `isSystemRating` is exported, so any surface that wants to mark or
 *     withhold these can ask rather than guess.
 *   - The genuine number always wins once there are enough of them
 *     (`GENUINE_RATING_THRESHOLD`), so this shrinks as the product grows and
 *     eventually applies to nobody.
 *
 * And the specific exposure, once, because "we didn't know" is worse than
 * knowing: India regulates this directly. BIS IS 19000:2022 covers online
 * consumer reviews, and the CCPA's 2023 dark-patterns guidelines name
 * fabricated social proof. The risk is not that the numbers are flattering; it
 * is that they are attributed to reviewers who do not exist.
 *
 * ---------------------------------------------------------------------------
 * WHY DETERMINISTIC AND NOT RANDOM
 * ---------------------------------------------------------------------------
 * "Always choose random no" cannot mean `Math.random()`, and the difference is
 * not pedantry. A value drawn per render changes when the row re-renders and
 * again when FlashList recycles the cell, so a member scrolling a list would
 * watch a provider's review count change under their thumb. That is not a
 * plausible number, it is a visible bug — and it is the tell that would make
 * somebody look closely at all of them.
 *
 * So the number is random ACROSS providers and fixed FOR one: a hash of the id,
 * the same technique `seededExperienceYears` already uses in ProviderRow. Same
 * provider, same number, forever, on every device.
 *
 * No `react-native` import: pure, so it is testable in this repo (there is no
 * renderer in devDependencies).
 */
import type { ProviderSummary } from './database.types';
import { SYSTEM_RATINGS_ENABLED } from '../config';

/**
 * How many genuine ratings a provider needs before their real numbers are shown.
 *
 * FIFTY, and not one, which is a deliberate departure from the literal reading
 * of "until and unless we have genuine ratings" — Amit chose it when the cliff
 * was put to him.
 *
 * At a threshold of one, a provider displaying "4.3 ★ · 5.2k reviews" drops
 * overnight to "5.0 ★ · 1 review" the first time somebody rates them. Every
 * number on the row falls by three orders of magnitude, which reads as a broken
 * profile rather than as a fresh start, and it punishes the provider for
 * getting their first review. A threshold means the switch is invisible: the
 * real count only becomes visible once it is in the same range as the number it
 * replaces.
 *
 * It is a straight cutover and not a blend. Averaging a fabricated score into a
 * real one would make the real one unrecoverable and put the fiction inside a
 * number the provider is paid on.
 */
export const GENUINE_RATING_THRESHOLD = 50;

/** The band the system score is drawn from, inclusive, in tenths. */
export const SYSTEM_RATING_MIN = 4.0;
export const SYSTEM_RATING_MAX = 5.0;

/** The band the system review count is drawn from, inclusive. */
export const SYSTEM_REVIEWS_MIN = 1000;
export const SYSTEM_REVIEWS_MAX = 10000;

/**
 * A bounded, stable hash of an id.
 *
 * Copied in shape from `seededExperienceYears` rather than shared with it, and
 * that is on purpose: the two must not move together. If somebody retunes the
 * experience seed, review counts must not shuffle for every provider in the
 * directory at the same time.
 *
 * `% 100000` keeps the running value bounded without a bitwise op, which the
 * lint config forbids. `salt` decorrelates the two draws taken from one id —
 * without it, rating and review count would be perfectly rank-correlated and
 * every high-rated provider would also be the most-reviewed one, which is a
 * pattern a person notices even when they cannot name it.
 */
function hash(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) % 100000;
  }
  return h;
}

/** The system score for a provider, 4.0–5.0 in tenths, stable per id. */
export function systemRating(id: string): number {
  const steps = Math.round((SYSTEM_RATING_MAX - SYSTEM_RATING_MIN) * 10) + 1;
  return SYSTEM_RATING_MIN + (hash(id, 7) % steps) / 10;
}

/** The system review count for a provider, 1000–10000, stable per id. */
export function systemReviews(id: string): number {
  const span = SYSTEM_REVIEWS_MAX - SYSTEM_REVIEWS_MIN + 1;
  return SYSTEM_REVIEWS_MIN + (hash(id, 8191) % span);
}

export interface DisplayRating {
  /** 0–5. Drives how much of the star row is filled. */
  score: number;
  /** How many people the score claims to be from. */
  count: number;
  /**
   * True when `score` and `count` were manufactured by this module.
   *
   * Exported on the result rather than recomputed by callers, so a surface that
   * needs to withhold or mark these (a provider's own earnings view, an admin
   * screen, a future disclosure) can never disagree with what was rendered.
   */
  system: boolean;
}

/**
 * What a row should show for a provider, real or manufactured.
 *
 * The only entry point. Nothing else in the app decides which of the two
 * numbers to display, so turning the flag off is a single behaviour change
 * rather than an audit.
 */
export function displayRating(
  provider: Pick<ProviderSummary, 'id' | 'rating_avg' | 'rating_count'>,
): DisplayRating {
  const count = provider.rating_count ?? 0;

  // Genuine, and enough of them. `rating_avg` can still be null in a row where
  // the count is not — the view publishes them independently — so the average
  // is the thing checked, not just the count.
  if (count >= GENUINE_RATING_THRESHOLD && provider.rating_avg !== null) {
    return { score: provider.rating_avg, count, system: false };
  }

  if (!SYSTEM_RATINGS_ENABLED) {
    // The honest rendering: whatever is really there, including nothing.
    return { score: provider.rating_avg ?? 0, count, system: false };
  }

  return {
    score: systemRating(provider.id),
    count: systemReviews(provider.id),
    system: true,
  };
}

/** Whether what a row is showing came from this module. */
export function isSystemRating(rating: DisplayRating): boolean {
  return rating.system;
}

/**
 * "5.2k" / "847". Compact because the column is the avatar's width.
 *
 * `1,000` and `5,238` are 5 characters plus the word; the left column is 84dp,
 * which measured out at roughly 5.5dp per character of bodySmall on the Redmi.
 * "5,238 reviews" does not fit and would ellipsise — the exact defect
 * "no ratings yet" had before it became "0 ratings". The k-form does.
 *
 * One decimal, and `1.0k` rather than `1k`, so the width does not jitter
 * between rows as the list scrolls.
 */
export function formatReviewCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  return `${(count / 1000).toFixed(1)}k`;
}
