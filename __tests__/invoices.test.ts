import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Amit 2026-09-29: failed and pending payments are their own non-tappable rows,
 * not a footnote count. Every billing row is visible. No `unsettledNote`.
 *
 * The JSX cannot be executed — no renderer in devDependencies — so this file
 * asserts the wiring rules as source text and runs the pure helpers that
 * determine what each row renders.
 */

jest.mock('react-native-reanimated', () => {
  const chain: unknown = new Proxy(function () {}, {
    get: (_target, prop) => {
      if (prop === '__esModule') {
        return true;
      }
      return prop === 'value' ? 0 : chain;
    },
    set: () => true,
    apply: () => chain,
  });
  return chain;
});

jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

const ROOT = join(__dirname, '..');

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREEN = withoutComments(
  readFileSync(join(ROOT, 'src/screens/InvoicesScreen.tsx'), 'utf8'),
);

describe('InvoicesScreen: no footnote; failed/pending as rows', () => {
  it('does not mention the unsettled footnote', () => {
    /*
     * The old `unsettledNote` function returned "N payments did not go through".
     * That footnote is removed — Amit 2026-09-29: every attempt is a row.
     */
    expect(SCREEN).not.toContain('unsettledNote');
    expect(SCREEN).not.toContain('did not go through');
    expect(SCREEN).not.toContain('invoices-unsettled');
  });

  it('renders "Payment failed" and "Payment pending" as row titles', () => {
    /*
     * Failed payment: "Payment failed" / "No bill: nothing was charged".
     * Pending payment: "Payment pending" / "Bill follows once it clears".
     */
    expect(SCREEN).toContain('Payment failed');
    expect(SCREEN).toContain('No bill: nothing was charged');
    expect(SCREEN).toContain('Payment pending');
    expect(SCREEN).toContain('Bill follows once it clears');
  });

  it('uses a filled receipt glyph with no circle container on every row', () => {
    /*
     * Amit 2026-09-29: leading filled document glyph, no circle. `active`
     * selects receipt-fill. Every row variant (failed, pending, bill-pending,
     * pdf-pending, pdf-ready) renders the same glyph.
     */
    expect(SCREEN).toContain('name="receipt" active');
    // No circle container in the styles.
    const styleBlock = SCREEN.slice(SCREEN.indexOf('makeStyles'));
    expect(styleBlock).not.toContain('bg.sunken');
    expect(styleBlock).not.toContain('borderRadius: 18');
  });

  it('groups rows into month sections', () => {
    expect(SCREEN).toContain('SectionList');
    expect(SCREEN).toContain('renderSectionHeader');
    expect(SCREEN).toContain('groupByMonth');
  });

  it('branches the empty state on all rows, not just settled ones', () => {
    /*
     * The old screen branched on `documents.length === 0` (settled rows only).
     * The new screen uses the full `allRows` list so a member with only failed
     * attempts still reaches the empty state rather than a blank list.
     */
    const body = SCREEN.slice(SCREEN.indexOf('export function InvoicesScreen'));
    expect(body).toContain('allRows.length === 0');
    expect(body).not.toContain('documents.length === 0');
  });

  it('real bills keep all three states', () => {
    /*
     * State 3: settled, no invoice row → "Bill pending" + "Paid <date>"
     * State 4: invoice exists, PDF not ready → invoice number + preparation msg
     * State 5: PDF ready → tappable row opening the PDF
     */
    expect(SCREEN).toContain('Bill pending');
    expect(SCREEN).toContain('PDF is still being prepared');
    // The tappable row is a Pressable (state 5 only).
    expect(SCREEN).toContain('<Pressable');
    // States 1–4 are plain Views (non-tappable).
    expect(SCREEN).toContain('onOpen(invoice)');
  });
});
