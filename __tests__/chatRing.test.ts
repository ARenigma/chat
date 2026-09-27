import { chatRingDeadline } from '../src/lib/chatRing';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('chatRingDeadline', () => {
  it('rings the full length on a prompt delivery', () => {
    expect(chatRingDeadline(iso(NOW + 30_000), iso(NOW - 200), 30, NOW)).toBe(NOW + 30_000);
  });

  it('never outlasts the server when the clocks agree', () => {
    // Delivered 4 s late on agreeing clocks: the server has 26 s left.
    expect(chatRingDeadline(iso(NOW + 26_000), iso(NOW - 4_000), 30, NOW)).toBe(NOW + 26_000);
  });

  it('keeps the local deadline when the device clock disagrees (A8)', () => {
    // Device clock 60 s ahead: the server timestamps look a minute old.
    expect(chatRingDeadline(iso(NOW - 30_000), iso(NOW - 60_000), 30, NOW)).toBe(NOW + 30_000);
    // Device clock 60 s behind.
    expect(chatRingDeadline(iso(NOW + 90_000), iso(NOW + 60_000), 30, NOW)).toBe(NOW + 30_000);
  });

  it('falls back to local receipt when the server times are missing', () => {
    expect(chatRingDeadline('not a date', undefined, 30, NOW)).toBe(NOW + 30_000);
  });
});
