import type { ProviderSummary } from './database.types';

/**
 * A provider who is here but already in a session: the directory CTA turns
 * garnet and a wait line hangs under it (Amit, 2026-09-27, Astrotalk's
 * "wait ~5m" under a busy astrologer's Call button).
 *
 * `waitMinutes` is null when the server says busy but has no estimate, and the
 * line then says only "Busy" rather than inventing a number.
 */
export type Busy = { waitMinutes: number | null };

/**
 * Reads `busy_wait_minutes` off a directory row.
 *
 * THE FIELD IS NOT SERVED YET. Another change adds it to `provider_directory`;
 * until then every row arrives without it and every provider reads as free,
 * which is the current behaviour, so this lands dark. The three states are
 * the field's contract:
 *
 *   undefined  not busy (or a server that predates the field)
 *   null       busy, no estimate
 *   number     busy, about this many minutes to wait
 *
 * A number that is not a positive finite count (0, negative, NaN) is treated as
 * "no estimate" rather than as free: the server said busy, and a "wait ~0m"
 * or "wait ~-3m" would be a claim nobody made.
 */
export function readBusy(provider: Pick<ProviderSummary, 'busy_wait_minutes'>): Busy | null {
  const raw = provider.busy_wait_minutes;
  if (raw === undefined) {
    return null;
  }
  if (raw === null || !Number.isFinite(raw) || raw <= 0) {
    return { waitMinutes: null };
  }
  // Rounded UP: "wait ~1m" for 20 seconds is a smaller promise than "~0m".
  return { waitMinutes: Math.ceil(raw) };
}

/** The line under the busy CTA: "wait ~12m", or "Busy" without an estimate. */
export function busyLine(busy: Busy): string {
  return busy.waitMinutes === null ? 'Busy' : `wait ~${busy.waitMinutes}m`;
}

/** The same fact for TalkBack, which reads "~12m" as symbols. */
export function busyForSpeech(busy: Busy): string {
  if (busy.waitMinutes === null) {
    return 'busy right now';
  }
  const unit = busy.waitMinutes === 1 ? 'minute' : 'minutes';
  return `busy, about ${busy.waitMinutes} ${unit} wait`;
}
