import {
  COARSE_TICK_MS,
  COUNTDOWN_THRESHOLD_SECONDS,
  COUNTDOWN_TICK_MS,
  clockTickMs,
  estimatedTalkSeconds,
  formatClock,
  formatMinutes,
  secondsRemainingNow,
  showsCountdown,
} from '../src/lib/sessionClock';

describe('sessionClock: ages the server snapshot, never invents one', () => {
  const syncedAt = 1_700_000_000_000;

  it('ages the figure by whole seconds since the sync', () => {
    expect(secondsRemainingNow(818, syncedAt, syncedAt)).toBe(818);
    expect(secondsRemainingNow(818, syncedAt, syncedAt + 999)).toBe(818);
    expect(secondsRemainingNow(818, syncedAt, syncedAt + 1_000)).toBe(817);
    expect(secondsRemainingNow(818, syncedAt, syncedAt + 61_500)).toBe(757);
  });

  it('is null before billing starts or on a binary without the field', () => {
    expect(secondsRemainingNow(null, syncedAt, syncedAt)).toBeNull();
    expect(secondsRemainingNow(undefined, syncedAt, syncedAt)).toBeNull();
    // dataUpdatedAt is 0 until the first successful fetch.
    expect(secondsRemainingNow(818, 0, syncedAt)).toBeNull();
    expect(secondsRemainingNow(Number.NaN, syncedAt, syncedAt)).toBeNull();
  });

  it('never goes negative and ignores a clock that went backwards', () => {
    expect(secondsRemainingNow(5, syncedAt, syncedAt + 60_000)).toBe(0);
    expect(secondsRemainingNow(0, syncedAt, syncedAt)).toBe(0);
    expect(secondsRemainingNow(30, syncedAt, syncedAt - 10_000)).toBe(30);
  });
});

describe('sessionClock: per second only inside the last five minutes', () => {
  it('flips at exactly five minutes', () => {
    expect(COUNTDOWN_THRESHOLD_SECONDS).toBe(300);
    expect(showsCountdown(300)).toBe(true);
    expect(showsCountdown(301)).toBe(false);
    expect(showsCountdown(0)).toBe(true);
    expect(showsCountdown(null)).toBe(false);
  });

  it('repaints per second when counting down and coarsely otherwise', () => {
    expect(clockTickMs(299)).toBe(COUNTDOWN_TICK_MS);
    expect(clockTickMs(300)).toBe(COUNTDOWN_TICK_MS);
    expect(clockTickMs(301)).toBe(COARSE_TICK_MS);
    expect(clockTickMs(null)).toBe(COARSE_TICK_MS);
    expect(COUNTDOWN_TICK_MS).toBe(1_000);
    expect(COARSE_TICK_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('sessionClock: two labels, one shape each', () => {
  it('formats m:ss with zero-padded seconds', () => {
    expect(formatClock(299)).toBe('4:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(133.9)).toBe('2:13');
  });

  it('floors to whole minutes and names the sub-minute case', () => {
    expect(formatMinutes(818)).toBe('13 min');
    expect(formatMinutes(779)).toBe('12 min');
    expect(formatMinutes(60)).toBe('1 min');
    expect(formatMinutes(59)).toBe('under 1 min');
    expect(formatMinutes(0)).toBe('under 1 min');
  });

  it('estimates talk seconds from a balance when no session is live', () => {
    expect(estimatedTalkSeconds(300, 22)).toBe(818);
    expect(estimatedTalkSeconds(0, 22)).toBe(0);
    expect(estimatedTalkSeconds(null, 22)).toBe(0);
    expect(estimatedTalkSeconds(300, 0)).toBe(0);
  });
});
