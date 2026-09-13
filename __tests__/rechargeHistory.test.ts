import { readFileSync } from 'fs';
import { join } from 'path';
import type { TokenTransaction } from '../src/api/transactions';

/**
 * The recharge ledger shows settled money only.
 *
 * `token_transactions.status` is the Cashfree payment lifecycle, not a display
 * detail. A row is inserted `created` when create-order mints the order;
 * `credit_purchased_recharge` (migration 033) is the only thing that moves it to
 * `succeeded`; cashfree-webhook writes `failed` on PAYMENT_FAILED_WEBHOOK and
 * PAYMENT_USER_DROPPED_WEBHOOK. So a `created` row is a payment still in flight
 * or abandoned at the gateway, and a `failed` row is a declined one — in both
 * cases no money left the member and no token was credited.
 *
 * A row on this screen renders an amount in ₹ over a credited ₹ line. Showing
 * either of those states tells a member they were charged for something they
 * were not, which is the defect this file gates. It is worth a test rather than
 * a comment for two reasons: an abandoned checkout is the SINGLE most likely row
 * a real wallet accumulates (every back-press out of the Cashfree sheet leaves
 * one), and the wrong version is invisible until a tester actually abandons a
 * payment and then opens Settings.
 *
 * `refunded` is asserted IN, deliberately. See the sibling case below.
 *
 * The filter is pure and exported, so it is executed here. The JSX around it
 * cannot be — this repo has no renderer in devDependencies — so the WIRING is
 * checked as source text, against a comment-stripped copy for the usual reason:
 * the prose explaining the rule necessarily contains the very strings the
 * `not.toContain` assertions look for.
 */

/*
 * Loading the screen means loading the theme, which means loading Reanimated,
 * which needs a native runtime this test has no business standing up. Same
 * self-completing stub as usageLedger.test.ts: nothing below asserts anything
 * about animation, and a named-export list would break the moment an unrelated
 * Reanimated import arrives in the theme.
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

/** The theme reads a stored light/dark preference; there is no MMKV here. */
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

/*
 * Imported after the mocks for readability only — babel-plugin-jest-hoist lifts
 * every `jest.mock` above the requires regardless.
 */
import { settledTransactions } from '../src/screens/TransactionHistoryScreen';

const ROOT = join(__dirname, '..');

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREEN = withoutComments(
  readFileSync(join(ROOT, 'src/screens/TransactionHistoryScreen.tsx'), 'utf8'),
);

/** A ₹300 recharge, overridable field by field. */
const tx = (over: Partial<TokenTransaction> = {}): TokenTransaction => ({
  id: 'tx-1',
  kind: 'recharge',
  status: 'succeeded',
  amountPaise: 35400,
  tokensDelta: 300,
  gateway: 'cashfree',
  createdAt: '2026-09-10T10:00:00.000Z',
  invoice: null,
  ...over,
});

describe('settledTransactions: only money that actually moved', () => {
  it('drops a payment the member abandoned at the gateway', () => {
    /*
     * `created` is the insert state. It stays `created` forever if the member
     * back-presses out of the Cashfree sheet and no webhook ever arrives, so
     * this is not a transient the screen can ignore — it is a permanent row.
     */
    const rows = settledTransactions([
      tx({ id: 'pending', status: 'created' }),
      tx({ id: 'paid', status: 'succeeded' }),
    ]);
    expect(rows.map(r => r.id)).toEqual(['paid']);
  });

  it('drops a declined payment', () => {
    const rows = settledTransactions([
      tx({ id: 'declined', status: 'failed' }),
      tx({ id: 'paid', status: 'succeeded' }),
    ]);
    expect(rows.map(r => r.id)).toEqual(['paid']);
  });

  it('shows nothing at all when every recharge failed or is pending', () => {
    /*
     * The case that decides between the empty state and a hairline over a blank
     * gap. A wallet with one abandoned checkout and nothing else must come back
     * EMPTY, not "one row I chose not to draw".
     */
    expect(
      settledTransactions([
        tx({ id: 'a', status: 'created' }),
        tx({ id: 'b', status: 'failed' }),
      ]),
    ).toEqual([]);
  });

  it('keeps a refunded recharge, because that money did move', () => {
    /*
     * `refunded` is neither failed nor pending: it is a recharge that succeeded
     * and was later reversed. It is also the only non-`succeeded` status that
     * can carry a GST tax invoice — migration 046 raises the invoice on
     * `new.status = 'succeeded' and new.kind = 'recharge'`, and 019's numbering
     * is gapless precisely because a gap invites a scrutiny notice. Filtering it
     * out would take away a document the member is entitled to download, so
     * "only successful" must not be read as "status === succeeded".
     */
    const rows = settledTransactions([
      tx({
        id: 'reversed',
        status: 'refunded',
        invoice: {
          id: 'inv-1',
          invoiceNumber: 'PPL/2026-27/000001',
          documentType: 'tax_invoice',
          pdfPath: 'u/inv-1.pdf',
        },
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.invoice?.pdfPath).toBe('u/inv-1.pdf');
  });

  it('judges a row by its status, not its kind', () => {
    /*
     * The screen lists three kinds (recharge / refund / adjustment — the `.in()`
     * in useTransactions). The status rule applies to all of them: a refund line
     * that never settled is as misleading as a recharge that never settled, and
     * a manual adjustment defaults to `succeeded` (migration 019) so it stays.
     */
    const rows = settledTransactions([
      tx({ id: 'r', kind: 'refund', status: 'succeeded', tokensDelta: -300 }),
      tx({ id: 'r-pending', kind: 'refund', status: 'created' }),
      tx({ id: 'adj', kind: 'adjustment', status: 'succeeded', amountPaise: 0 }),
      tx({ id: 'adj-failed', kind: 'adjustment', status: 'failed' }),
    ]);
    expect(rows.map(r => r.id)).toEqual(['r', 'adj']);
  });

  it('preserves the newest-first order it was given', () => {
    // The server orders by created_at desc; filtering must not re-sort.
    const rows = settledTransactions([
      tx({ id: 'sep-10', createdAt: '2026-09-10T10:00:00.000Z' }),
      tx({ id: 'sep-08', status: 'failed', createdAt: '2026-09-08T10:00:00.000Z' }),
      tx({ id: 'sep-01', createdAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(rows.map(r => r.id)).toEqual(['sep-10', 'sep-01']);
  });

  it('treats an unloaded list as empty rather than throwing', () => {
    // react-query hands back `undefined` before the first fetch resolves.
    expect(settledTransactions(undefined)).toEqual([]);
  });
});

describe('the screen renders the filtered rows, not the raw query', () => {
  it('draws the list from the filter', () => {
    expect(SCREEN).toContain('useMemo(() => settledTransactions(data), [data])');
    expect(SCREEN).toContain('rows.map((tx, index)');
    // The unfiltered list must not reach the list body by any route.
    expect(SCREEN).not.toContain('data.map(');
  });

  it('chooses the empty state from the filtered count', () => {
    /*
     * The whole point of filtering before the branch. `!data || data.length ===
     * 0` counts rows the screen has already decided not to draw, so a member
     * whose only checkout was abandoned would get the section hairline and a
     * blank gap where "No recharges yet" belongs.
     */
    expect(SCREEN).toContain('rows.length === 0 ? (');
    expect(SCREEN).not.toContain('data.length === 0');
  });
});
