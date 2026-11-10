// Presentation helpers shared by the Queues and Payouts screens. Dates are pinned to
// IST so the server render and the browser agree (these screens render in client Views).

const TZ = 'Asia/Kolkata';

/** "now", "12m", "5h", "9d", then a short date. `now` is passed in so SSR and hydration match. */
export function formatAge(ts: string | null | undefined, now: number): string {
  if (!ts) return '-';
  const diff = now - new Date(ts).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  return formatShortDate(ts, now);
}

/** "29 Oct", with the two-digit year only when it is not the current year. */
export function formatShortDate(ts: string | null | undefined, now: number): string {
  if (!ts) return '-';
  const d = new Date(ts);
  const sameYear = new Date(now).getUTCFullYear() === d.getUTCFullYear();
  // en-IN spells September "Sept"; keep three-letter months.
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' }),
    timeZone: TZ,
  }).replace('Sept', 'Sep');
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Rupees in lakh/crore grouping, e.g. 482300 -> ₹4,82,300. */
export function formatInr(rupees: number): string {
  return INR.format(rupees);
}
