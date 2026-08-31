import {
  CRITICAL_TALK_MINUTES,
  DEFAULT_RATES,
  HEALTHY_TALK_MINUTES,
  LOW_BALANCE_TOKENS,
  isLowBalance,
  talkMinutesLeft,
  walletTone,
} from '../src/lib/rates';

describe('walletTone (talk-time colours)', () => {
  const rate = DEFAULT_RATES.chat;

  it('is healthy at or above one hour of talk', () => {
    expect(walletTone(HEALTHY_TALK_MINUTES * rate, rate)).toBe('healthy');
    expect(walletTone(HEALTHY_TALK_MINUTES * rate + 1, rate)).toBe('healthy');
  });

  it('is critical under ten minutes of talk', () => {
    expect(walletTone(CRITICAL_TALK_MINUTES * rate - 1, rate)).toBe('critical');
    expect(walletTone(0, rate)).toBe('critical');
  });

  it('is ok (lime) between the thresholds, including exactly ten minutes', () => {
    expect(walletTone(CRITICAL_TALK_MINUTES * rate, rate)).toBe('ok');
    expect(walletTone(30 * rate, rate)).toBe('ok');
  });

  it('treats a null balance as ok rather than critical', () => {
    expect(walletTone(null)).toBe('ok');
    expect(isLowBalance(null)).toBe(false);
  });

  it('keeps LOW_BALANCE_TOKENS aligned with the critical minute floor', () => {
    expect(LOW_BALANCE_TOKENS).toBe(CRITICAL_TALK_MINUTES * rate);
    expect(isLowBalance(LOW_BALANCE_TOKENS)).toBe(false);
    expect(isLowBalance(LOW_BALANCE_TOKENS - 1)).toBe(true);
  });

  it('derives minutes from balance ÷ rate', () => {
    expect(talkMinutesLeft(220, 22)).toBe(10);
    expect(talkMinutesLeft(null)).toBe(0);
  });
});
