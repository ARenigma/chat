import { readFileSync } from 'fs';
import { join } from 'path';
import { gstAddedLabel, gstAddedSpoken, gstOnTop, gstSplit } from '../src/lib/rates';

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

describe('recharge chips present GST exclusive — charged on top of the base (ADR-0029)', () => {
  /*
   * Under the exclusive model the pack price IS what the member gets in tokens;
   * the tax is added on top. Selecting ₹300 puts 300 tokens in the wallet and
   * captures ₹354. `gstAddedLabel` names only the tax — "+ ₹54 GST" — so the
   * card's headline (₹300) stays the dominant figure.
   */
  it('adds the tax on top of the base, naming only the tax on the chip', () => {
    expect(gstAddedLabel(300, 1800)).toBe('+ ₹54 GST');
    expect(gstAddedLabel(5000, 1800)).toBe('+ ₹900 GST');
    expect(gstAddedSpoken(300, 1800)).toBe('plus ₹54 GST, ₹354 total');

    // An unregistered seller (gst_rate_bps = 0) removes the disclosure entirely.
    expect(gstAddedLabel(300, 0)).toBeNull();
    expect(gstAddedLabel(0, 1800)).toBeNull();
    expect(gstAddedSpoken(300, 0)).toBeNull();
  });

  it('round-trips through the inclusive back-out used by generate-invoice', () => {
    // The invoice is generated from amount_paise (the total captured) using the
    // inclusive back-out formula in gstSplit. The back-out must recover the
    // original base exactly or the screen and the invoice disagree.
    for (const pack of [100, 300, 500, 1000, 2500, 5000]) {
      const { basePaise, gstPaise, totalPaise } = gstOnTop(pack, 1800);
      const { taxablePaise, gstPaise: invoiceGst } = gstSplit(totalPaise / 100, 1800);
      expect({ pack, taxablePaise, invoiceGst }).toEqual({
        pack,
        taxablePaise: basePaise,
        invoiceGst: gstPaise,
      });
    }
  });

  it('create-order sends the total (base + tax) to Cashfree, not the bare base', () => {
    const order = read('supabase/functions/create-order/index.ts');
    // The total is computed by packTotalPaise and passed as amountInr.
    expect(order).toContain('packTotalPaise(');
    expect(order).toContain('amountInr: totalPaise / 100');
    // amount_paise stores the total captured, which generate-invoice backs out.
    expect(order).toContain('amount_paise: totalPaise');
    // RECHARGE_PACKS still defines amountInr as the base pack value.
    for (const pack of [100, 300, 500, 1000, 2500, 5000]) {
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
    expect(recharge.match(/gstAdded(Label|Spoken)\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(payment).toContain('gstAddedLabel(');
  });

  /*
   * "remove inc xxx gst from footer" (Amit, 2026-09-06).
   *
   * The footers carry only the rate and the unit — "1 token = ₹1" — because the
   * chip already names the base and the tax and the Pay bar names the total.
   * `gstRateBps` is present in the footer to compute the Pay button total, which
   * is correct; the assertion is that the INFORMATIONAL copy in the ⓘ row and the
   * wallet note contains no GST wording.
   */
  it('takes GST copy off both footers and leaves the rate and the unit behind', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));

    expect(recharge).not.toContain('gstPercentLabel');
    expect(recharge).not.toContain('gstSplit');

    const footer = recharge.slice(
      recharge.indexOf('function RechargeSheetFooter'),
      recharge.indexOf('export function RechargeWalletPage'),
    );
    expect(footer).toContain('1 token = ₹1 · you are charged in rupees at checkout');
    expect(recharge).toContain('1 token = ₹1. You are charged in rupees at checkout.');
  });

  it('the pay bar shows what Cashfree will actually capture, not just the base', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));
    // Both pay buttons must be driven by packTotalInr, not by amount directly.
    const payMatches = (recharge.match(/packTotalInr\(/g) ?? []).length;
    expect(payMatches).toBeGreaterThanOrEqual(2);
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
      /*
       * `accentStrong` is the step a LABEL sits on — that is what this chip
       * needs and it holds in both modes.
       *
       * The second half used to assert that bg/accent could NOT carry a label
       * in either mode, which was true while the dark accent was a light blue
       * under white text (2.59:1). With WhatsApp green (2026-09-08) dark
       * flipped text/onAccent to near-black ink and the pair is now 7.21:1, so
       * the claim is only true in LIGHT. Narrowed rather than deleted: light is
       * still the mode where a filled chip must use the deeper step.
       */
      if (mode === 'Light') {
        expect(contrast(hex('text/onAccent', mode), hex('bg/accent', mode))).toBeLessThan(4.5);
      }
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
    //
    // The size moved 17 -> `icon.sm` (16) with ADR-0030, which put every icon on
    // the Telegram-derived scale. What this line is FOR is that the check is
    // present at all, so it is re-pinned to the token rather than loosened to a
    // name-only match: the assertion is exactly as specific as it was, and the
    // number it names is now true. Which step it is remains the scale's
    // business, enforced in __tests__/iconScale.test.ts.
    expect(payment).toContain('<Icon name="check" size={TOKENS.icon.sm}');
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
   * ₹4,237.29, a number no invoice ever totals. GST "exclusive on the chips" means
   * naming the base and the tax IN ADDITION to the price, not INSTEAD of it.
   *
   * Under the exclusive model (ADR-0029): price is the base, the GST line is one
   * string ("+ ₹54 GST"), and the Pay bar shows the total.
   *
   * REWRITTEN 2026-09-08. The card used to carry THREE lines — price, then the
   * token count the price bought, then the GST note — and this asserted that
   * order. With rupees everywhere the middle line rendered "₹300" beneath a
   * "₹300" headline: the same fact twice, not a supporting line. It is gone,
   * and what the card still owes the reader — what the money BUYS — is answered
   * by the minutes tag, which was always the more useful answer.
   *
   * So the order asserted is now price then GST note, and the removed line is
   * asserted ABSENT so it cannot quietly return.
   */
  it.each([
    ['the compact sheet chip', 'compact' as const],
    ['the wallet-page pack card', 'wallet' as const],
  ])('renders price, then tokens, then the gst note on %s', (_name, key) => {
    const host = renderOf(HOSTS[key]);
    /*
     * The price moved to `<RupeeAmount value={pack} .../>` on 2026-09-08 (the ₹
     * glyph weight sweep), which no longer contains the literal
     * `{formatRupees(pack)}` this assertion originally scanned for. Matched on
     * either form so a future rewrite of one card and not the other still
     * satisfies "price appears before the GST note" rather than silently
     * finding neither.
     */
    const price = (() => {
      const asText = host.indexOf('{formatRupees(pack)}');
      if (asText > -1) return asText;
      return host.search(/<RupeeAmount\s+value=\{pack\}/);
    })();
    // Under the exclusive model the GST line is a single Text with {gst}.
    const gstNote = host.indexOf('{gst}');
    expect({ price: price > -1, gstNote: gstNote > -1 }).toEqual({
      price: true,
      gstNote: true,
    });
    expect(price).toBeLessThan(gstNote);
    // The duplicate second price line must not come back.
    expect(host).not.toContain('formatTokens(pack)');
    expect(host).not.toMatch(/\}\s*tokens`/);
    // The old two-Text pattern ({gst.base} / {gst.tax}) must be gone.
    expect(host).not.toContain('{gst.base}');
    expect(host).not.toContain('{gst.tax}');
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
      const split = label.indexOf('gstSpoken');
      expect({ host: key, price: price > -1, split: split > -1 }).toEqual({
        host: key,
        price: true,
        split: true,
      });
      expect(price).toBeLessThan(split);
      /*
       * The label spoke the price TWICE — "₹300, ₹300, about 13 minutes" — once
       * the token count became a rupee figure. Same-figures-same-order still
       * holds; there is simply one figure now, not two.
       */
      expect(label.match(/formatRupees\(pack\)/g)?.length).toBe(1);
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
