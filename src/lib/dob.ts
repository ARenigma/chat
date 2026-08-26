/**
 * Date-of-birth entry, in the order a person in India writes it.
 *
 * The field used to ask an applicant to type ISO `YYYY-MM-DD`, which is the most
 * un-iPhone-like input in the app: nobody says their birthday leading with the
 * year, and the placeholder was teaching a database format to somebody applying
 * for a job.
 *
 * The iOS-correct control is an inline `UIDatePicker`, and it is deferred for
 * dependency reasons rather than design ones: every RN date picker is a native
 * module, the house rule is that a new native dependency needs its npm
 * `time.modified` checked first, and `react-native-callkeep` already broke this
 * build once by being stale. Auto-formatting `DD/MM/YYYY` from a number pad costs
 * nothing and is a real improvement on ISO; a picker can replace it later without
 * touching the submit path, because the conversion below is what the server sees.
 *
 * Pure, and here rather than in the screen, because "is 31/02/1998 a date" is
 * exactly the kind of question that is wrong until it is executed.
 */

/** Local calendar day, so a birthday is never shifted by a timezone. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Insert the slashes as somebody types, and never fight the backspace.
 *
 * The rule that makes this usable: a separator is only ever *appended* after a
 * complete group, never inserted before the caret. Adding the slash as soon as the
 * second digit lands means deleting it immediately re-adds it and the field
 * appears stuck, which is the standard way this control is got wrong.
 */
export function formatDobInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);
  if (year !== '') {
    return `${day}/${month}/${year}`;
  }
  if (month !== '') {
    return `${day}/${month}`;
  }
  return day;
}

/**
 * `DD/MM/YYYY` to the ISO string the server takes, or null.
 *
 * Rejects a real-looking impossible date rather than letting `Date` roll it over:
 * `new Date(1998, 1, 31)` is the 3rd of March, so a birthday typed as 31/02 would
 * silently become a different day and the age gate would then be checking a date
 * the applicant never entered.
 */
export function dobToIso(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (m === null) {
    return null;
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) {
    return null;
  }
  if (day > daysInMonth(year, month)) {
    return null;
  }
  // A four-digit year is not enough on its own: 0998 parses fine and is not a
  // birth date. The floor is deliberately generous rather than a guess at the
  // oldest plausible applicant.
  if (year < 1900) {
    return null;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Whole years between a birth date and now.
 *
 * Counted from calendar parts, not from elapsed milliseconds over 365.25 days.
 * The average-year version is wrong by up to a day either side of a birthday,
 * which on an 18-year gate is the difference between admitting and refusing
 * somebody on the day it matters most. The SQL constraint in migration 006 is
 * still the authority; this exists so a 17-year-old is told before filling in six
 * fields.
 */
export function ageFromIso(iso: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  let age = now.getFullYear() - year;
  const monthNow = now.getMonth() + 1;
  if (monthNow < month || (monthNow === month && now.getDate() < day)) {
    age -= 1;
  }
  return age;
}
