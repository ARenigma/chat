// PAYMENTS_ENABLED and MOCK_PAYMENTS are defined in src/config.ts.
export { PAYMENTS_ENABLED, MOCK_PAYMENTS } from '../config';

/**
 * Per-minute pricing, kept pure so it can be tested without a device.
 *
 * The member sees **tokens**, never rupees (1 token = ₹1). The ₹ symbol appears
 * in exactly one place — the Recharge pay step, where we ask for real money —
 * and `formatRupees` exists only for that. Everywhere else a balance and a rate
 * are token counts, formatted by `formatTokens`. Metering is still per-minute
 * (ADR-0019); the unit shown just changed from ₹ back to tokens.
 *
 * GST follows the same rule, one step stricter: it is shown on the Recharge
 * packs and the pay step ONLY — never on a per-minute rate, a balance, a talk
 * timer or anything in chat. Tokens are a prepaid balance; tax was settled when
 * the rupees were paid, so a "22/min" that mentioned GST would be taxing the
 * same money twice in the reader's head (Amit, 2026-09-05: "GST on recharge
 * chips, no GST in chat"). `gstSplit` is the arithmetic; it is the inclusive
 * split `generate-invoice` prints, so the screen and the invoice can never
 * disagree by a paisa.
 */

/** The three metered channels. Rates are tokens per minute. */
export type Channel = 'audio' | 'chat' | 'video';

/**
 * Default per-minute rates, in tokens.
 *
 * Fallback rates: real rates read from admin config via get_active_config('economics'). (ADR-0021)
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
 * GST rate in basis points when admin config has not loaded yet. The live value
 * is `economics.gst_rate_bps` (ADR-0021); an operator who is not GST-registered
 * sets it to 0 and every GST line below disappears.
 */
export const DEFAULT_GST_RATE_BPS = 1800;

/** An inclusive rupee amount split into its taxable value and its GST, in paise. */
export interface GstSplit {
  totalPaise: number;
  taxablePaise: number;
  gstPaise: number;
}

/**
 * The GST inside a pack price. Prices are INCLUSIVE — ₹300 buys 300 tokens and
 * the ₹300 already contains the tax — so this backs the tax out of the total
 * rather than adding it on top.
 *
 * Integer paise, and the exact expression `generate-invoice/index.ts` uses:
 * `taxable = round(total × 10000 / (10000 + rate_bps))`, `gst = total − taxable`.
 * Same formula, same rounding, so the figure the member sees on the pack is the
 * figure on the invoice they download later.
 */
export function gstSplit(amountInr: number, rateBps: number = DEFAULT_GST_RATE_BPS): GstSplit {
  const totalPaise = Math.round(amountInr * 100);
  if (rateBps <= 0 || totalPaise <= 0) {
    return { totalPaise, taxablePaise: totalPaise, gstPaise: 0 };
  }
  const taxablePaise = Math.round((totalPaise * 10000) / (10000 + rateBps));
  return { totalPaise, taxablePaise, gstPaise: totalPaise - taxablePaise };
}

/**
 * Paise as rupees with two decimals — "₹45.76". Only for the GST line, which is
 * the one rupee figure on the screen that is not a whole number. `formatRupees`
 * stays integer so pack prices and the pay button read as round sums.
 */
export function formatRupeesPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return `₹${whole.toLocaleString('en-IN')}.${fraction.toString().padStart(2, '0')}`;
}

/** "18%" from 1800 bps; keeps one decimal only when the rate needs it (1250 → "12.5%"). */
export function gstPercentLabel(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/**
 * The one GST sentence every recharge surface shows — "incl. ₹45.76 GST" — or
 * `null` when no tax is charged, so a card, the pay button and the payment
 * sheet can never phrase the same fact three ways. Built here rather than in
 * each screen so `rateBps = 0` (an unregistered seller) removes the line
 * everywhere at once.
 */
export function gstIncludedLabel(amountInr: number, rateBps: number): string | null {
  const { gstPaise } = gstSplit(amountInr, rateBps);
  return gstPaise > 0 ? `incl. ${formatRupeesPaise(gstPaise)} GST` : null;
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
 * Talk-time thresholds for the wallet pill (minutes at the given rate).
 *
 * Product (2026-08-29): deep green at ≥1 hour left, red under 10 minutes,
 * lime yellow otherwise. Derived from balance ÷ rate so a rate change moves
 * the colours with it.
 */
export const HEALTHY_TALK_MINUTES = 60;
export const CRITICAL_TALK_MINUTES = 10;

/** Minutes of talk a balance buys at `ratePerMin`. Fractional; not for display. */
export function talkMinutesLeft(
  tokens: number | null,
  ratePerMin: number = DEFAULT_RATES.chat,
): number {
  if (tokens === null || ratePerMin <= 0) {
    return 0;
  }
  return tokens / ratePerMin;
}

export type WalletTone = 'healthy' | 'ok' | 'critical';

export function walletTone(
  tokens: number | null,
  ratePerMin: number = DEFAULT_RATES.chat,
): WalletTone {
  if (tokens === null) {
    return 'ok';
  }
  const minutes = talkMinutesLeft(tokens, ratePerMin);
  if (minutes >= HEALTHY_TALK_MINUTES) {
    return 'healthy';
  }
  if (minutes < CRITICAL_TALK_MINUTES) {
    return 'critical';
  }
  return 'ok';
}

/**
 * Below 10 minutes of talk at the chat rate the balance pill flinches and
 * Recharge is nudged. Kept as a predicate so existing call sites stay short.
 *
 * When `thresholdTokens` is provided (admin config `thresholds.low_balance_tokens`),
 * the check is a flat token comparison: `balance < threshold`. This lets operators
 * set the nudge boundary independently of the talk-time colour thresholds.
 * When omitted, behaviour is unchanged (walletTone 'critical' = < 10 min of chat).
 */
export function isLowBalance(tokens: number | null): boolean {
  return walletTone(tokens) === 'critical';
}

/** Token floor matching CRITICAL_TALK_MINUTES at the chat rate (tests / docs). */
export const LOW_BALANCE_TOKENS = CRITICAL_TALK_MINUTES * DEFAULT_RATES.chat;

/**
 * The top-up packs offered on the Recharge screen, in ₹ (1 token = ₹1). A ladder
 * up to ₹5000 (Amit, 2026-08-27), six values for a clean 2×3 grid — small enough
 * for a first try, large enough for a regular who tops up once.
 */
export const RECHARGE_PACKS: readonly number[] = [100, 300, 500, 1000, 2500, 5000];
