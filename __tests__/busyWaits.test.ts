import {
  BUSY_WAITS_MAX_IDS,
  NO_BUSY_WAITS,
  busyWaitIds,
  busyWaitsToMap,
  chunkBusyWaitIds,
  withBusyWaits,
} from '../src/lib/busyWaits';
import type { ProviderSummary } from '../src/lib/database.types';

const provider = (id: string, extra: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  display_name: `P ${id}`,
  avatar_url: null,
  gender: null,
  age: null,
  headline: null,
  about: null,
  languages: ['en'],
  is_available: true,
  rating_avg: null,
  rating_count: 0,
  median_reply_seconds: null,
  last_active_at: null,
  created_at: '2026-09-27T00:00:00Z',
  presence: 'here',
  chat_enabled: true,
  audio_enabled: true,
  video_enabled: false,
  provider_category: 'listener',
  expertise: [],
  ...extra,
});

describe('withBusyWaits', () => {
  it('stamps busy providers with the server minutes, null included, and leaves the rest unset', () => {
    const rows = [provider('a'), provider('b'), provider('c')];
    const out = withBusyWaits(rows, new Map([['a', 7], ['b', null]]));

    expect(out[0]?.busy_wait_minutes).toBe(7);
    expect(out[1]?.busy_wait_minutes).toBeNull();
    expect(out[2]).toBe(rows[2]);
    expect('busy_wait_minutes' in (out[2] ?? {})).toBe(false);
  });

  it('clears the field when a provider is no longer busy', () => {
    const rows = [provider('a', { busy_wait_minutes: 3 })];
    const out = withBusyWaits(rows, NO_BUSY_WAITS);

    expect(out[0]?.busy_wait_minutes).toBeUndefined();
    expect('busy_wait_minutes' in (out[0] ?? {})).toBe(false);
  });

  it('returns the same array and rows when nothing changed, so a poll re-renders nothing', () => {
    const rows = [provider('a', { busy_wait_minutes: 4 }), provider('b')];
    const out = withBusyWaits(rows, new Map([['a', 4]]));

    expect(out).toBe(rows);
  });

  it('does not mutate its input', () => {
    const rows = [provider('a')];
    withBusyWaits(rows, new Map([['a', 9]]));

    expect(rows[0]?.busy_wait_minutes).toBeUndefined();
  });
});

describe('busy wait ids and rows', () => {
  it('dedupes, drops blanks and sorts, so the query key ignores directory order', () => {
    expect(busyWaitIds(['c', 'a', '', 'c', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('splits into calls of at most the server cap', () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i).padStart(3, '0'));
    const chunks = chunkBusyWaitIds(ids);

    expect(chunks.map(c => c.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
    expect(BUSY_WAITS_MAX_IDS).toBe(100);
  });

  it('maps rows by provider id and keeps null minutes as null', () => {
    const map = busyWaitsToMap([
      { provider_id: 'a', wait_minutes: 12 },
      { provider_id: 'b', wait_minutes: null },
    ]);

    expect(map.get('a')).toBe(12);
    expect(map.has('b')).toBe(true);
    expect(map.get('b')).toBeNull();
    expect(map.has('c')).toBe(false);
    expect(busyWaitsToMap([])).toBe(NO_BUSY_WAITS);
  });
});
