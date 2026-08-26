/**
 * Per-minute pricing, kept pure so it can be tested without a device.
 *
 * ADR-0019: the unit is a minute of a provider's time and the balance is money.
 * Everything money-shaped lives here — formatting, the per-channel rates, and the
 * "talk time left" derivation — so a screen never does paise arithmetic inline and
 * the two places that show a balance cannot format it differently.
 */

/** The three metered channels. Rates are per-minute, in whole rupees. */
export type Channel = 'audio' | 'chat' | 'video';

/**
 * Default per-minute rates, in rupees.
 *
 * A placeholder for a per-provider, per-channel rate that the schema does not
 * carry yet (ADR-0019 names the migration). The numbers are v13's reference
 * (Sara: audio ₹22, chat ₹22, video ₹35), used for every provider until the
 * `provider_rates` column lands. Kept as one constant so that swap is one edit.
 */
export const DEFAULT_RATES: Readonly<Record<Channel, number>> = {
  audio: 22,
  chat: 22,
  video: 35,
};

/**
 * The balance, formatted as Indian rupees.
 *
 * `en-IN` grouping (₹1,20,000, not ₹120,000) because the audience is Indian and
 * the lakh grouping is what reads as money here. No paise shown: the balance is
 * whole rupees at this stage, and a trailing `.00` on a wallet pill is noise.
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
 * Derived, never stored (ADR-0019): one balance, N providers, N rates, so storing
 * minutes would desync the instant the balance or a rate changed. Guards a zero or
 * missing rate rather than dividing by it.
 */
export function talkTimeLeft(rupees: number | null, ratePerMin: number): string {
  if (rupees === null || ratePerMin <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.max(0, Math.floor((rupees / ratePerMin) * 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** "₹22/min", the label under each action button and in the rate rows. */
export function rateLabel(ratePerMin: number): string {
  return `₹${ratePerMin}/min`;
}

/**
 * Below this many rupees the balance pill flinches and Recharge is nudged.
 *
 * A minute of the cheapest channel is the floor: under one more minute of talk is
 * the honest definition of "low", and it tracks the rate rather than a magic
 * number the way the old `< 3 tokens` did.
 */
export const LOW_BALANCE_RUPEES = DEFAULT_RATES.chat;

export function isLowRupees(rupees: number | null): boolean {
  return rupees !== null && rupees <= LOW_BALANCE_RUPEES;
}

/**
 * Whether a real payment can be taken.
 *
 * Off, and gated the same way `CALLS_ENABLED` is: the UPI intent / Play Billing
 * rail is a follow-up (ADR-0019), so the Recharge screen shows the packs and the
 * Pay button but does not pretend to charge. The daily starter credit is a
 * separate, real path that stays live. Flip this when the rail is wired.
 */
export const PAYMENTS_ENABLED = false;

/** The ₹ top-up packs offered on the Recharge screen. */
export const RECHARGE_PACKS: readonly number[] = [25, 60, 100, 180];
