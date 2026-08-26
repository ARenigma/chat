import type { MessageReaction, ReactionEmoji } from '../src/lib/database.types';
import {
  REACTION_CHOICES,
  ownReaction,
  tallyByMessage,
} from '../src/lib/reactions';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

const row = (
  message_id: string,
  user_id: string,
  emoji: ReactionEmoji,
  created_at = '2026-08-22T10:00:00.000Z',
): MessageReaction => ({ message_id, user_id, emoji, created_at });

describe('the emoji set', () => {
  it('is six, closed, and the heart carries its variation selector', () => {
    // The failure this pins: a bare U+2764 typechecks, renders identically in most
    // editors, and comes back BAD_REQUEST from the CHECK constraint every time.
    expect(REACTION_CHOICES).toHaveLength(6);
    expect(REACTION_CHOICES[0]).toBe('❤️');
    expect(new Set(REACTION_CHOICES).size).toBe(6);
  });
});

describe('tallying reactions for a bubble', () => {
  it('groups by message and counts', () => {
    const t = tallyByMessage([row('m1', ME, '👍'), row('m1', THEM, '👍'), row('m2', THEM, '😂')], ME);
    expect(t.get('m1')).toEqual([{ emoji: '👍', count: 2, mine: true }]);
    expect(t.get('m2')).toEqual([{ emoji: '😂', count: 1, mine: false }]);
  });

  it('keeps mine true when the other person reacted second', () => {
    // The `||=` in the reducer. Assigning instead of or-ing loses the flag
    // whenever both people pick the same emoji, which is the common case.
    const mineFirst = tallyByMessage([row('m1', ME, '❤️'), row('m1', THEM, '❤️')], ME);
    const themFirst = tallyByMessage([row('m1', THEM, '❤️'), row('m1', ME, '❤️')], ME);
    expect(mineFirst.get('m1')?.[0]?.mine).toBe(true);
    expect(themFirst.get('m1')?.[0]?.mine).toBe(true);
  });

  it('orders by the fixed choice list, not by arrival or by count', () => {
    // A count or recency order makes the pills under a bubble swap places when
    // the other person reacts, which is movement in a transcript nobody asked for.
    const t = tallyByMessage(
      [
        row('m1', THEM, '🙏', '2026-08-22T10:00:00.000Z'),
        row('m1', ME, '❤️', '2026-08-22T11:00:00.000Z'),
      ],
      ME,
    );
    expect(t.get('m1')?.map(x => x.emoji)).toEqual(['❤️', '🙏']);
  });

  it('marks nothing as mine when there is no session id yet', () => {
    const t = tallyByMessage([row('m1', ME, '👍')], undefined);
    expect(t.get('m1')?.[0]?.mine).toBe(false);
  });

  it('returns no entry for a message with no reactions', () => {
    expect(tallyByMessage([], ME).get('m1')).toBeUndefined();
  });
});

describe('finding the caller own reaction', () => {
  it('finds it even when the other person chose the same emoji', () => {
    const rows = [row('m1', THEM, '😮'), row('m1', ME, '😮')];
    expect(ownReaction(undefined, rows, 'm1', ME)).toBe('😮');
  });

  it('is null when only the other person reacted', () => {
    expect(ownReaction(undefined, [row('m1', THEM, '😢')], 'm1', ME)).toBeNull();
  });

  it('does not leak a reaction from another message', () => {
    expect(ownReaction(undefined, [row('m2', ME, '👍')], 'm1', ME)).toBeNull();
  });

  it('is null without a session id', () => {
    expect(ownReaction(undefined, [row('m1', ME, '👍')], 'm1', undefined)).toBeNull();
  });
});
