/** Date bucketing in IST (the admins' day), on plain ISO strings. Pure. */

const TZ = 'Asia/Kolkata';
const DAY_MS = 86_400_000;
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' of the IST calendar day containing this instant. */
export function istDayKey(iso: string | number | Date): string {
  return dayFmt.format(new Date(iso));
}

function keyToUtc(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last `n` IST day keys ending at `now`, oldest first. */
export function lastDays(n: number, now: string | number | Date): string[] {
  const end = keyToUtc(istDayKey(now));
  return Array.from({ length: n }, (_, i) => utcToKey(end - (n - 1 - i) * DAY_MS));
}

/** Monday (IST) of the week containing this instant, as a day key. */
export function weekStartKey(iso: string | number | Date): string {
  const ms = keyToUtc(istDayKey(iso));
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  return utcToKey(ms - dow * DAY_MS);
}

/** The last `n` week-start keys ending at the week of `now`, oldest first. */
export function lastWeeks(n: number, now: string | number | Date): string[] {
  const end = keyToUtc(weekStartKey(now));
  return Array.from({ length: n }, (_, i) => utcToKey(end - (n - 1 - i) * 7 * DAY_MS));
}

/** '3 Nov' for a day key. */
export function dayLabel(key: string): string {
  return new Date(keyToUtc(key)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** Count items per key; keys outside `keys` are ignored. */
export function countByKey<T>(items: T[], keys: string[], keyOf: (t: T) => string | null): number[] {
  const idx = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const it of items) {
    const k = keyOf(it);
    const i = k == null ? undefined : idx.get(k);
    if (i !== undefined) out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}
