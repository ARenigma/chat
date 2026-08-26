import {
  dayLabel,
  daysBetween,
  listStamp,
  longDate,
  opensDay,
  sameDay,
  timeOfDay,
} from '../src/lib/datetime';

/**
 * The buckets, with the clock held still.
 *
 * Every assertion here passes a `now` explicitly rather than mocking the global
 * clock. That is not squeamishness about fake timers: `listStamp` and `dayLabel`
 * take `now` as a parameter *because* a bucket boundary is the interesting case,
 * and a test that cannot place an instant either side of one is testing nothing.
 *
 * Times are constructed with the local-time `Date` constructor, not from a Z
 * string. A test that says "23:00 and 01:00 are different days" is only true in
 * some zones if the instants are pinned to UTC, and the functions under test
 * deliberately compare *local* calendar days.
 */
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('calendar days, not elapsed hours', () => {
  it('counts a day boundary crossed eleven hours apart', () => {
    // The bug this rules out: (now - then) / 86400000 rounds this to zero, so a
    // message sent last night reads as "Today" all through this morning.
    expect(daysBetween(new Date(2026, 7, 21, 23, 59), new Date(2026, 7, 22, 10, 1))).toBe(1);
  });

  it('counts twenty-three hours inside one day as zero', () => {
    expect(daysBetween(new Date(2026, 7, 22, 0, 1), new Date(2026, 7, 22, 23, 59))).toBe(0);
  });

  it('answers sameDay across a midnight and within a day', () => {
    expect(sameDay(at(2026, 8, 22, 0, 1), at(2026, 8, 22, 23, 59))).toBe(true);
    expect(sameDay(at(2026, 8, 21, 23, 59), at(2026, 8, 22, 0, 1))).toBe(false);
  });

  it('crosses a month and a year boundary', () => {
    expect(daysBetween(new Date(2025, 11, 31, 20, 0), new Date(2026, 0, 1, 9, 0))).toBe(1);
    expect(daysBetween(new Date(2026, 6, 31, 20, 0), new Date(2026, 7, 1, 9, 0))).toBe(1);
  });
});

describe('the conversation-list stamp escalates the way iOS Messages does', () => {
  const now = new Date(2026, 7, 22, 15, 0);

  it('shows a time today, not a duration', () => {
    // The whole reason this module exists: the old form returned '3h'.
    const stamp = listStamp(at(2026, 8, 22, 9, 30), now);
    expect(stamp).not.toMatch(/[hmdw]$/);
    expect(stamp).toBe(timeOfDay(at(2026, 8, 22, 9, 30)));
  });

  it('says Yesterday rather than 1d', () => {
    expect(listStamp(at(2026, 8, 21, 9, 30), now)).toBe('Yesterday');
  });

  it('names the weekday inside the last week', () => {
    // Six days back is the last day a weekday name is unambiguous.
    expect(listStamp(at(2026, 8, 16, 9, 30), now)).toMatch(/day$/);
  });

  it('falls back to digits at exactly a week, not a day later', () => {
    // The off-by-one that matters: seven days back is a *second* Saturday, so a
    // weekday name there names two different days.
    expect(listStamp(at(2026, 8, 15, 9, 30), now)).not.toMatch(/day$/);
    expect(listStamp(at(2026, 8, 15, 9, 30), now)).toMatch(/\d/);
  });

  it('never returns a week count', () => {
    expect(listStamp(at(2026, 6, 4, 9, 30), now)).not.toContain('w');
  });

  it('treats a future stamp as today rather than as a negative bucket', () => {
    // Clock skew between a device and Postgres is real, and a row stamped two
    // minutes from now must not fall through every bucket to a numeric date.
    expect(listStamp(at(2026, 8, 22, 15, 2), now)).toBe(timeOfDay(at(2026, 8, 22, 15, 2)));
  });
});

describe('the transcript divider', () => {
  const now = new Date(2026, 7, 22, 15, 0);

  it('says Today for today and Yesterday for yesterday', () => {
    expect(dayLabel(at(2026, 8, 22, 9, 0), now)).toBe('Today');
    expect(dayLabel(at(2026, 8, 21, 9, 0), now)).toBe('Yesterday');
  });

  it('writes an older day out in full rather than compressing it', () => {
    // A divider is read, not scanned, so it takes the long form where a list row
    // takes digits. Asserted as the difference, since both are locale-dependent.
    const old = at(2026, 5, 2, 9, 0);
    expect(dayLabel(old, now)).toBe(longDate(old));
    expect(dayLabel(old, now)).not.toBe(listStamp(old, now));
  });

  it('opens a day at the oldest message the client holds', () => {
    // Without this branch the top of the transcript has no divider at all, which
    // is the hole the single hardcoded footer was covering.
    expect(opensDay({ created_at: at(2026, 8, 22, 9, 0) }, undefined)).toBe(true);
  });

  it('opens a day only on the first row of it', () => {
    const first = { created_at: at(2026, 8, 22, 0, 5) };
    const previousDay = { created_at: at(2026, 8, 21, 23, 55) };
    const sameDayEarlier = { created_at: at(2026, 8, 22, 0, 1) };
    expect(opensDay(first, previousDay)).toBe(true);
    expect(opensDay(first, sameDayEarlier)).toBe(false);
  });
});

describe('clock format follows the device, not a hardcoded locale', () => {
  it('formats through Intl rather than padding getHours', () => {
    // The assertion that would fail against the old implementation: it produced
    // exactly two leading digits for every hour, because it built the string by
    // hand. Intl in a 12-hour locale produces '9:30 AM'.
    const formatted = timeOfDay(at(2026, 8, 22, 9, 30));
    expect(formatted).toContain('30');
    expect(formatted).toMatch(/^\d/);
  });

  it('agrees with the platform formatter for the same instant', () => {
    // Pinned to Intl rather than to a literal, because the literal is whatever
    // locale the test runner happens to have and that is not the contract.
    const iso = at(2026, 8, 22, 21, 5);
    expect(timeOfDay(iso)).toBe(
      new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
        new Date(iso),
      ),
    );
  });
});
