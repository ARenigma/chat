/**
 * The token economy, stated once.
 *
 * `applyDebit` / `applyCredit` are the executable specification of the
 * `public.deduct_user_token` and `public.credit_user_token` SQL functions:
 * same inputs, same outputs, same rejection reason. The client uses them to
 * pre-flight a send (so a member with 0 tokens never burns a round trip) and
 * the generated parity test in `scripts/db-test.mjs` asserts the database
 * agrees on exactly the same case table. If the two diverge, that test fails.
 *
 * This used to live under `supabase/functions/_shared/` so a Deno Edge Function
 * and Hermes could share it. With the AI path gone the send is a single Postgres
 * RPC, there is no second runtime, and the indirection bought nothing.
 */

/**
 * One message costs one token. No per-character maths, ever.
 * @deprecated Per-message billing is superseded by per-minute session metering
 * (ADR-0021). This constant remains in use by tests and the client-side pre-flight
 * guard until the session metering RPCs (migration 031) are wired to the app.
 */
export const MESSAGE_COST = 1;

/**
 * Below this, the refill affordance appears. Non-blocking.
 * Superseded by the admin config key `thresholds.low_balance_tokens` (default 22)
 * read via `get_active_config('thresholds')`. This constant remains the
 * client-side fallback until runtime config is propagated to the app. (ADR-0021)
 */
export const LOW_BALANCE_THRESHOLD = 3;

/** Tokens granted by `claim_daily_tokens`, at most once per 24h. */
export const DAILY_REFILL_TOKENS = 25;

/**
 * Balance handed to a brand-new profile. Changed from 50 → 0 per ADR-0021:
 * the starting grant is read from admin config `wallet.starting_grant_tokens`
 * (default 0). Migration 028 reclassified all existing balances as promo_balance;
 * new profiles start at 0 until an admin grant or recharge is applied.
 * Contract test in the pgTAP suite asserts the database default matches this value.
 */
export const STARTING_BALANCE = 0;

/** Hard input ceiling. Mirrors the CHECK constraint on `messages.body`. */
export const MAX_MESSAGE_CHARS = 4000;

/*
 * Both types below are deliberately not exported. `applyDebit`'s return type is
 * inferred at every call site, no caller has ever named either of them, and an
 * exported type is a promise about a shape as much as a function is.
 */
type LedgerError = 'INSUFFICIENT_BALANCE';

type DebitResult =
  | { readonly success: true; readonly newBalance: number }
  | { readonly success: false; readonly error: LedgerError };

/**
 * Mirror of `public.deduct_user_token`. `null` models "no profile row found",
 * which the SQL treats identically to an underfunded wallet.
 */
export function applyDebit(current: number | null, cost: number = MESSAGE_COST): DebitResult {
  if (current === null || current < cost) {
    return { success: false, error: 'INSUFFICIENT_BALANCE' };
  }
  return { success: true, newBalance: current - cost };
}

/** Mirror of `public.credit_user_token`. */
export function applyCredit(current: number | null, amount: number): number {
  return (current ?? 0) + amount;
}

/** Drives the refill nudge in the top bar. */
export function isLowBalance(balance: number | null): boolean {
  return balance !== null && balance < LOW_BALANCE_THRESHOLD;
}

/** Cheap client-side guard so a doomed send never leaves the device. */
export function canSend(balance: number | null): boolean {
  return applyDebit(balance).success;
}
