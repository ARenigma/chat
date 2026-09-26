import {
  offeredChannelsLine,
  presenceForSpeech,
  readPresence,
} from '../src/lib/presence';

/**
 * AVAILABILITY REPLACED PRESENCE (Amit, 2026-09-17).
 *
 * This file used to defend a single direction: nobody is ever shown as present
 * who did not say they were, so every unknown, every null and every
 * disagreement between `presence` and `last_active_at` had to resolve to
 * silence. That rule existed because there were TWO stored columns describing
 * roughly the same thing and they could contradict each other.
 *
 * There is one now. `is_available` is the provider's master switch, and it is
 * the only input: master off reads offline everywhere and routes the member to
 * Notify, master on reads online whatever the three channel switches say. The
 * old `presence` column is deliberately left in the schema, unread, so the
 * enum, `presence_visible` and `touch_presence()` can be dropped in a later
 * cleanup rather than in the same change that stopped reading them.
 *
 * The closed direction still matters and is still most of what follows, but the
 * unknown is now a single unloaded boolean rather than a pair that can disagree.
 * The last-seen stamp cases are gone with the column: `touch_presence()` was
 * never once called from the client, so `last_active_at` was never written, and
 * every "Last seen" this app rendered was formatting a value nobody set.
 */

describe('readPresence is a reading of the master switch, and nothing else', () => {
  it('lights the dot when the provider is open', () => {
    expect(readPresence(true)).toEqual({ here: true, line: 'Here now' });
  });

  it('says Away when they are closed, rather than inventing a stamp', () => {
    // Not "Last seen ...": nothing has ever written last_active_at, so a stamp
    // would be a specific claim made out of an unset column.
    expect(readPresence(false)).toEqual({ here: false, line: 'Away' });
  });

  it('fails closed on a profile that has not loaded', () => {
    // The directory renders before the row arrives. An unknown must never light
    // the dot, because a lit dot is what a member spends tokens against.
    expect(readPresence(null).here).toBe(false);
    expect(readPresence(undefined).here).toBe(false);
  });

  it('publishes no line at all for an unknown, rather than guessing Away', () => {
    // Null is a real case and distinct from closed: the chat header renders the
    // name alone rather than reserving a row that appears and disappears.
    expect(readPresence(null).line).toBeNull();
    expect(readPresence(undefined).line).toBeNull();
  });
});

/**
 * THE SERVER'S READING (migration 155). `online` and `last_seen_at` are derived
 * by the database from the provider app's heartbeat, so this only renders them.
 *
 * Every case pins `utcOffsetMinutes: 330`, IST: the product's time zone, and one
 * with no daylight saving, so a midnight boundary means the same thing on any
 * machine that runs this. `ist()` builds an instant from an IST wall clock.
 */
const IST = 330;
const ist = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h, mi, s) - IST * 60_000);
// Sunday 27 September 2026, 2:30 pm IST.
const NOW = ist(2026, 9, 27, 14, 30);
const seen = (at: Date | string | null | undefined, now: Date = NOW) =>
  readPresence({
    online: false,
    lastSeenAt: at instanceof Date ? at.toISOString() : at,
    now,
    utcOffsetMinutes: IST,
  });

describe('readPresence with the server reading: Online', () => {
  it('lights the dot and says Online, whatever the last seen', () => {
    expect(
      readPresence({
        online: true,
        lastSeenAt: ist(2026, 9, 27, 14, 29).toISOString(),
        now: NOW,
        utcOffsetMinutes: IST,
      }),
    ).toEqual({ here: true, line: 'Online' });
    expect(
      readPresence({ online: true, lastSeenAt: null, now: NOW }),
    ).toEqual({ here: true, line: 'Online' });
  });

  it('never lights the dot for a last seen, however recent', () => {
    // Availability off with a live heartbeat arrives as online false plus a
    // stamp from a minute ago; the server already folded the switch in.
    expect(seen(ist(2026, 9, 27, 14, 30)).here).toBe(false);
  });
});

describe('readPresence with the server reading: last seen', () => {
  it('says today with a 12-hour en-IN clock', () => {
    expect(seen(ist(2026, 9, 27, 10, 15))).toEqual({
      here: false,
      line: 'last seen today at 10:15 am',
    });
    expect(seen(ist(2026, 9, 27, 13, 7)).line).toBe(
      'last seen today at 1:07 pm',
    );
    expect(seen(ist(2026, 9, 27, 12, 0)).line).toBe(
      'last seen today at 12:00 pm',
    );
    expect(seen(ist(2026, 9, 27, 0, 5)).line).toBe(
      'last seen today at 12:05 am',
    );
  });

  it('reads the calendar in IST, not UTC', () => {
    // 00:10 IST on the 27th is 18:40 UTC on the 26th: a UTC reading would say
    // yesterday.
    expect(seen(ist(2026, 9, 27, 0, 10)).line).toBe(
      'last seen today at 12:10 am',
    );
    // And 23:50 IST on the 26th is 18:20 UTC the same day, which is still
    // yesterday in IST.
    expect(seen(ist(2026, 9, 26, 23, 50)).line).toBe(
      'last seen yesterday at 11:50 pm',
    );
  });

  it('turns over exactly at midnight', () => {
    const justAfter = ist(2026, 9, 27, 0, 0, 30);
    expect(seen(ist(2026, 9, 26, 23, 59), justAfter).line).toBe(
      'last seen yesterday at 11:59 pm',
    );
    expect(seen(ist(2026, 9, 27, 0, 0), justAfter).line).toBe(
      'last seen today at 12:00 am',
    );
    const justBefore = ist(2026, 9, 26, 23, 59, 59);
    expect(seen(ist(2026, 9, 26, 0, 0), justBefore).line).toBe(
      'last seen today at 12:00 am',
    );
    expect(seen(ist(2026, 9, 25, 23, 59), justBefore).line).toBe(
      'last seen yesterday at 11:59 pm',
    );
  });

  it('says yesterday for the whole previous calendar day', () => {
    expect(seen(ist(2026, 9, 26, 0, 0)).line).toBe(
      'last seen yesterday at 12:00 am',
    );
    expect(seen(ist(2026, 9, 26, 10, 15)).line).toBe(
      'last seen yesterday at 10:15 am',
    );
  });

  it('names the weekday for two to six days back', () => {
    expect(seen(ist(2026, 9, 25, 10, 15)).line).toBe(
      'last seen Friday at 10:15 am',
    );
    // Six days back is the last weekday that cannot mean two different days.
    expect(seen(ist(2026, 9, 21, 10, 15)).line).toBe(
      'last seen Monday at 10:15 am',
    );
  });

  it('gives a date from seven days back, without the time', () => {
    // Seven days back is a Sunday again, which is why the weekday stops at six.
    expect(seen(ist(2026, 9, 20, 23, 59)).line).toBe('last seen 20 Sep');
    expect(seen(ist(2026, 9, 12, 10, 15)).line).toBe('last seen 12 Sep');
    expect(seen(ist(2026, 1, 3, 8, 0)).line).toBe('last seen 3 Jan');
  });

  it('adds the year when it is not this one', () => {
    expect(seen(ist(2025, 12, 31, 22, 0)).line).toBe('last seen 31 Dec 2025');
  });

  it('clamps a stamp ahead of the device clock to now', () => {
    // Skew, not a visit from the future: never "tomorrow", never a weekday.
    expect(seen(ist(2026, 9, 27, 14, 33)).line).toBe(
      'last seen today at 2:30 pm',
    );
    expect(seen(ist(2026, 9, 29, 9, 0)).line).toBe(
      'last seen today at 2:30 pm',
    );
  });

  it('says nothing when there is nothing to say', () => {
    // A member peer, a blocked pair, a provider never seen, or a row not loaded.
    expect(seen(null)).toEqual({ here: false, line: null });
    expect(seen(undefined)).toEqual({ here: false, line: null });
    expect(
      readPresence({ online: undefined, lastSeenAt: undefined, now: NOW }),
    ).toEqual({ here: false, line: null });
    expect(seen('not a timestamp')).toEqual({ here: false, line: null });
  });

  it('reads the device offset when none is pinned', () => {
    // Built from the local wall clock, so it holds in whatever zone runs this.
    const now = new Date(2026, 8, 27, 14, 30);
    const then = new Date(2026, 8, 27, 9, 5);
    expect(
      readPresence({ online: false, lastSeenAt: then.toISOString(), now })
        .line,
    ).toBe('last seen today at 9:05 am');
  });

  it('reads as a phrase for a screen reader', () => {
    expect(
      presenceForSpeech(
        readPresence({ online: true, lastSeenAt: null, now: NOW }),
      ),
    ).toBe('online');
    expect(presenceForSpeech(seen(ist(2026, 9, 26, 10, 15)))).toBe(
      'last seen yesterday at 10:15 am',
    );
  });
});

describe('presenceForSpeech', () => {
  it('lowercases the line so it reads inside a sentence', () => {
    expect(presenceForSpeech(readPresence(true))).toBe('here now');
    expect(presenceForSpeech(readPresence(false))).toBe('away');
  });

  it('stays null when there is nothing to say', () => {
    expect(presenceForSpeech(readPresence(null))).toBeNull();
  });
});

describe('offeredChannelsLine names the limit, and says nothing when there is none', () => {
  const offer = (chat: boolean, audio: boolean, video: boolean) => ({
    chat_enabled: chat,
    audio_enabled: audio,
    video_enabled: video,
  });

  it('says nothing when all three are offered, because that is the default', () => {
    // A line on every card would be noise. It earns its row only by excluding
    // something the member would otherwise reasonably expect.
    expect(offeredChannelsLine(offer(true, true, true))).toBeNull();
  });

  it('names a single channel', () => {
    expect(offeredChannelsLine(offer(true, false, false))).toBe('Chat only');
    expect(offeredChannelsLine(offer(false, true, false))).toBe(
      'Voice calls only',
    );
    expect(offeredChannelsLine(offer(false, false, true))).toBe(
      'Video calls only',
    );
  });

  it('names both when two are offered, in chat, voice, video order', () => {
    // The same order the member's own action buttons sit in, so the sentence
    // and the row underneath it cannot read as two different answers.
    expect(offeredChannelsLine(offer(true, true, false))).toBe(
      'Chat and voice calls only',
    );
    expect(offeredChannelsLine(offer(true, false, true))).toBe(
      'Chat and video calls only',
    );
    expect(offeredChannelsLine(offer(false, true, true))).toBe(
      'Voice and video calls only',
    );
  });

  it('carries no em-dash, which contract.test forbids in member-facing copy', () => {
    const lines = [
      offeredChannelsLine(offer(true, false, false)),
      offeredChannelsLine(offer(false, true, false)),
      offeredChannelsLine(offer(false, false, true)),
      offeredChannelsLine(offer(true, true, false)),
      offeredChannelsLine(offer(true, false, true)),
      offeredChannelsLine(offer(false, true, true)),
    ];
    for (const line of lines) {
      expect(line).not.toBeNull();
      expect(line).not.toMatch(/—/);
    }
  });
});
