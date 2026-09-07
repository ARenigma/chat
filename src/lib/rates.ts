// PAYMENTS_ENABLED and MOCK_PAYMENTS are defined in src/config.ts.
export { PAYMENTS_ENABLED, MOCK_PAYMENTS } from '../config';

/**
 * Per-minute pricing, kept pure so it can be tested without a device.
 *
 * The member sees **tokens**, never rupees (1 token = ₹1) — everywhere except
 * the one place real money is being asked for. That place is the Recharge
 * screen: the pack chips, which are a price list, and the pay step. A store
 * card that does not name its price is not a store card, so the chip's headline
 * is `formatRupees(pack)` and the token count reads as what the price buys.
 * Everywhere else a balance and a rate are token counts, formatted by
 * `formatTokens`. Metering is still per-minute (ADR-0019); the unit shown just
 * changed from ₹ back to tokens.
 *
 * GST follows the same rule, one step stricter: it is shown on the Recharge
 * packs and the pay step ONLY — never on a per-minute rate, a balance, a talk
 * timer or anything in chat. Tokens are a prepaid balance; tax was settled when
 * the rupees were paid, so a "22/min" that mentioned GST would be taxing the
 * same money twice in the reader's head (Amit, 2026-09-05: "GST on recharge
 * chips, no GST in chat"). `gstSplit` is the arithmetic — the same inclusive
 * split `generate-invoice` prints, so the screen and the invoice can never
 * disagree by a paisa — and the surfaces PRESENT that split exclusively, as a
 * base plus a tax (`gstExclusiveParts`). Same money, stated the other way
 * round: what changed is the wording, never the amount charged.
 *
 * "On the packs and the pay step" is now literal: neither recharge FOOTER names
 * a tax (Amit, 2026-09-06: "remove inc xxx gst from footer"). The footers carry
 * the rate and the unit — "1 token = ₹1", charged in rupees — and nothing else,
 * because a chip that already names its own base and its own tax does not need
 * a weaker second statement of the same fact underneath the grid. The legal
 * instrument was never the footer either way: ADR-0021 puts it on the invoice
 * Axionix issues for a Cashfree purchase.
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
 * Rupees, for the surfaces where money is what is being named: the price on a
 * Recharge pack chip (both hosts), the Pay button, the payment sheet and the
 * "1 token = ₹1" note. Since a token is a rupee, the number is the same; only
 * the symbol differs, to signal "this is the real-money step".
 *
 * Whole rupees on purpose — `formatRupeesPaise` is the two-decimal form, and it
 * is used only for the GST split, which is the one figure on these screens that
 * is not a round sum.
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

/*
 * DELETED 2026-09-07: `gstIncludedLabel` and `gstPercentLabel`.
 *
 * `gstIncludedLabel` returned the INCLUSIVE phrasing, "incl. ₹45.76 GST".
 * `gstPercentLabel` returned the rate itself, "18%" from 1800 bps. Both went out
 * of use on 2026-09-06 — the chips and the pay step moved to `gstExclusiveParts`
 * / `gstExclusiveLabel` below (Amit: "GST exclusive on the chips") and neither
 * recharge footer names a rate any more (Amit: "remove inc xxx gst from
 * footer").
 *
 * They then survived a day longer than their last caller, kept alive by nothing
 * but `__tests__/contract.test.ts` pinning their output — a test asserting that
 * dead code still formats correctly, which is the shape of rot this repo gates
 * against everywhere else. Grepped before deleting: no consumer in `src/`.
 *
 * `gstSplit` stays. It is the shared arithmetic — the same expression
 * `generate-invoice/index.ts` prints — and `gstExclusiveParts` calls it.
 *
 * Restated rather than silently dropped, and gated: `contract.test.ts` › "states
 * the split one way only — the inclusive phrasing and the bare rate are gone"
 * fails the build if either name comes back to this file. If a future surface
 * genuinely needs the inclusive wording, `gstSplit` + `formatRupeesPaise` is two
 * lines, and it should arrive with the surface that renders it.
 */

/**
 * The tax in a pack price, stated EXCLUSIVE of it: "₹4,237.29" and
 * "+ ₹762.71 GST", two strings that sum back to the price to the paisa.
 *
 * A SUPPORTING pair, not a replacement for the price. Both hosts render the
 * price above these two lines, and they have to: for one pass they did not, and
 * the largest rupee figure on the ₹5,000 card was ₹4,237.29 — a number Cashfree
 * never charges and no invoice ever shows as a total.
 *
 * Exclusive PRESENTATION, not an exclusive PRICE, and the distinction is the
 * whole of it. ADR-0021 ("Recharge pack pricing (GST-inclusive)") fixes pack
 * prices as tax-inclusive, and `supabase/functions/create-order/index.ts` sends
 * `order_amount: opts.amountInr` — the nominal pack price — so Cashfree captures
 * ₹5,000 for the ₹5,000 pack and not a paisa more. A chip reading "₹5,000 + 18%
 * GST" would name ₹5,900, a price nobody is ever charged, and would break
 * 1 token = ₹1 on the way. Naming the base and the tax separately is the only
 * exclusive reading that is also true, and it is precisely the breakdown
 * `generate-invoice/index.ts:315` prints, so screen and invoice cannot drift.
 *
 * Two strings rather than one sentence, because the joined form is 23 characters
 * at bodySmall (12sp) and a 48%-wide pack card has 115.8dp of usable width on a
 * 360dp screen — it wraps, and an unmanaged wrap breaks after the dangling "+".
 * Two Texts break where the design chooses instead. React Native's own caveat
 * rules out the one-Text-two-lines alternative: "On Android, when numberOfLines
 * is set to a value higher than 1, only tail value will work correctly."
 * (https://reactnative.dev/docs/text#ellipsizemode)
 *
 * Neither Text sets `numberOfLines`, so neither truncates. At 12sp the wider of
 * the two ("+ ₹762.71 GST", 87.2dp) clears 115.8dp with room to about a 1.3
 * font scale, above which it wraps at the space before "GST" — a second line,
 * not a lost word, which is what "accommodate larger font sizes without
 * impacting usability" asks for
 * (developer.android.com/about/versions/14/features#non-linear-font-scaling).
 *
 * `null` when no tax is charged, so `rateBps = 0` (an unregistered seller)
 * removes the disclosure from every surface at once.
 */
export function gstExclusiveParts(
  amountInr: number,
  rateBps: number,
): { base: string; tax: string } | null {
  const { taxablePaise, gstPaise } = gstSplit(amountInr, rateBps);
  return gstPaise > 0
    ? { base: formatRupeesPaise(taxablePaise), tax: `+ ${formatRupeesPaise(gstPaise)} GST` }
    : null;
}

/**
 * The same split on one line — the pay step, where the total is already the
 * headline, and every accessibility label, where a line break means nothing.
 */
export function gstExclusiveLabel(amountInr: number, rateBps: number): string | null {
  const parts = gstExclusiveParts(amountInr, rateBps);
  return parts === null ? null : `${parts.base} ${parts.tax}`;
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
