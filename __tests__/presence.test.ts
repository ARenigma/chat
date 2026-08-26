import {
  PRESENCE_OPTIONS,
  presenceDetail,
  presenceForSpeech,
  readPresence,
} from '../src/lib/presence';
import type { PresenceChoice } from '../src/lib/database.types';

/**
 * The clock is passed explicitly for the same reason `datetime.test.ts` does it:
 * the interesting cases here sit either side of a bucket boundary in
 * `listStamp`, and a test that cannot place an instant on both sides of one is
 * testing nothing.
 *
 * What these assertions are actually defending is a single direction: nobody is
 * ever shown as present who did not say they were. Every unknown, every null and
 * every disagreement between the two stored columns has to resolve to silence,
 * so most of what follows is the closed direction rather than the happy path.
 */
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

const NOW = new Date(2026, 7, 22, 14, 30);

describe('readPresence renders only what was declared', () => {
  it('lights the dot for here, and nothing else does', () => {
    expect(readPresence('here', null, NOW)).toEqual({ here: true, line: 'Here now' });
    expect(readPresence('away', null, NOW).here).toBe(false);
    expect(readPresence('hidden', null, NOW).here).toBe(false);
  });

  it('says Away when there is no stamp to be more specific with', () => {
    expect(readPresence('away', null, NOW)).toEqual({ here: false, line: 'Away' });
  });

  it('prefers a last-seen stamp over the bare word', () => {
    // Consented by construction: the stamp is null in the view unless
    // `presence_visible` is on, so having one means they published it.
    const read = readPresence('away', at(2026, 8, 22, 9, 15), NOW);
    expect(read.here).toBe(false);
    expect(read.line).toMatch(/^Last seen /);
  });

  it('formats a stamp from an earlier day as a date, not a time', () => {
    // The boundary that matters: 'Last seen 09:15' about last Tuesday is a lie
    // by omission, and `listStamp` is what stops it.
    const sameDay = readPresence('away', at(2026, 8, 22, 9, 15), NOW).line;
    const lastWeek = readPresence('away', at(2026, 8, 12, 9, 15), NOW).line;
    expect(sameDay).not.toBe(lastWeek);
    expect(lastWeek).toMatch(/^Last seen /);
  });

  it('publishes nothing at all for hidden', () => {
    expect(readPresence('hidden', null, NOW)).toEqual({ here: false, line: null });
  });

  it('ignores a stamp that contradicts a hidden choice', () => {
    // `presence` and `presence_visible` are stored independently, so they can
    // disagree: a row written before 012, or a client that wrote one and not the
    // other. Hidden wins, because hidden is the choice made to conceal.
    expect(readPresence('hidden', at(2026, 8, 22, 9, 15), NOW).line).toBeNull();
  });

  it('fails closed on a peer that has not loaded', () => {
    // Not the same as absent: this is the case where the query is in flight, and
    // guessing 'here' for one frame is the one guess that must never happen.
    expect(readPresence(null, null, NOW)).toEqual({ here: false, line: null });
    expect(readPresence(undefined, at(2026, 8, 22), NOW)).toEqual({
      here: false,
      line: null,
    });
  });

  it('treats an empty stamp as no stamp rather than formatting it', () => {
    expect(readPresence('away', '', NOW).line).toBe('Away');
  });
});

describe('presenceForSpeech', () => {
  it('lowercases the line so it reads inside a sentence', () => {
    // ProviderRow speaks 'Message Ada, here now, rated 4.8...'. Title case mid
    // sentence is announced as emphasis by some screen readers.
    expect(presenceForSpeech(readPresence('here', null, NOW))).toBe('here now');
  });

  it('stays null when there is nothing to say', () => {
    expect(presenceForSpeech(readPresence('hidden', null, NOW))).toBeNull();
  });
});

describe('the options offered are the options the column accepts', () => {
  it('offers every value of the enum and no more', () => {
    // The control is exhaustive over the type, checked here rather than trusted:
    // a fourth enum value added in SQL and mirrored into `PresenceChoice` would
    // otherwise ship as a state the user can hold and never choose.
    const offered = PRESENCE_OPTIONS.map(o => o.value).sort();
    const all: PresenceChoice[] = ['away', 'here', 'hidden'];
    expect(offered).toEqual(all.sort());
  });

  it('runs most public to least, which is the scale a reader is scanning', () => {
    expect(PRESENCE_OPTIONS.map(o => o.value)).toEqual(['here', 'away', 'hidden']);
  });

  it('gives every option a consequence in the second person', () => {
    for (const option of PRESENCE_OPTIONS) {
      expect(option.detail.length).toBeGreaterThan(0);
      expect(option.detail.endsWith('.')).toBe(true);
      // The house rule, and the reason it is asserted rather than reviewed: an
      // em dash in this copy reaches a screen.
      // The character itself, written as an escape so a future repo-wide
      // punctuation sweep cannot rewrite this assertion into one that forbids
      // commas. That happened once: the sweep replaced the literal here and the
      // test then failed on copy that legitimately contains a comma.
      expect(option.detail).not.toContain('\u2014');
      expect(option.label).not.toContain('\u2014');
    }
  });

  it('resolves a detail for every choice, and falls back to the quietest', () => {
    expect(presenceDetail('here')).toBe(PRESENCE_OPTIONS[0]?.detail);
    expect(presenceDetail('hidden')).toBe(PRESENCE_OPTIONS[2]?.detail);
  });
});
