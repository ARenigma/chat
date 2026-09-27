/**
 * The birth-details card: date, time and place of birth, shared in an
 * astrologer chat as ONE message (Amit, 2026-09-25: "build the birth-details
 * card now").
 *
 * WHY A CARD. Birth details are the contact guard's largest false-block source,
 * about 1 in 100 free-text messages (.claude/plans/contact-guard-v2.md, section
 * 9 and decision 2): "14/08/1994 06:40" joins into a run of digits that reads
 * like a phone number. The spec rejects a context exemption ("near DOB, digits
 * don't count"), because it hands a sender a free prefix, and proposes option
 * B: pickers for the date and time, the place as guarded text.
 *
 * SO THERE IS NO EXEMPTION, AND THE GUARD RUNS UNCHANGED. The card is safe by
 * construction instead:
 *   - the date and time come from the platform pickers, and are written with a
 *     month NAME and a 12-hour clock, so their digits are at most a 1-2 digit
 *     day, a 4-digit year from 1900, a 1-2 digit hour and 2 minutes: at most
 *     10 digits, and 10 only when the day is 10-31, so the run starts with 1, 2
 *     or 3 and is never an Indian mobile (6-9) or a prefixed one (needs 11+);
 *   - the place is a city name, so it takes no digits at all.
 * The body is an ordinary message through `send_message` and the server's gate.
 * Rows in supabase/tests/contact_guard_cases.json (set `birth_card`) pin the
 * verdict on both detectors: Jest asserts the mirror, pgTAP the SQL.
 *
 * THE MARK IS THE GRAMMAR. `formatBirthDetails` writes one exact shape and
 * `parseBirthDetails` accepts only that shape, so the transcript draws a card
 * for the card's messages on both sides with no schema change. A person typing
 * the same line by hand gets the same card, which is harmless: it can only hold
 * what the card could have sent.
 */

const BIRTH_PREFIX = 'Birth details: ';
const BIRTH_TIME_UNKNOWN = 'time unknown';
export const BIRTH_PLACE_MAX = 60;
/** The earliest birth year the date picker offers. */
export const BIRTH_YEAR_MIN = 1900;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface BirthDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

export interface BirthTime {
  /** 0-23. */
  hour: number;
  minute: number;
}

export interface BirthDetails {
  date: BirthDate;
  /** Null when the member does not know it. */
  time: BirthTime | null;
  place: string;
}

/** Letters and marks in any script, spaces, and . , ' ( ) - : a city, never a number. */
const PLACE = /^[\p{L}\p{M}][\p{L}\p{M} .,'()-]*$/u;

/** The place as it will be sent: trimmed, inner runs of space collapsed. */
function cleanBirthPlace(place: string): string {
  return place.trim().replace(/\s+/gu, ' ');
}

/** Why a place cannot be sent, as the field's supporting text, or null. */
export function birthPlaceProblem(place: string): string | null {
  const clean = cleanBirthPlace(place);
  if (clean.length < 2) {
    return 'Enter the city you were born in.';
  }
  if (clean.length > BIRTH_PLACE_MAX) {
    return `Keep it under ${BIRTH_PLACE_MAX} characters.`;
  }
  if (/\p{N}/u.test(clean)) {
    return 'A place of birth has no numbers. Enter the city only.';
  }
  if (!PLACE.test(clean)) {
    return 'Use letters only for the city.';
  }
  return null;
}

/** A real calendar date between 1 Jan 1900 and `today`, inclusive. */
export function isBirthDateValid(
  date: BirthDate,
  today: Date = new Date(),
): boolean {
  const { year, month, day } = date;
  if (
    ![year, month, day].every(Number.isInteger) ||
    year < BIRTH_YEAR_MIN ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) {
    return false;
  }
  const t =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();
  return year * 10000 + month * 100 + day <= t;
}

function isTimeValid(time: BirthTime): boolean {
  return (
    Number.isInteger(time.hour) &&
    Number.isInteger(time.minute) &&
    time.hour >= 0 &&
    time.hour <= 23 &&
    time.minute >= 0 &&
    time.minute <= 59
  );
}

/** "14 Aug 1994". */
export function formatBirthDate(date: BirthDate): string {
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** "6:40 am", "12:05 pm". A 12-hour clock whatever the device uses: see the file header. */
export function formatBirthTime(time: BirthTime): string {
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return `${hour12}:${String(time.minute).padStart(2, '0')} ${
    time.hour < 12 ? 'am' : 'pm'
  }`;
}

/**
 * The message body, or null when any part is invalid. The one shape the card
 * sends: "Birth details: 14 Aug 1994, 6:40 am, Pune".
 */
export function formatBirthDetails(
  details: BirthDetails,
  today: Date = new Date(),
): string | null {
  const place = cleanBirthPlace(details.place);
  if (
    !isBirthDateValid(details.date, today) ||
    birthPlaceProblem(place) !== null
  ) {
    return null;
  }
  if (details.time !== null && !isTimeValid(details.time)) {
    return null;
  }
  const time =
    details.time === null ? BIRTH_TIME_UNKNOWN : formatBirthTime(details.time);
  return `${BIRTH_PREFIX}${formatBirthDate(details.date)}, ${time}, ${place}`;
}

const LINE = new RegExp(
  `^${BIRTH_PREFIX}([1-9]|[12][0-9]|3[01]) (${MONTHS.join('|')}) ([0-9]{4}), ` +
    `(?:(1[0-2]|[1-9]):([0-5][0-9]) (am|pm)|${BIRTH_TIME_UNKNOWN}), (.+)$`,
  'u',
);

/**
 * The details a body carries, or null when it is not exactly a card's line.
 * No `today` bound: a card sent yesterday stays a card.
 */
export function parseBirthDetails(
  body: string | null | undefined,
): BirthDetails | null {
  if (body === null || body === undefined) {
    return null;
  }
  const m = LINE.exec(body);
  if (m === null) {
    return null;
  }
  const date: BirthDate = {
    day: Number(m[1]),
    month: MONTHS.indexOf(m[2] as (typeof MONTHS)[number]) + 1,
    year: Number(m[3]),
  };
  const place = m[7] as string;
  if (
    !isBirthDateValid(date, new Date(8.64e15)) ||
    birthPlaceProblem(place) !== null ||
    cleanBirthPlace(place) !== place
  ) {
    return null;
  }
  let time: BirthTime | null = null;
  if (m[4] !== undefined) {
    const h12 = Number(m[4]);
    const pm = m[6] === 'pm';
    time = { hour: (h12 % 12) + (pm ? 12 : 0), minute: Number(m[5]) };
  }
  return { date, time, place };
}
