import { readFileSync } from 'fs';
import { join } from 'path';
import { gstExclusiveLabel, gstExclusiveParts, gstSplit } from '../src/lib/rates';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * TypeScript with comments removed, for negative assertions.
 *
 * Three gates in this repo have passed against their own explanatory COMMENT
 * rather than against code — a `not.toContain('incl.')` cannot survive a comment
 * that says why "incl." was removed. Every source read below is stripped first
 * and then sliced to the block under test.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The body of one `StyleSheet.create` entry — `name: { ... }`, no nesting. */
function styleBlock(code: string, name: string): string {
  const at = code.indexOf(`${name}: {`);
  expect({ style: name, found: at > -1 }).toEqual({ style: name, found: true });
  return code.slice(at, code.indexOf('}', at));
}

/** WCAG 2.1 relative luminance / contrast, the same arithmetic check-contrast.mjs uses. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(pair => {
      const c = parseInt(pair, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTE = (
  JSON.parse(read('design/tokens.json')) as {
    color: { tokens: Record<string, Record<string, string>> };
  }
).color.tokens;
const hex = (token: string, mode: 'Light' | 'Dark'): string => PALETTE[token]![mode]!;

describe('recharge chips present GST exclusive of the base', () => {
  /*
   * The distinction this whole change turns on: an exclusive PRESENTATION of an
   * inclusive PRICE. ADR-0021 ("Recharge pack pricing (GST-inclusive)") fixes
   * pack prices as tax-inclusive and `create-order` sends the nominal pack price
   * as `order_amount`, so a chip that added tax on top would name a number no
   * member is ever charged. The base and the tax must sum back to the price.
   */
  it('splits each pack into a base and a tax that add back up to what Cashfree captures', () => {
    expect(gstExclusiveLabel(5000, 1800)).toBe('₹4,237.29 + ₹762.71 GST');
    expect(gstExclusiveLabel(300, 1800)).toBe('₹254.24 + ₹45.76 GST');
    expect(gstExclusiveParts(5000, 1800)).toEqual({
      base: '₹4,237.29',
      tax: '+ ₹762.71 GST',
    });

    // An unregistered seller (gst_rate_bps = 0) removes the disclosure entirely,
    // and so does a zero pack — every surface guards on the null.
    expect(gstExclusiveLabel(300, 0)).toBeNull();
    expect(gstExclusiveParts(300, 0)).toBeNull();
    expect(gstExclusiveLabel(0, 1800)).toBeNull();

    const order = read('supabase/functions/create-order/index.ts');
    expect(order).toContain('order_amount: opts.amountInr');
    for (const pack of [100, 300, 500, 1000, 2500, 5000]) {
      const { taxablePaise, gstPaise } = gstSplit(pack, 1800);
      expect(taxablePaise + gstPaise).toBe(pack * 100);
      // \b so the 100 pack does not match `amountInr: 1000`.
      expect(order).toMatch(new RegExp(`amountInr:\\s*${pack}\\b`));
    }
  });

  it('stops asserting inclusion on either recharge host', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));
    const payment = withoutComments(read('src/screens/PaymentSheet.tsx'));

    expect(recharge).not.toContain('gstIncludedLabel');
    expect(payment).not.toContain('gstIncludedLabel');
    expect(recharge).not.toMatch(/incl\./);
    expect(payment).not.toMatch(/incl\./);

    // Four chip/label call sites (two per host) plus the pay step.
    expect(recharge.match(/gstExclusive(Parts|Label)\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(payment).toContain('gstExclusiveLabel(');
  });

  /*
   * "remove inc xxx gst from footer" (Amit, 2026-09-06).
   *
   * The pass before this one deleted the literal string and substituted GST
   * copy for it — "each pack shows base + 18% GST" in the sheet footer, and a
   * wallet-page note that grew from two sentences to three. That is not a
   * removal. This gate is deliberately blunt: the screen's own strings name no
   * tax at all, on either host, and the tax reaches the member from
   * `gstExclusiveParts`/`gstExclusiveLabel` — i.e. from the chips and the pay
   * step, which is where it was asked to live.
   *
   * It is not a dropped disclosure either. ADR-0021 makes pack prices
   * GST-inclusive and puts the legal instrument on the invoice Axionix issues;
   * the base and the tax are still named on every chip (asserted above and in
   * contract.test.ts) and again in the payment sheet's body.
   */
  it('takes GST off both footers and leaves the rate and the unit behind', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));

    expect(recharge).not.toMatch(/GST/);
    expect(recharge).not.toContain('gstPercentLabel');
    expect(recharge).not.toContain('gstSplit');

    // The compact sheet's ⓘ row and the wallet page's note, both unconditional:
    // no `taxed` branch, so no wording that can appear or vanish with the rate.
    const footer = recharge.slice(
      recharge.indexOf('function RechargeSheetFooter'),
      recharge.indexOf('export function RechargeWalletPage'),
    );
    expect(footer).toContain('1 token = ₹1 · you are charged in rupees at checkout');
    expect(footer).not.toContain('gstRateBps');
    expect(recharge).toContain('1 token = ₹1. You are charged in rupees at checkout.');
  });
});

describe('a selected money chip is a filled container', () => {
  const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));

  /*
   * androidx FilterChipTokens.kt: `FlatSelectedContainerColor =
   * SecondaryContainer`, `SelectedLabelTextColor = OnSecondaryContainer`,
   * `FlatSelectedOutlineWidth = 0.0.dp` — the outline is the UNSELECTED chip's
   * state. Both grids on this screen are the same control and take the same
   * treatment; the compact one used to be outline-only.
   */
  it('fills both grids, with no outline left on the selected state', () => {
    for (const style of ['cardOn', 'cardSelected']) {
      const block = styleBlock(recharge, style);
      expect(block).toContain('backgroundColor: t.color.bg.accentStrong');
      // bg/accent is the glyph-only step. theme.test.ts records it as a fact
      // ("the bright accent cannot carry text") and both chips carry 12sp text.
      expect(block).not.toMatch(/bg\.accent(?!Strong)/);
      expect(block).not.toContain('borderWidth');
    }
  });

  it('pairs the fill with the on-colour M3 guarantees, on every label that sits on it', () => {
    for (const style of ['amountOn', 'tokensOn', 'tokensGstOn', 'cardAmountOn', 'cardUnitOn']) {
      expect(styleBlock(recharge, style)).toContain('color: t.color.text.onAccent');
    }
    // developer.android.com/guide/topics/ui/accessibility/apps: 4.5:1 below
    // 18sp. bodySmall is 12sp, so the fill has to clear 4.5 in BOTH themes —
    // which is exactly what bg/accent (3.44 / 2.59) does not do.
    for (const mode of ['Light', 'Dark'] as const) {
      expect(contrast(hex('text/onAccent', mode), hex('bg/accentStrong', mode))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex('text/onAccent', mode), hex('bg/accent', mode))).toBeLessThan(4.5);
    }
  });

  // `coinOn` is not in this list any more because the coin is not on the card
  // any more: the wallet card's ₹ disc was standing in for the currency mark
  // its headline lacked, and a 40dp disc plus a 12dp gap left 63.8dp of a
  // 115.8dp card for text that now has to hold "₹5,000" (74.4dp). See the
  // `cardAmount` comment in RechargeScreen.tsx for the full arithmetic.
  it('flips every pill inset into a selected chip to the page colour with accent ink', () => {
    for (const style of ['ribbonOn', 'minutesTagOn', 'popularOn']) {
      expect(styleBlock(recharge, style)).toContain('backgroundColor: t.color.bg.base');
    }
    // Translucent white was the old answer and it composites to 2.67:1 / 2.04:1
    // under its own label; nothing on a selected card may go back to it.
    expect(recharge).not.toMatch(/rgba\(255,\s*255,\s*255/);
    for (const mode of ['Light', 'Dark'] as const) {
      expect(contrast(hex('text/accent', mode), hex('bg/base', mode))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('presses lighter, not darker, on both filled grids', () => {
    // Pressable.tsx resolves the M3 state layer to `onColor ?? text.primary`,
    // and the layer opacity is TOKENS.interaction.statePressed = 0.1, which is
    // androidx StateTokens.kt `PressedStateLayerOpacity = 0.1f`. Without the
    // prop a dark-ink layer would darken the coral fill on press.
    const compact = recharge.slice(
      recharge.indexOf('function RechargeSheetForm'),
      recharge.indexOf('function RechargeSheetFooter'),
    );
    const wallet = recharge.slice(
      recharge.indexOf('function RechargeForm'),
      recharge.indexOf('const makePageStyles'),
    );
    expect(compact).toContain('onColor={selected ? theme.color.text.onAccent : undefined}');
    expect(wallet).toContain('onColor={on ? theme.color.text.onAccent : undefined}');
  });

  it('gives the payment sheet a selected container as well as its check', () => {
    const payment = withoutComments(read('src/screens/PaymentSheet.tsx'));
    expect(payment).toContain('on && styles.rowOn');
    expect(styleBlock(payment, 'rowOn')).toContain('backgroundColor: t.color.bg.accentTint');
    // The check icon stays: colour is never the only indicator, and the tint on
    // its own is a 1.22:1 boundary against bg/base.
    expect(payment).toContain('<Icon name="check" size={17}');
  });
});

/**
 * The badge's bottom edge: `popular` sits at `top: TOKENS.space.sm` (12) and is
 * bodySmall's 16dp line plus its 3dp of padding a side = 22dp tall, fixed
 * because its Text sets allowFontScaling={false}.
 */
const BADGE_BOTTOM_DP = 12 + 16 + 3 + 3;

/**
 * How far below a titleLargeEmphasized line box the ink actually starts: half
 * the 1.6dp of leading in a 22/28 line, plus the ~25% of em between Geist's
 * ascent and its cap height. Rounded down, so the gate is the pessimistic read.
 */
const TITLE_LARGE_CAP_OFFSET = 6;

const RECHARGE_SRC = withoutComments(read('src/screens/RechargeScreen.tsx'));

/** The two hosts' render bodies, stripped of comments and bounded to the function. */
const HOSTS = (() => {
  const src = RECHARGE_SRC;
  return {
    compact: src.slice(
      src.indexOf('function RechargeSheetForm'),
      src.indexOf('function RechargeSheetFooter'),
    ),
    // `function RechargeForm` does not match `function RechargeSheetForm`, so
    // this is the wallet-page grid and not the compact one.
    wallet: src.slice(src.indexOf('function RechargeForm'), src.indexOf('const makePageStyles')),
  };
})();

/** The single line an `accessibilityLabel={...}` prop occupies in either host. */
function labelLine(host: string): string {
  const at = host.indexOf('accessibilityLabel={');
  expect(at).toBeGreaterThan(-1);
  return host.slice(at, host.indexOf('\n', at));
}

/**
 * A host with its `accessibilityLabel` line removed, for asserting on what is
 * RENDERED.
 *
 * Not optional tidiness — without it this file shipped a false gate. The label
 * interpolates `${formatRupees(pack)}`, and `'${'` ends in `'{'`, so a search
 * for the rendered `'{formatRupees(pack)}'` matched the label instead and the
 * order assertion passed with no price on the card at all. Verified by deleting
 * the compact chip's price and watching the gate stay green.
 */
function renderOf(host: string): string {
  return host.replace(/^\s*accessibilityLabel=\{.*$/gm, '');
}

describe('a money chip shows the price it charges', () => {
  /*
   * The blocker this describe exists for: for one pass the wallet-page pack card
   * rendered a token count with no currency mark, a talk-time pill, and then the
   * GST base and tax — so the largest rupee figure on the ₹5,000 card was
   * ₹4,237.29, a number `create-order` never captures (it sends
   * `order_amount: opts.amountInr`, the nominal pack price) and no invoice ever
   * totals. GST "exclusive on the chips" means naming the base and the tax IN
   * ADDITION to the price, not INSTEAD of it.
   *
   * Order matters as much as presence: price first because it is what the card
   * is selling, the split last because a disclosure reads after the offer.
   */
  it.each([
    ['the compact sheet chip', 'compact' as const],
    ['the wallet-page pack card', 'wallet' as const],
  ])('renders price, then tokens, then base + tax on %s', (_name, key) => {
    const host = renderOf(HOSTS[key]);
    const price = host.indexOf('{formatRupees(pack)}');
    const tokens = host.indexOf('${formatTokens(pack)} tokens`');
    const base = host.indexOf('{gst.base}');
    const tax = host.indexOf('{gst.tax}');
    expect({ price: price > -1, tokens: tokens > -1, base: base > -1, tax: tax > -1 }).toEqual({
      price: true,
      tokens: true,
      base: true,
      tax: true,
    });
    expect(price).toBeLessThan(tokens);
    expect(tokens).toBeLessThan(base);
    expect(base).toBeLessThan(tax);
  });

  /*
   * developer.android.com/guide/topics/ui/accessibility/apps, "Describe each UI
   * element": "Use descriptions to convey the purpose and result of the
   * interaction, not the visual details" — and never a figure the screen does
   * not show. The wallet card's label spoke `formatRupees(pack)` while the card
   * rendered no rupee figure at all, so TalkBack and a sighted user were told
   * different prices. Now that the price is on the card the label is checked
   * against it: same figures, same order.
   */
  it('announces the figures the card shows, in the order the card shows them', () => {
    for (const key of ['compact', 'wallet'] as const) {
      const label = labelLine(HOSTS[key]);
      const price = label.indexOf('formatRupees(pack)');
      const tokens = label.indexOf('formatTokens(pack)');
      const split = label.indexOf('gstSpoken');
      expect({ host: key, price: price > -1, tokens: tokens > -1, split: split > -1 }).toEqual({
        host: key,
        price: true,
        tokens: true,
        split: true,
      });
      expect(price).toBeLessThan(tokens);
      expect(tokens).toBeLessThan(split);
    }
    // The wallet card also speaks its talk-time pill, and in the pill's place:
    // between the token count and the tax split.
    const wallet = labelLine(HOSTS.wallet);
    expect(wallet.indexOf('minutes of talk')).toBeGreaterThan(wallet.indexOf('formatTokens(pack)'));
    expect(wallet.indexOf('minutes of talk')).toBeLessThan(wallet.indexOf('gstSpoken'));
  });

  /*
   * Selection is STATE, not label text. Pressable.tsx says so on the prop
   * ("Selected state, surfaced through `accessibilityState` (not baked into the
   * label)"), and the Android guidance above puts the element's TYPE in the role
   * rather than in the string. The wallet card used to append ", selected" — an
   * English word hardcoded into a label, which TalkBack cannot translate and a
   * radio's own "checked" announcement already carries.
   */
  it('carries selection as accessibilityState on both grids, never as label text', () => {
    for (const key of ['compact', 'wallet'] as const) {
      expect(HOSTS[key]).toContain('accessibilityRole="radio"');
      expect(labelLine(HOSTS[key])).not.toMatch(/selected/);
    }
    expect(HOSTS.compact).toContain('checked={selected}');
    expect(HOSTS.wallet).toContain('checked={on}');
  });

  /*
   * The compact chip's badge is absolutely positioned at top 12dp and is a fixed
   * 22dp tall (bodySmall's 16dp line plus 3dp a side, allowFontScaling={false}),
   * so it owns 12dp-34dp. The chip had NO vertical padding: 104dp of minHeight
   * against 96dp of content gave 8dp of centred slack, which put the price line
   * 4dp below the border and straight under the badge at raised font scales
   * (at 1.3, "₹300" grows from 57.6dp to 74.9dp and reaches the badge).
   *
   * Padding, not slack, is the fix: it does not scale with the font
   * (m3.material.io/foundations/layout/understanding-layout/spacing), so the
   * clearance holds at the 200% that
   * developer.android.com/about/versions/14/features#non-linear-font-scaling
   * asks to be tested.
   */
  it('reserves the badge strip on the compact chip with padding that cannot be scaled away', () => {
    const compactStyles = RECHARGE_SRC.slice(RECHARGE_SRC.indexOf('const makeCompactStyles'));
    const card = styleBlock(compactStyles, 'card');
    expect(card).toContain("paddingTop: TOKENS.space['2xl']");
    expect(card).toContain('paddingBottom: TOKENS.space.md');
    // 32dp of paddingTop clears the badge's 34dp bottom edge once the line's
    // leading and the cap-height offset are counted; anything at or below the
    // 24dp step does not.
    const SPACE = (JSON.parse(read('design/tokens.json')) as { space: Record<string, number> })
      .space;
    expect(SPACE['2xl']! + TITLE_LARGE_CAP_OFFSET).toBeGreaterThan(BADGE_BOTTOM_DP);
    expect(SPACE.xl! + TITLE_LARGE_CAP_OFFSET).toBeLessThan(BADGE_BOTTOM_DP);
  });
});
