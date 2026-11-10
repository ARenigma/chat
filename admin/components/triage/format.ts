// Deterministic formatting for admin lists. Both take `now` as an argument and pin the
// time zone, so a server render and the client hydration produce identical text.
const TZ = 'Asia/Kolkata';
const DAY = 24 * 3600 * 1000;

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  });
}

/** "5m", "3h", "2d" under a week, then "12 Oct". */
export function relTime(ts: string | null | undefined, now: number): string {
  if (!ts) return '—';
  const ms = now - new Date(ts).getTime();
  if (ms < 60_000) return 'now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < DAY) return `${Math.floor(ms / 3600_000)}h`;
  if (ms < 7 * DAY) return `${Math.floor(ms / DAY)}d`;
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
}

export function ageYears(dob: string | null | undefined, now: number): string {
  if (!dob) return '—';
  return String(Math.floor((now - new Date(dob).getTime()) / (365.25 * DAY)));
}
