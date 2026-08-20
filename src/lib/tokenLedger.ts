/**
 * The app-facing view of the token economy.
 *
 * One implementation, two runtimes: the logic lives in
 * `supabase/functions/_shared/ledger.ts` so the Edge Function (Deno) and the
 * client (Hermes) cannot drift, and so the SQL parity test has a single
 * reference to check against.
 */
export {
  MESSAGE_COST,
  LOW_BALANCE_THRESHOLD,
  DAILY_REFILL_TOKENS,
  STARTING_BALANCE,
  MAX_MESSAGE_CHARS,
  HISTORY_LIMIT,
  applyDebit,
  applyCredit,
  isLowBalance,
  canSend,
} from '../../supabase/functions/_shared/ledger';

export type {
  DebitResult,
  LedgerError,
} from '../../supabase/functions/_shared/ledger';
