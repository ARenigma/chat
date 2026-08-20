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

describe('applyDebit — parity with public.deduct_user_token', () => {
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
