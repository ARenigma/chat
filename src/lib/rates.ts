/**
 * Per-minute pricing, kept pure so it can be tested without a device.
 *
 * The member sees **tokens**, never rupees (1 token = ₹1). The ₹ symbol appears
 * in exactly one place — the Recharge pay step, where we ask for real money —
 * and `formatRupees` exists only for that. Everywhere else a balance and a rate
 * are token counts, formatted by `formatTokens`. Metering is still per-minute
 * (ADR-0019); the unit shown just changed from ₹ back to tokens.
 */

/** The three metered channels. Rates are tokens per minute. */
export type Channel = 'audio' | 'chat' | 'video';

/**
 * Default per-minute rates, in tokens.
 *
 * A placeholder for a per-provider, per-channel rate the schema does not carry
 * yet. The numbers are v13's reference (chat 22, call 22, video 35). One
 * constant, so the swap to real rates is one edit.
 */
export const DEFAULT_RATES: Readonly<Record<Channel, number>> = {
  audio: 22,
  chat: 22,
  video: 35,
};

/**
 * A token balance for display: a plain count, grouped `en-IN` (1,20,000), with
 * no currency mark. This is what the wallet pill and the balance card show.
 */
export function formatTokens(tokens: number | null): string {
  if (tokens === null) {
    return '0';
  }
  return tokens.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * Rupees, and the ONLY place the ₹ mark is allowed: the Recharge pay button and
 * the "1 token = ₹1" note. Since a token is a rupee, the number is the same;
 * only the symbol differs, to signal "this is the real-money step".
 */
export function formatRupees(rupees: number | null): string {
  if (rupees === null) {
    return '₹0';
  }
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Minutes of talk time a balance buys at a given rate, as `m:ss`.
 *
 * Derived, never stored: one balance, N providers, N rates, so storing minutes
 * would desync the instant the balance or a rate changed.
 */
export function talkTimeLeft(tokens: number | null, ratePerMin: number): string {
  if (tokens === null || ratePerMin <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.max(0, Math.floor((tokens / ratePerMin) * 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** "22/min", the label under each action button and in the rate rows. Tokens, no ₹. */
export function rateLabel(ratePerMin: number): string {
  return `${ratePerMin}/min`;
}

/**
 * Below this many tokens the balance pill flinches and Recharge is nudged.
 *
 * A minute of the cheapest channel is the floor: under one more minute of talk
 * is the honest definition of "low", and it tracks the rate rather than a magic
 * number.
 */
export const LOW_BALANCE_TOKENS = DEFAULT_RATES.chat;

export function isLowBalance(tokens: number | null): boolean {
  return tokens !== null && tokens <= LOW_BALANCE_TOKENS;
}

/**
 * Whether a real payment can be taken.
 *
 * Off, and gated the same way `CALLS_ENABLED` is: the UPI intent / Play Billing
 * rail is a follow-up, so the Recharge screen shows the packs and the Pay button
 * but does not pretend to charge. The daily starter credit is a separate, real
 * path that stays live. Flip this when the rail is wired.
 */
export const PAYMENTS_ENABLED = false;

/** The token top-up packs offered on the Recharge screen. */
export const RECHARGE_PACKS: readonly number[] = [25, 60, 100, 180];
