import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DAILY_REFILL_TOKENS,
  LOW_BALANCE_THRESHOLD,
  MESSAGE_COST,
  applyCredit,
  applyDebit,
  canSend,
  isLowBalance,
} from '../src/lib/tokenLedger';
import fixture from '../supabase/tests/ledger_cases.json';

describe('applyDebit, parity with public.deduct_user_token', () => {
  for (const c of fixture.cases) {
    it(`${c.name}: ${c.current} - ${c.cost} -> ${c.success ? c.newBalance : 'rejected'}`, () => {
      const result = applyDebit(c.current, c.cost);
      expect(result.success).toBe(c.success);
      if (result.success) {
        expect(result.newBalance).toBe(c.newBalance);
      } else {
        expect(result.error).toBe('INSUFFICIENT_BALANCE');
      }
    });
  }

  it('treats a missing profile the same as an underfunded one', () => {
    expect(applyDebit(null)).toEqual({ success: false, error: 'INSUFFICIENT_BALANCE' });
  });

  it('defaults to the one-message-one-token cost', () => {
    expect(MESSAGE_COST).toBe(1);
    expect(applyDebit(10)).toEqual({ success: true, newBalance: 9 });
  });

  it('never returns a negative balance on the success path', () => {
    for (let balance = 0; balance <= 20; balance += 1) {
      const result = applyDebit(balance);
      if (result.success) {
        expect(result.newBalance).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('applyCredit', () => {
  it('refunds onto an existing balance', () => {
    expect(applyCredit(7, MESSAGE_COST)).toBe(8);
  });

  it('treats a missing balance as zero rather than throwing', () => {
    expect(applyCredit(null, DAILY_REFILL_TOKENS)).toBe(DAILY_REFILL_TOKENS);
  });

  it('round-trips a debit', () => {
    const debited = applyDebit(3);
    expect(debited.success).toBe(true);
    if (debited.success) {
      expect(applyCredit(debited.newBalance, MESSAGE_COST)).toBe(3);
    }
  });
});

describe('balance predicates', () => {
  it('flags low only strictly below the threshold', () => {
    expect(isLowBalance(LOW_BALANCE_THRESHOLD)).toBe(false);
    expect(isLowBalance(LOW_BALANCE_THRESHOLD - 1)).toBe(true);
    expect(isLowBalance(0)).toBe(true);
  });

  it('does not flag an unknown balance as low', () => {
    expect(isLowBalance(null)).toBe(false);
  });

  it('blocks sending only at zero', () => {
    expect(canSend(1)).toBe(true);
    expect(canSend(0)).toBe(false);
    expect(canSend(null)).toBe(false);
  });
});

/**
 * The first recharge is half price, and there are three copies of that sum.
 *
 * `supabase/functions/create-order/index.ts` computes the amount the member is
 * CHARGED. `src/api/billing.ts` computes the amount the member is SHOWN.
 * `supabase/functions/generate-invoice/index.ts` backs the tax out of the
 * charged figure for the tax invoice. If any two of those three disagree by a
 * single paisa the member is either lied to on screen or issued a document that
 * does not describe what they paid — and this repo already has a runbook
 * (docs/runbooks/create-order-deploy.md) written because exactly that happened
 * with GST: ₹300 displayed, ₹354 charged.
 *
 * So the sum is asserted twice over. Once as arithmetic, against a reference
 * written here rather than imported — `src/api/billing.ts` cannot be loaded
 * under jest at all (the Cashfree SDK's commonjs bundle fails to resolve its own
 * package.json), so an import would not be a stricter test, it would be no test.
 * And once as TEXT, by lifting the two implementations out of their files and
 * comparing them character for character, which is what actually catches the
 * failure this is here for: somebody changing one side's rounding and not the
 * other's.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The reference. Integer paise, discount off the TAXABLE value, then tax. */
function referenceTotalPaise(
  baseInr: number,
  gstRateBps: number,
  discountBps: number,
): number {
  const full = Math.round(baseInr * 100);
  const base =
    discountBps <= 0 || full <= 0 ? full : full - Math.round((full * discountBps) / 10000);
  if (gstRateBps <= 0 || base <= 0) return base;
  return base + Math.round((base * gstRateBps) / 10000);
}

/** What generate-invoice does with the figure, verbatim (its lines 19-20). */
const backOutTaxablePaise = (totalPaise: number, rateBps: number) =>
  Math.round((totalPaise * 10000) / (10000 + rateBps));

/** Body of a named single-expression-style function, comments and blanks gone. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return source
    .slice(open + 1, end)
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, '').trim())
    .filter(l => l.length > 0)
    .join('\n');
}

const PACKS = [100, 300, 500, 1000, 2500, 5000];

describe('first-recharge discount arithmetic', () => {
  it('halves the ₹300 pack to ₹177 at 18% GST, not ₹354 and not ₹150', () => {
    // The number a member actually sees: half of ₹300 is ₹150 of tokens, ₹27 of
    // tax on ₹150, ₹177 to pay. Not ₹177 of tokens, and not ₹150 to pay.
    expect(referenceTotalPaise(300, 1800, 5000)).toBe(17700);
    expect(referenceTotalPaise(300, 1800, 0)).toBe(35400);
  });

  it('leaves the undiscounted price exactly where ADR-0029 put it', () => {
    // 0 bps must be byte-identical to the pre-discount behaviour, or shipping
    // the offer silently re-prices every member who is not eligible for it.
    for (const pack of PACKS) {
      expect(referenceTotalPaise(pack, 1800, 0)).toBe(Math.round(pack * 100 * 1.18));
    }
  });

  it('keeps the invoice reversible: taxable + tax == the amount charged', () => {
    // generate-invoice never sees the discount. It backs the tax out of
    // amount_paise, so the ONLY way the tax invoice can state the discounted
    // taxable value is if the discount was applied before the tax rather than
    // after it. This is the assertion that pins that ordering.
    for (const pack of PACKS) {
      for (const discount of [0, 5000]) {
        const total = referenceTotalPaise(pack, 1800, discount);
        const taxable = backOutTaxablePaise(total, 1800);
        const expectedTaxable =
          discount === 0 ? pack * 100 : pack * 100 - Math.round((pack * 100 * discount) / 10000);
        expect(taxable).toBe(expectedTaxable);
        expect(taxable + (total - taxable)).toBe(total);
      }
    }
  });

  it('survives a rate that does not divide evenly', () => {
    // 3333 bps on ₹300: 30000 - 9999 = 20001 taxable, 3600 tax, 23601 charged,
    // and the back-out still lands on 20001. A discount that produced an odd
    // paisa the invoice could not reproduce would be a compliance defect, not a
    // rounding nit.
    const total = referenceTotalPaise(300, 1800, 3333);
    expect(total).toBe(23601);
    expect(backOutTaxablePaise(total, 1800)).toBe(20001);
  });

  it('charges nothing extra when GST is switched off', () => {
    expect(referenceTotalPaise(300, 0, 5000)).toBe(15000);
  });
});

describe('the price on screen is the price at the gateway', () => {
  const client = read('src/api/billing.ts');
  const server = read('supabase/functions/create-order/index.ts');

  it('computes the discounted base identically on both sides', () => {
    expect(functionBody(client, 'discountedBasePaise')).toBe(
      functionBody(server, 'discountedBasePaise'),
    );
  });

  it('computes the charged total identically on both sides', () => {
    // The server names its GST parameter `rateBps` and the client `gstRateBps`
    // — the only licensed difference, normalised here. Everything else must
    // match, including the rounding and the order of operations.
    const clientBody = functionBody(client, 'discountedTotalPaise');
    const serverBody = functionBody(server, 'packTotalPaise').replace(/\brateBps\b/g, 'gstRateBps');
    expect(clientBody).toBe(serverBody);
  });

  it('refuses to open the gateway when the server quotes a different amount', () => {
    // The guard itself, asserted as wiring: create-order returns the amount it
    // created the order for, and useCashfreeCheckout compares it against what
    // the member was shown BEFORE any payment surface exists. Without this call
    // the first-recharge discount adds a second way for display and charge to
    // diverge, on top of the GST one that already cost a rebuild.
    expect(client).toContain('assertQuotedAmount(order, expectedTotalInr)');
    expect(server).toContain('baseInr: pack.amountInr');
    expect(server).toContain('discountBps,');
  });

  it('never lets the client be the authority on eligibility', () => {
    // my_first_recharge_discount_bps is a DISPLAY read. The grant is
    // claim_first_recharge_discount, and it is called by the server only — if
    // that RPC is ever reachable from the bundle, the discount has become
    // something a patched APK can award itself.
    //
    // Matched against a comment-stripped copy, the same way PaymentSheet's type
    // gate does it: the prose explaining why the client must not call the RPC
    // necessarily contains the RPC's name, and a naive `not.toContain` would
    // fail on its own documentation.
    const code = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(server).toContain('claim_first_recharge_discount');
    expect(code).not.toContain('claim_first_recharge_discount');
    expect(code).toContain('my_first_recharge_discount_bps');
  });
});
