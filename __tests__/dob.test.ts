import { ageFromIso, dobToIso, formatDobInput } from '../src/lib/dob';

describe('typing a birth date', () => {
  it('appends separators after a complete group, never before the caret', () => {
    expect(formatDobInput('2')).toBe('2');
    expect(formatDobInput('23')).toBe('23');
    expect(formatDobInput('234')).toBe('23/4');
    expect(formatDobInput('23041998')).toBe('23/04/1998');
  });

  it('does not fight a backspace', () => {
    // The way this control is usually got wrong: appending the slash as soon as
    // the second digit lands means deleting it immediately re-adds it, and the
    // field appears stuck. Deleting back through a separator has to shorten the
    // value.
    expect(formatDobInput('23/')).toBe('23');
    expect(formatDobInput('23/0')).toBe('23/0');
    expect(formatDobInput('23/04/19')).toBe('23/04/19');
  });

  it('ignores anything that is not a digit and stops at eight', () => {
    expect(formatDobInput('23-04-1998')).toBe('23/04/1998');
    expect(formatDobInput('230419989999')).toBe('23/04/1998');
  });
});

describe('converting to what the server takes', () => {
  it('reorders a complete date', () => {
    expect(dobToIso('23/04/1998')).toBe('1998-04-23');
  });

  it('refuses an incomplete one rather than guessing', () => {
    expect(dobToIso('23/04')).toBeNull();
    expect(dobToIso('23/04/98')).toBeNull();
    expect(dobToIso('')).toBeNull();
  });

  it('refuses a real-looking impossible date', () => {
    // `new Date(1998, 1, 31)` is the 3rd of March, so without this the birthday
    // silently becomes a different day and the age gate then checks a date the
    // applicant never entered.
    expect(dobToIso('31/02/1998')).toBeNull();
    expect(dobToIso('31/04/1998')).toBeNull();
    expect(dobToIso('00/04/1998')).toBeNull();
    expect(dobToIso('23/13/1998')).toBeNull();
  });

  it('knows which Februaries have 29 days', () => {
    expect(dobToIso('29/02/2000')).toBe('2000-02-29');
    expect(dobToIso('29/02/1900')).toBeNull();
    expect(dobToIso('29/02/1999')).toBeNull();
  });

  it('refuses a four-digit year that is not a birth year', () => {
    expect(dobToIso('23/04/0998')).toBeNull();
  });
});

describe('the age gate counts calendar years', () => {
  it('turns eighteen on the birthday, not a day either side', () => {
    // The elapsed-milliseconds-over-365.25-days version is wrong by up to a day
    // around a birthday, which on an 18-year gate is the difference between
    // admitting and refusing somebody on the one day it matters.
    const dob = '2008-08-22';
    expect(ageFromIso(dob, new Date(2026, 7, 21))).toBe(17);
    expect(ageFromIso(dob, new Date(2026, 7, 22))).toBe(18);
  });

  it('handles a birthday later in the year', () => {
    expect(ageFromIso('2008-12-31', new Date(2026, 7, 22))).toBe(17);
    expect(ageFromIso('2008-01-01', new Date(2026, 7, 22))).toBe(18);
  });

  it('is null for anything that is not an ISO date', () => {
    expect(ageFromIso('23/04/1998')).toBeNull();
    expect(ageFromIso('')).toBeNull();
  });
});
