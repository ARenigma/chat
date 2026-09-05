/**
 * The chat bar's clock, kept pure so it can be tested without a device.
 *
 * Postgres owns metering (ADR-0020). `get_active_session` hands the member
 * `seconds_remaining` — `(next_bill_at − now) + floor(balance ÷ rate) × 60`,
 * read in ONE snapshot so the two terms agree even while pg_cron is up to a
 * minute behind on the deduction (migration 062). This module only ages that
 * number between syncs and decides how it is shown:
 *
 *   > 5 min   "13 min" — no seconds and no per-second repaint. A minutes label
 *             that ticked would pull the eye 60× a minute to a number that does
 *             not matter yet.
 *   ≤ 5 min   "4:59" — the countdown, per second, because now it does.
 *
 * (Amit, 2026-09-05: "countdown timer ticking per second only when ≤5 mins
 * left".) Nothing here touches billing or balance; it is display arithmetic.
 */

/** Inside this many seconds the bar counts down in m:ss and repaints every second. */
export const COUNTDOWN_THRESHOLD_SECONDS = 5 * 60;

/** The countdown's repaint period. */
export const COUNTDOWN_TICK_MS = 1_000;

/**
 * The repaint period above the threshold. The minutes label changes once a
 * minute; 15 s keeps it at most a quarter-minute stale at a quarter of a 1 Hz
 * clock's cost, and re-aims the aged figure between server syncs.
 */
export const COARSE_TICK_MS = 15_000;

/**
 * The server's figure aged to `nowMs`. `syncedAtMs` is TanStack's
 * `dataUpdatedAt` — the instant the snapshot was taken, which is the only
 * moment the number was exactly right. Null until billing has started (the
 * server sends null before activation, and on a binary older than 062 the
 * field is missing altogether), and never below zero: a lapsed minute on a
 * spent balance is the session's end, not negative time.
 */
export function secondsRemainingNow(
  secondsAtSync: number | null | undefined,
  syncedAtMs: number,
  nowMs: number,
): number | null {
  if (secondsAtSync == null || !Number.isFinite(secondsAtSync) || syncedAtMs <= 0) {
    return null;
  }
  const agedBy = Math.floor(Math.max(0, nowMs - syncedAtMs) / 1000);
  return Math.max(0, Math.floor(secondsAtSync) - agedBy);
}

/** Whether the bar is in its last-five-minutes mode. */
export function showsCountdown(remaining: number | null): boolean {
  return remaining !== null && remaining <= COUNTDOWN_THRESHOLD_SECONDS;
}

/** How often the clock repaints for a given remainder: per second only when counting down. */
export function clockTickMs(remaining: number | null): number {
  return showsCountdown(remaining) ? COUNTDOWN_TICK_MS : COARSE_TICK_MS;
}

/** m:ss — the countdown, and the elapsed time the leave dialog quotes. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Whole minutes, floored — never promise a minute the balance does not buy.
 * Below one minute the label says so rather than showing "0 min".
 */
export function formatMinutes(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) {
    return 'under 1 min';
  }
  return `${Math.floor(whole / 60)} min`;
}

/**
 * Seconds a balance buys at a rate — the bar's estimate before a session is
 * live and the server has a number. Derived, never stored (one balance, N
 * providers, N rates).
 */
export function estimatedTalkSeconds(tokens: number | null, ratePerMin: number): number {
  if (tokens === null || ratePerMin <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor((tokens / ratePerMin) * 60));
}
