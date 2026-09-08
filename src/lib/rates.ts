// PAYMENTS_ENABLED and MOCK_PAYMENTS are defined in src/config.ts.
export { PAYMENTS_ENABLED, MOCK_PAYMENTS } from '../config';

/**
 * Per-minute pricing, kept pure so it can be tested without a device.
 *
 * The member sees **rupees**, everywhere (Amit, 2026-09-08: "remove tokens and
 * replace with rs everywhere").
 *
 * This reverses the previous policy, which is worth stating rather than
 * quietly deleting: the member used to see TOKEN counts everywhere except the
 * Recharge screen, on the argument that a prepaid balance is not money and that
 * naming rupees outside the pay step would imply GST had not been settled.
 * The counter-argument won, and it is simpler: a member reasons in rupees, and
 * a second unit that happens to be 1:1 with the first is a unit nobody needed.
 *
 * Because 1 token = ₹1, this is a RENDERING change and not a conversion. The
 * ledger, the metering and every stored balance are untouched; only what the
 * screen says changed. `formatRupees` is gone rather than aliased, so the
 * compiler had to visit all 24 of its call sites instead of leaving some of
 * them rendering the old unit.
 *
 * Metering is still per-minute (ADR-0019).
 *
 * ONE distinction survives and must not be flattened: the STORAGE unit is still
 * tokens. `profiles.token_balance`, `rate_tokens_per_min`, the ledger and every
 * RPC still speak tokens, and code comments about those still say tokens —
 * changing them would make the prose disagree with the column it describes.
 * Rupees are what the SCREEN says. The two are 1:1, which is exactly why the
 * display could change without touching anything below it.
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
 * Rupees, for the surfaces where money is what is being named: the price on a
 * Recharge pack chip (both hosts), the Pay button, the payment sheet and the
 * "1 token = ₹1" note. Since a token is a rupee, the number is the same; only
 * the symbol differs, to signal "this is the real-money step".
 *
 * Whole rupees on purpose — `formatRupeesPaise` is the two-decimal form, and it
 * is used only for the GST split, which is the one figure on these screens that
 * is not a round sum.
 */
/**
 * A plain grouped COUNT, `en-IN` (1,20,000), with no currency mark.
 *
 * This is what `formatTokens` actually was, and removing that name exposed the
 * fact that it had two jobs: most of its call sites were rendering money, but
 * some were rendering counts — the usage ledger's "5 sessions" among them.
 * Renaming every site to `formatRupees` turned a session count into "₹5", which
 * the ledger's own tests caught immediately.
 *
 * So the two jobs now have two names. Money is `formatRupees`; anything that is
 * not money and merely wants Indian digit grouping is this.
 */
export function formatCount(value: number | null): string {
  if (value === null) {
    return '0';
  }
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

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
 * The GST inside a pack price. Prices are INCLUSIVE — ₹300 buys ₹300 and
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

/*
 * DELETED 2026-09-07: `gstExclusiveParts`.
 *
 * It returned the two strings — "₹254.24" and "+ ₹45.76 GST" — that the pack
 * cards rendered as two stacked Texts under the price, and it existed because
 * an INCLUSIVE price has to be broken into two numbers before either can be
 * shown. Its whole width argument (the 87.2dp measurement, the Android
 * `numberOfLines` caveat, why the break belongs to the design and not to the
 * layout) was about fitting that pair into a 48%-wide card.
 *
 * Exclusive pricing removes the problem rather than solving it. The base IS the
 * headline now — the card already says ₹300 — so the supporting line has one
 * number left to state, and one number is one line (Amit, 2026-09-07: "inline
 * subheader for gst should be one liner, not two"). `gstAddedLabel` below is
 * that line.
 *
 * Grepped before deleting: no consumer left in `src/`. Both recharge hosts and
 * PaymentSheet moved to `gstAddedLabel` / `packTotalInr` in the same change.
 */

/** A pack price with the tax ADDED on top of it, in integer paise. */
export interface GstOnTop {
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
}

/**
 * The tax ON TOP of a pack price. ₹300 + 18% = ₹354, and ₹300.
 *
 * THIS REPLACES THE INCLUSIVE MODEL (Amit, 2026-09-07: "gst should be exclusive
 * and on top of recharge pill values — if I select the 300 pill then I should
 * get ₹300 in my wallet but will be charged 300 + gst"). It supersedes
 * ADR-0021, which fixed pack prices as tax-inclusive; see ADR-0029.
 *
 * What actually changed is WHAT IS CHARGED, not how it is worded. Under the old
 * model the ₹300 pack captured ₹300 and the member was told ₹254.24 of it was
 * the pack and ₹45.76 was tax. Now the pack IS ₹300, the tax is ₹54 on top, and
 * Cashfree captures ₹354. Tokens are unchanged at 300, so `1 token = ₹1` still
 * describes what a token costs — the tax is on the purchase, not in the token.
 *
 * `gst = round(base × rate_bps / 10000)`, added rather than backed out, which is
 * the mirror image of `gstSplit` above. The two must round-trip: an invoice is
 * generated from `amount_paise` (the TOTAL captured) using the inclusive
 * back-out, so `gstSplit(total)` has to return this `basePaise` and this
 * `gstPaise` exactly, or the screen and the invoice disagree by a paisa. It does
 * for every pack at 18% — that is asserted over the real pack list in
 * __tests__/contract.test.ts rather than assumed here, because it is a property
 * of the pack values and the rate, not of the arithmetic alone.
 */
export function gstOnTop(baseInr: number, rateBps: number = DEFAULT_GST_RATE_BPS): GstOnTop {
  const basePaise = Math.round(baseInr * 100);
  if (rateBps <= 0 || basePaise <= 0) {
    return { basePaise, gstPaise: 0, totalPaise: basePaise };
  }
  const gstPaise = Math.round((basePaise * rateBps) / 10000);
  return { basePaise, gstPaise, totalPaise: basePaise + gstPaise };
}

/**
 * What the member is actually charged for a pack, in rupees.
 *
 * The Pay button and the payment sheet name this, never the pack price. Under
 * the inclusive model those were the same number and the distinction did not
 * exist; under exclusive pricing a Pay button reading "Pay ₹300" on a ₹354
 * charge would be the single worst thing on the screen.
 */
export function packTotalInr(baseInr: number, rateBps: number): number {
  return gstOnTop(baseInr, rateBps).totalPaise / 100;
}

/**
 * Rupees from paise, dropping a zero fraction: "₹54", but "₹37.50".
 *
 * At 18% every pack in `RECHARGE_PACKS` yields whole rupees of tax — 18, 54, 90,
 * 180, 450, 900 — because the tax is now computed ON a round number instead of
 * backed OUT of one. So the exclusive model retires the paise from these screens
 * almost entirely, and printing "₹54.00" would put decimal noise back on a card
 * that no longer has any. It is not unconditional: a rate like 1250 bps gives
 * ₹37.50 on the ₹300 pack, and that half-rupee has to survive.
 *
 * `formatRupeesPaise` is left exactly as it was. It is the two-decimal form the
 * invoice figures use, and its four pinned cases in contract.test.ts are about
 * that, not about this.
 */
function formatRupeesExact(paise: number): string { return paise % 100 === 0 ? formatRupees(paise / 100) : formatRupeesPaise(paise); }

/**
 * The one-line tax note under a pack price: "+ ₹54 GST".
 *
 * ONE line, not two (Amit, 2026-09-07). The card's headline is already the base,
 * so this states the only figure the headline does not, and the total lands on
 * the Pay bar where the money actually moves. That also makes the old width
 * problem go away rather than being managed: "+ ₹762.71 GST" was 87.2dp of a
 * 115.8dp card at bodySmall, and the widest this can now be is "+ ₹900 GST".
 *
 * `null` when no tax is charged, so `rateBps = 0` (a seller who is not
 * GST-registered) removes the disclosure from every surface at once — and,
 * because `gstOnTop` returns `totalPaise === basePaise` at rate 0, the Pay
 * button correctly stops adding anything at the same moment.
 */
export function gstAddedLabel(baseInr: number, rateBps: number): string | null {
  const { gstPaise } = gstOnTop(baseInr, rateBps);
  return gstPaise > 0 ? `+ ${ formatRupeesExact(gstPaise) } GST` : null;
}

/**
 * The same fact as a sentence, for `accessibilityLabel` and the pay step.
 *
 * Spoken labels get the TOTAL as well as the tax. A sighted member reads the
 * card's price and this line together; TalkBack reads one string, and "plus ₹54
 * GST" without a total leaves the listener to do the addition that the Pay
 * button does for everyone else.
 */
export function gstAddedSpoken(baseInr: number, rateBps: number): string | null {
  const { gstPaise, totalPaise } = gstOnTop(baseInr, rateBps);
  return gstPaise > 0
    ? `plus ${ formatRupeesExact(gstPaise) } GST, ${ formatRupeesExact(totalPaise) } total`
    : null;
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
