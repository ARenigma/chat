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
