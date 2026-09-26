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

    // The wallet page still itemises GST on its chips (label + spoken = two call
    // sites); the compact chat-refill sheet no longer does (2026-09-10), so the
    // count dropped from four. The pay step still names the total.
    expect(recharge.match(/gstAdded(Label|Spoken)\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(payment).toContain('gstAddedLabel(');
  });

  /*
   * "remove inc xxx gst from footer" (Amit, 2026-09-06).
   *
   * `gstRateBps` is present in the footer to compute the Pay button total, which
   * is correct; the assertion is that the INFORMATIONAL copy in the ⓘ row and the
   * wallet note contains no GST wording.
   */
  it('takes GST copy off both footers, and the rate line is gone from both', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));

    expect(recharge).not.toContain('gstPercentLabel');
    expect(recharge).not.toContain('gstSplit');

    /*
     * THE RATE LINE IS NOW GONE FROM BOTH SURFACES, and this assertion inverted
     * with it.
     *
     * It fell in two steps. The SHEET lost it on 2026-09-12 ("recharge modal
     * should just Pay without amount and remove 1 token = 1 rs") and this test
     * then pinned its survival on the full page, on the argument that somebody
     * who wants the arithmetic goes there and the page has the room. The PAGE
     * lost it on 2026-09-17 ("remove 1 rs = 1 token in recharge screen .. token
     * is nowhere to be mentioned ever at all please in app"), which is a
     * different argument and a stronger one: the first was about layout room,
     * the second retires the word. A member buys talk time in rupees and is
     * charged in rupees, so a line that names a second unit purely to equate it
     * to the first is inventing a currency in order to un-invent it.
     *
     * Still not a dropped disclosure, which is what this test exists to protect:
     * ADR-0021 requires the tax to be derivable and INVOICED. Every pack chip
     * names its own base and its own tax, PaymentSheet names the total again
     * before money moves, and Axionix issues the invoice. Nothing that was ever
     * load-bearing left with the line.
     */
    expect(recharge).not.toContain('1 token = ₹1');
    // Absence of the sentence is asserted on the FULL file, not a slice: the
    // predecessor sliced to the sheet's footer, which meant it could only ever
    // have caught the line in one of the two places it lived.
    expect(recharge).not.toMatch(/charged in rupees at checkout/);
  });

  it('the pay bar shows what Cashfree will actually capture — the discounted total', () => {
    const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));
    /*
     * Both pay controls quote `discountedTotalInr`, not the bare base and not the
     * undiscounted `packTotalInr` (2026-09-13, first-recharge discount made
     * visible). It collapses to the full total when the member is owed no
     * discount and to the half they pay when they are, and it is the same figure
     * PaymentSheet passes to the checkout as `expectedTotalInr` — so the button,
     * the sheet and the amount Cashfree captures cannot disagree.
     *
     * The sheet's button READS just "Pay"; its accessibilityLabel carries the
     * figure, so a screen-reader user is told the price a sighted user reads off
     * the chip. `packTotalInr` still appears once — as the struck-through
     * ORIGINAL in the chip's discount price line — so it is not asserted absent.
     */
    const payMatches = (recharge.match(/discountedTotalInr\(/g) ?? []).length;
    expect(payMatches).toBeGreaterThanOrEqual(2);
    const footer = recharge.slice(
      recharge.indexOf('function RechargeSheetFooter'),
      recharge.indexOf('export function RechargeWalletPage'),
    );
    expect(footer).toContain('accessibilityLabel={`Pay ${formatRupees(discountedTotalInr(');
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
    for (const style of ['amountOn', 'tokensOn', 'cardAmountOn', 'cardUnitOn']) {
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
       *
       * Deleted 2026-09-26, and replaced with its opposite: there is one coral
       * now, ramp step 500 under both names, so bg/accent carries this chip's
       * labels at 5.27:1 in both modes (walletTone.test.ts pins the two equal).
       */
      expect(contrast(hex('text/onAccent', mode), hex('bg/accent', mode))).toBeGreaterThanOrEqual(4.5);
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
    // the reference-derived scale. What this line is FOR is that the check is
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
  // The price moved to `<RupeeAmount value={pack} .../>` on 2026-09-08 (the ₹
  // glyph weight sweep), so match either form.
  const priceIndex = (host: string): number => {
    const asText = host.indexOf('{formatRupees(pack)}');
    if (asText > -1) return asText;
    return host.search(/<RupeeAmount\s+value=\{pack\}/);
  };

  it('the wallet-page pack card renders the price, then the gst note', () => {
    const host = renderOf(HOSTS.wallet);
    const price = priceIndex(host);
    const gstNote = host.indexOf('{gst}');
    expect({ price: price > -1, gstNote: gstNote > -1 }).toEqual({ price: true, gstNote: true });
    expect(price).toBeLessThan(gstNote);
    // The duplicate second price line must not come back.
    expect(host).not.toContain('formatTokens(pack)');
    expect(host).not.toMatch(/\}\s*tokens`/);
    // The old two-Text pattern ({gst.base} / {gst.tax}) must be gone.
    expect(host).not.toContain('{gst.base}');
    expect(host).not.toContain('{gst.tax}');
  });

  it('the compact chat-sheet chip shows the price but NO per-chip GST — the highest-intent buy', () => {
    /*
     * The GST breakout moved OFF the chat refill chip (Amit, 2026-09-10): it is
     * the highest-intent buying moment and a "+ ₹54 GST" line on every card
     * discourages the recharge. The tax is not hidden — the Pay bar shows the
     * GST-inclusive total (packTotalInr) and Cashfree charges it, so the all-in
     * price is disclosed at the point of payment. The wallet page keeps its
     * itemisation (asserted above).
     */
    const host = renderOf(HOSTS.compact);
    expect(priceIndex(host)).toBeGreaterThan(-1);
    expect(host).not.toContain('{gst}');
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
    // The wallet card speaks the price, then its talk-time pill, then the GST split.
    const wallet = labelLine(HOSTS.wallet);
    const walletPrice = wallet.indexOf('formatRupees(pack)');
    const walletSplit = wallet.indexOf('gstSpoken');
    expect({ price: walletPrice > -1, split: walletSplit > -1 }).toEqual({ price: true, split: true });
    expect(walletPrice).toBeLessThan(walletSplit);
    expect(wallet.match(/formatRupees\(pack\)/g)?.length).toBe(1);
    expect(wallet.indexOf('minutes of talk')).toBeGreaterThan(wallet.indexOf('formatTokens(pack)'));
    expect(wallet.indexOf('minutes of talk')).toBeLessThan(walletSplit);

    // The compact chat-sheet chip speaks only the price — no GST split, matching
    // its rendered card (the GST breakout moved off it, 2026-09-10).
    const compact = labelLine(HOSTS.compact);
    expect(compact.indexOf('formatRupees(pack)')).toBeGreaterThan(-1);
    expect(compact).not.toContain('gstSpoken');
    expect(compact.match(/formatRupees\(pack\)/g)?.length).toBe(1);
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

/**
 * The first-recharge discount, made visible (2026-09-13).
 *
 * Before this, migration 102 discounted the CHARGE server-side while the screen
 * drew the full price and PaymentSheet passed no `expectedTotalInr` — so the
 * member was silently charged half, and `assertQuotedAmount` (the guard that
 * exists because a tester was once shown ₹300 and charged ₹354) was switched off
 * on the real pay path. These gates keep both halves fixed: the price is shown,
 * and the guard is fed.
 */
describe('the first-recharge discount is shown, and the price guard is fed', () => {
  const recharge = withoutComments(read('src/screens/RechargeScreen.tsx'));
  const payment = withoutComments(read('src/screens/PaymentSheet.tsx'));

  it('feeds PaymentSheet the discounted total to the checkout as expectedTotalInr', () => {
    // The actual defect: the gateway was opened with no quoted amount, so
    // assertQuotedAmount returned early and never compared. If this ever drops
    // again the guard is dead and a server/client price disagreement becomes a
    // surprise charge instead of an error.
    expect(payment).toContain('expectedTotalInr: total');
    // `total` is the discounted figure, not the bare pack total.
    expect(payment).toContain('discountedTotalInr(amount, gstRateBps, discountBps)');
    // And the pending read is guarded, so a cold open cannot quote the full
    // price against a server about to grant the half.
    expect(payment).toContain('if (discountPending) return;');
  });

  it('names GST on the DISCOUNTED base in the sheet, not the full base', () => {
    // The tax the member pays is on ₹150, not ₹300 (create-order discounts the
    // taxable value, ADR-0029). gstAddedLabel must read the discounted base.
    expect(payment).toContain('gstAddedLabel(discountedBaseInr, gstRateBps)');
  });

  it('leaves the balance headline unstruck — only the price line carries the strike', () => {
    // The chip's big figure is the balance the member ADDS and it does not halve
    // (create-order credits the full pack). Striking it would misstate what the
    // member receives. The strikethrough lives on priceWas / totalWas only.
    for (const style of ['amount', 'cardAmount', 'balanceValue']) {
      expect(styleBlock(recharge, style)).not.toContain('line-through');
    }
    expect(styleBlock(recharge, 'priceWas')).toContain("textDecorationLine: 'line-through'");
    expect(styleBlock(payment, 'totalWas')).toContain("textDecorationLine: 'line-through'");
  });

  it('derives the banner percent from the granted bps, never a hardcoded 50', () => {
    // An admin who sets the offer to 4000 bps must get "40% off" with no code
    // change. A literal "50%" would lie the moment the grant changes.
    expect(recharge).toContain('Math.round(discountBps / 100)');
    expect(recharge).toContain('% off your first recharge');
    expect(recharge).not.toMatch(/50% off/);
  });

  it('shows the discount price line on both grids, gated on the offer', () => {
    // Both hosts render ChipDiscountPrice; it returns null when discountBps <= 0,
    // so a member owed no discount sees the chip exactly as before.
    expect((recharge.match(/<ChipDiscountPrice/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(recharge).toContain('if (discountBps <= 0) return null;');
  });
});
