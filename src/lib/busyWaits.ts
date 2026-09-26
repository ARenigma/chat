/**
 * Pure half of the provider card's "Busy, wait ~N m" (migration 154).
 *
 * The server owns the number: `provider_busy_waits` returns, per listed
 * provider in a live paid session, the most whole minutes that session can
 * still run on its member's balance, or null when no bound is computable. This
 * file only reshapes it. Nothing here derives a wait, so a client clock or a
 * stale balance can never make one up.
 */
import type { ProviderBusyWait, ProviderSummary } from './database.types';

/** providerId -> minutes (1..99), or null for "Busy" with no estimate. */
export type BusyWaits = ReadonlyMap<string, number | null>;

/** The server's cap on ids per call (154 refuses more with 22023). */
export const BUSY_WAITS_MAX_IDS = 100;

export const NO_BUSY_WAITS: BusyWaits = new Map();

/**
 * Sorted, deduped, blank-free ids: one query key for the same directory
 * whatever order it arrived in.
 */
export function busyWaitIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(id => id !== ''))].sort();
}

/** Split into calls the server accepts. */
export function chunkBusyWaitIds(
  ids: readonly string[],
  size: number = BUSY_WAITS_MAX_IDS,
): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

export function busyWaitsToMap(rows: readonly ProviderBusyWait[]): BusyWaits {
  if (rows.length === 0) {
    return NO_BUSY_WAITS;
  }
  return new Map(rows.map(r => [r.provider_id, r.wait_minutes]));
}

/**
 * Stamp each provider with `busy_wait_minutes`: the server's value when they
 * are busy, and the field absent when they are not.
 *
 * Rows whose state did not change are returned as the same object, and the
 * same array comes back when nothing changed, so a memoised row does not
 * re-render every 30 s poll.
 */
export function withBusyWaits<T extends ProviderSummary>(
  providers: readonly T[],
  waits: BusyWaits,
): readonly T[] {
  let changed = false;
  const next = providers.map(p => {
    if (waits.has(p.id)) {
      const minutes = waits.get(p.id) ?? null;
      if (p.busy_wait_minutes === minutes) {
        return p;
      }
      changed = true;
      return { ...p, busy_wait_minutes: minutes };
    }
    if (p.busy_wait_minutes === undefined) {
      return p;
    }
    changed = true;
    const { busy_wait_minutes: _dropped, ...rest } = p;
    return rest as T;
  });
  return changed ? next : providers;
}
