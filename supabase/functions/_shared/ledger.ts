/**
 * The token economy, stated once.
 *
 * `applyDebit` / `applyCredit` are the executable specification of the
 * `public.deduct_user_token` and `public.credit_user_token` SQL functions:
 * same inputs, same outputs, same rejection reason. The client uses them to
 * pre-flight a send (so a user with 0 tokens never burns a round trip) and
 * `supabase/tests/002_ledger_parity_test.sql` asserts the database agrees on
 * exactly the same case table. If the two ever diverge, that test fails.
 *
 * Dependency-free: runs under Deno and Hermes alike.
 */

/** One message costs one token. No per-character maths, ever. */
export const MESSAGE_COST = 1;

/** Below this, the refill affordance appears. Non-blocking. */
export const LOW_BALANCE_THRESHOLD = 3;

/** Tokens granted by `claim_daily_tokens`, at most once per 24h. */
export const DAILY_REFILL_TOKENS = 25;

/** Balance handed to a brand-new profile. Mirrors the column default. */
export const STARTING_BALANCE = 50;

/** Hard input ceiling, enforced server-side before any token is spent. */
export const MAX_MESSAGE_CHARS = 4000;

/** How many prior turns the companion is given as context. */
export const HISTORY_LIMIT = 20;

export type LedgerError = 'INSUFFICIENT_BALANCE';

export type DebitResult =
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

/** Mirror of `public.credit_user_token`; used to refund a failed generation. */
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
