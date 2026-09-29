import { readFileSync } from 'fs';
import { join } from 'path';
import type { TokenTransaction } from '../src/api/transactions';

/**
 * Amit 2026-09-29: every transaction attempt is its own line item.
 *
 * The OLD rule (SETTLED_STATUSES) filtered to `succeeded` and `refunded` only,
 * hiding `created` (pending/abandoned) and `failed` rows. That left members
 * unable to see why a payment did not clear.
 *
 * The NEW rule: show every attempt. The query already returns all statuses and
 * RLS scopes rows to the signed-in user, so `allTransactions` is a passthrough
 * — its value is to be a stable export the tests can pin and future editors can
 * see documented.
 *
 * A filter-chip row on the screen lets members narrow to a single status after
 * the full list is visible; that chip row is tested as wiring below.
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

import { allTransactions } from '../src/screens/TransactionHistoryScreen';

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

describe('allTransactions: every status is a line item', () => {
  it('includes a payment the member abandoned at the gateway', () => {
    /*
     * `created` is the insert state. Under the old rule it was hidden. Under
     * the new rule it is its own row so the member can see the payment is
     * still in flight or was abandoned.
     */
    const rows = allTransactions([
      tx({ id: 'pending', status: 'created' }),
      tx({ id: 'paid', status: 'succeeded' }),
    ]);
    expect(rows.map((r: TokenTransaction) => r.id)).toEqual(['pending', 'paid']);
  });

  it('includes a declined payment', () => {
    /*
     * `failed` was hidden under the old rule. It is now shown so the member
     * knows the payment was declined.
     */
    const rows = allTransactions([
      tx({ id: 'declined', status: 'failed' }),
      tx({ id: 'paid', status: 'succeeded' }),
    ]);
    expect(rows.map((r: TokenTransaction) => r.id)).toEqual(['declined', 'paid']);
  });

  it('shows all four statuses when present', () => {
    /*
     * The complete lifecycle: an in-flight attempt, a success, a failure, and
     * a reversal — all four appear without filtering.
     */
    const rows = allTransactions([
      tx({ id: 'a', status: 'created' }),
      tx({ id: 'b', status: 'succeeded' }),
      tx({ id: 'c', status: 'failed' }),
      tx({ id: 'd', status: 'refunded' }),
    ]);
    expect(rows.map((r: TokenTransaction) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a refunded recharge, because that money did move', () => {
    /*
     * `refunded` was already shown under the old rule and stays shown. It is
     * the only non-`succeeded` status that can carry a GST tax invoice, and
     * hiding it would remove a document the member is entitled to download.
     */
    const rows = allTransactions([
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

  it('preserves the newest-first order it was given', () => {
    const rows = allTransactions([
      tx({ id: 'sep-10', createdAt: '2026-09-10T10:00:00.000Z' }),
      tx({ id: 'sep-08', status: 'failed', createdAt: '2026-09-08T10:00:00.000Z' }),
      tx({ id: 'sep-01', createdAt: '2026-09-01T10:00:00.000Z' }),
    ]);
    expect(rows.map((r: TokenTransaction) => r.id)).toEqual(['sep-10', 'sep-08', 'sep-01']);
  });

  it('treats an unloaded list as empty rather than throwing', () => {
    expect(allTransactions(undefined)).toEqual([]);
  });
});

describe('the screen shows all statuses and filters client-side', () => {
  it('draws the list from allTransactions, not a status filter', () => {
    expect(SCREEN).toContain('useMemo(() => allTransactions(data), [data])');
    // The old SETTLED_STATUSES constant must not exist in this file any more.
    expect(SCREEN).not.toContain('SETTLED_STATUSES');
    expect(SCREEN).not.toContain('settledTransactions');
  });

  it('chooses the empty state from the full row count, not the filtered count', () => {
    /*
     * The full list empty state ("No recharges yet") branches on `rows.length
     * === 0` — the unfiltered list. The filter-chip empty state ("No failed
     * payments") is shown by SectionList's ListEmptyComponent when the
     * filtered sections have no rows.
     */
    expect(SCREEN).toContain('rows.length === 0 ? (');
  });

  it('has a filter chip row for statuses present in the list', () => {
    /*
     * Chips: All / Paid / Pending / Failed / Refunded. Only statuses actually
     * present in the query result get a chip. "All" is always shown.
     */
    expect(SCREEN).toContain('FilterChip');
    expect(SCREEN).toContain('visibleFilters');
    expect(SCREEN).toContain("'All'");
  });

  it('shows a status word on each row with the correct colour token', () => {
    /*
     * Paid → text/available (green), Pending → text/warning (amber),
     * Failed → state/danger (garnet), Refunded → text/secondary (neutral).
     */
    expect(SCREEN).toContain('statusPaid');
    expect(SCREEN).toContain('statusPending');
    expect(SCREEN).toContain('statusFailed');
    expect(SCREEN).toContain('statusRefunded');
    // Colours come from tokens, never from raw hex strings.
    expect(SCREEN).toContain('text.available');
    expect(SCREEN).toContain('text.warning');
    expect(SCREEN).toContain('state.danger');
  });

  it('uses a filled wallet glyph with no circle container', () => {
    /*
     * Each row has a leading wallet-fill icon (active prop), not a wallet
     * inside a 36dp circle.
     */
    expect(SCREEN).toContain('name="wallet" active');
    // No circle container in row styles.
    const rowStyles = SCREEN.slice(SCREEN.indexOf('makeStyles'));
    expect(rowStyles).not.toContain('bg.sunken');
    expect(rowStyles).not.toContain('borderRadius: 18');
  });

  it('groups rows into month sections', () => {
    expect(SCREEN).toContain('SectionList');
    expect(SCREEN).toContain('renderSectionHeader');
    expect(SCREEN).toContain('groupByMonth');
  });
});
