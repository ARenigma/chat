import {
  compareConversations,
  visibleOnList,
  visibleOnRail,
  type RailPrefs,
} from '../src/lib/railPrefs';

const prefs = (partial: Partial<RailPrefs>): RailPrefs => ({
  pinned: [],
  hiddenFromRail: [],
  deleted: [],
  ...partial,
});

describe('rail prefs', () => {
  it('hides a removed chat from the rail but keeps it on the list', () => {
    const next = prefs({ hiddenFromRail: ['p1'] });
    expect(visibleOnRail(next, 'p1')).toBe(false);
    expect(visibleOnList(next, 'p1')).toBe(true);
  });

  it('hides a deleted chat from both surfaces', () => {
    const next = prefs({ deleted: ['p1'] });
    expect(visibleOnRail(next, 'p1')).toBe(false);
    expect(visibleOnList(next, 'p1')).toBe(false);
  });

  it('sorts pinned chats ahead of recency', () => {
    const next = prefs({ pinned: ['old'] });
    const ranked = [
      { peerId: 'new', at: '2026-08-30' },
      { peerId: 'old', at: '2026-01-01' },
    ].sort((a, b) => compareConversations(next, a, b));
    expect(ranked.map(r => r.peerId)).toEqual(['old', 'new']);
  });
});
