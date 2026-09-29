/**
 * Every date and time string the app renders, in one place.
 *
 * It exists because there were three implementations and all three were wrong in
 * a different way:
 *
 *   - `InboxScreen.ago()` returned `now / 12m / 3h / 2d / 5w`, which is the
 *     WhatsApp-on-Android compact form. iOS Messages never shows `3h` in a
 *     conversation list: it shows the time for today, `Yesterday`, a weekday name
 *     inside the last week, then a short numeric date.
 *   - `ProviderHomeScreen.ago()` reimplemented the same idea from minutes and had
 *     no weeks bucket at all, so a month-old thread read as `31d`.
 *   - the retired V1 chat screen built `HH:MM` by hand with `getHours()`, which
 *     hardcodes 24-hour time. On an iPhone with Settings > General > Date & Time >
 *     24-Hour Time off, every message in the transcript showed the wrong format.
 *
 * The fix for the third one is the reason nothing here passes an explicit locale:
 * `Intl` with `undefined` follows the device, which is what "follows the 24-Hour
 * Time setting" actually means. Passing `'en-GB'` to get 24-hour output would be
 * the same bug with a longer spelling.
 *
 * Pure, and here rather than in a screen, for the same reason `transcript.ts` is:
 * it is testable without booting the native runtime, and a bucket boundary is
 * exactly the kind of arithmetic that is off by one until it is executed.
 */

const DAY_MS = 86_400_000;

/** Local midnight, so comparisons are on calendar days rather than on elapsed hours. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whole calendar days between two instants, positive when `then` is older.
 *
 * Deliberately not `(now - then) / DAY_MS`: 23:59 and 00:01 are eleven hours
 * apart in the same year and are two different days, and every bucket below cares
 * about the second fact rather than the first. DST makes a calendar day 23 or 25
 * hours long, which is also why both sides are normalised to local midnight
 * before subtracting.
 */
export function daysBetween(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
}

/** Same local calendar day. Accepts ISO strings, because that is what rows carry. */
export function sameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/**
 * A clock time, in the device's own 12- or 24-hour preference.
 *
 * No explicit locale and no explicit `hour12`, which is the entire point: both
 * would override the platform setting this function exists to respect.
 */
export function timeOfDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * The stamp on a conversation list row, following iOS Messages exactly.
 *
 * Today is a time, yesterday is a word, the last week is a weekday name, and
 * anything older is a short numeric date. The escalation is not decoration: a
 * weekday name is only unambiguous for six days, so it has to stop there or
 * "Tuesday" means one of two Tuesdays.
 */
export function listStamp(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = daysBetween(then, now);
  if (days <= 0) {
    return timeOfDay(iso);
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return then.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return then.toLocaleDateString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

/**
 * The label on a transcript day divider.
 *
 * Same escalation as `listStamp` and a different tail: a divider is separating
 * days, so beyond a week it names the day in full rather than compressing it to
 * digits. A transcript is read, not scanned.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = daysBetween(then, now);
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return then.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return longDate(iso);
}

/**
 * A date written out, for a submission stamp or a divider older than a week.
 *
 * Replaces the bare `toLocaleDateString()` on ProviderStatusScreen, which under
 * Hermes gives `8/22/2026` regardless of the device's region because Hermes ships
 * one locale.
 */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * A day and month with no year ("10 May"), for a transcript day divider.
 *
 * Composed day-then-month explicitly rather than through one `{day, month}`
 * formatter: Hermes ships only the en-US locale, so an `undefined`-locale
 * formatter renders "May 10", and the dividers follow the day-first order the
 * app's readers (India) use and the reference shows. The year is dropped because
 * the divider's relative label already fixes it in the current week.
 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { day: 'numeric' });
  const month = d.toLocaleDateString(undefined, { month: 'long' });
  return `${day} ${month}`;
}

/**
 * The two parts of a day-divider label: the relative `label` ("Today",
 * "Yesterday", "Tuesday") and a `date` tail ("10 May") shown after it, so the
 * divider reads "Today, 10 May" (the reference's metadata).
 *
 * Beyond a week `dayLabel` is already a full written date, so `date` is empty
 * there rather than appending a second, redundant date.
 */
export function dividerParts(
  iso: string,
  now: Date = new Date(),
): { label: string; date: string } {
  const days = daysBetween(new Date(iso), now);
  if (days >= 7) {
    return { label: longDate(iso), date: '' };
  }
  return { label: dayLabel(iso, now), date: shortDate(iso) };
}

/**
 * Whether a transcript row is the first of its calendar day.
 *
 * `older` is the row below it in a newest-first list, and `undefined` at the end
 * of history, which opens a day, because the oldest message the client holds is
 * always the first one of whatever day it is on. Take that branch away and the
 * top of the transcript has no divider at all, which is exactly the bug the
 * single hardcoded `ListFooterComponent` was papering over.
 */
export function opensDay(row: { created_at: string }, older?: { created_at: string }): boolean {
  return older === undefined || !sameDay(row.created_at, older.created_at);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "30 Aug 2026": the one date form the money screens share (Usage, Recharge
 * history, Bills & invoices), which had three between them (S22 2026-09-29:
 * "19/09/26", "13 Sept 2026", "2 September 2026"). Composed by hand for the
 * reason `longDate`'s neighbours are: Hermes ships one locale.
 */
export function moneyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
