import type { ProviderSummary } from '../src/lib/database.types';
import { busyForSpeech, busyLine, readBusy } from '../src/lib/busy';

/*
 * The busy state on the directory card (Amit, 2026-09-27). The server field
 * does not exist yet, so the contract is pinned here against a fixture: a row
 * WITHOUT `busy_wait_minutes` is free, which is every row today, so the UI
 * lands dark until the field is served.
 */
const FIXTURE: ProviderSummary = {
  id: 'p-busy',
  display_name: 'Ada',
  avatar_url: null,
  gender: 'female',
  age: 29,
  headline: 'Here to listen',
  about: null,
  languages: ['English', 'Hindi'],
  is_available: true,
  rating_avg: 4.6,
  rating_count: 12,
  median_reply_seconds: 90,
  last_active_at: null,
  created_at: '2026-09-01T00:00:00Z',
  presence: 'here',
  chat_enabled: true,
  audio_enabled: true,
  video_enabled: false,
  provider_category: 'listener',
  expertise: ['Anxiety'],
};

describe('readBusy', () => {
  it('reads a row without the field as free, which is every row today', () => {
    expect(readBusy(FIXTURE)).toBeNull();
    expect(readBusy({ ...FIXTURE, busy_wait_minutes: undefined })).toBeNull();
  });

  it('reads null as busy with no estimate', () => {
    expect(readBusy({ ...FIXTURE, busy_wait_minutes: null })).toEqual({ waitMinutes: null });
  });

  it('reads a positive number as a wait, rounded up to a whole minute', () => {
    expect(readBusy({ ...FIXTURE, busy_wait_minutes: 12 })).toEqual({ waitMinutes: 12 });
    expect(readBusy({ ...FIXTURE, busy_wait_minutes: 0.3 })).toEqual({ waitMinutes: 1 });
    expect(readBusy({ ...FIXTURE, busy_wait_minutes: 4.2 })).toEqual({ waitMinutes: 5 });
  });

  it('never claims a wait nobody gave: 0, negative and NaN are "no estimate"', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readBusy({ ...FIXTURE, busy_wait_minutes: bad })).toEqual({ waitMinutes: null });
    }
  });
});

describe('the busy line and its spoken twin', () => {
  it('draws "wait ~Nm", or "Busy" with no estimate', () => {
    expect(busyLine({ waitMinutes: 12 })).toBe('wait ~12m');
    expect(busyLine({ waitMinutes: 1 })).toBe('wait ~1m');
    expect(busyLine({ waitMinutes: null })).toBe('Busy');
  });

  it('speaks words, not "~12m"', () => {
    expect(busyForSpeech({ waitMinutes: 12 })).toBe('busy, about 12 minutes wait');
    expect(busyForSpeech({ waitMinutes: 1 })).toBe('busy, about 1 minute wait');
    expect(busyForSpeech({ waitMinutes: null })).toBe('busy right now');
    for (const busy of [{ waitMinutes: 12 }, { waitMinutes: null }]) {
      expect(busyForSpeech(busy)).not.toMatch(/~/);
    }
  });

  it('is what the card renders, end to end from the fixture', () => {
    const busy = readBusy({ ...FIXTURE, busy_wait_minutes: 7 });
    expect(busy).not.toBeNull();
    expect(busy === null ? null : busyLine(busy)).toBe('wait ~7m');
  });
});
