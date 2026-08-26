import { readFileSync } from 'fs';
import { join } from 'path';
import { resetStore, selectIsLow, useStore } from '../src/store/useStore';
import { LOW_BALANCE_THRESHOLD } from '../src/lib/tokenLedger';

describe('useStore', () => {
  beforeEach(resetStore);

  it('starts with an unknown balance and a quiet conversation', () => {
    const s = useStore.getState();
    expect(s.balance).toBeNull();
    expect(s.sending).toBe(false);
    expect(s.peerTyping).toBe(false);
    expect(s.refillVisible).toBe(false);
  });

  /**
   * `sending` is about this device's outbound RPC and `peerTyping` about the
   * other person. Conflating them, as a single `isStreaming` flag would, is
   * what makes a UI show "replying…" because *you* are typing.
   */
  it('keeps our own send state independent of the peer typing', () => {
    useStore.getState().setSending(true);
    expect(useStore.getState().peerTyping).toBe(false);

    useStore.getState().setPeerTyping(true);
    useStore.getState().setSending(false);
    expect(useStore.getState().peerTyping).toBe(true);
  });

  it('never opens the refill sheet from a balance change alone', () => {
    useStore.getState().setBalance(0);
    expect(useStore.getState().refillVisible).toBe(false);
  });

  it('opens and closes the refill sheet only on request', () => {
    useStore.getState().openRefill();
    expect(useStore.getState().refillVisible).toBe(true);
    useStore.getState().closeRefill();
    expect(useStore.getState().refillVisible).toBe(false);
  });

  it('derives the low-balance nudge from the shared threshold', () => {
    useStore.getState().setBalance(LOW_BALANCE_THRESHOLD);
    expect(selectIsLow(useStore.getState())).toBe(false);
    useStore.getState().setBalance(LOW_BALANCE_THRESHOLD - 1);
    expect(selectIsLow(useStore.getState())).toBe(true);
  });

  /**
   * Leaving a thread must not carry its presence into the next one: the balance
   * is global, but "she is typing" belongs to the conversation you just left.
   */
  it('clears conversation state on leave but keeps the balance', () => {
    const s = useStore.getState();
    s.setBalance(12);
    s.setPeerTyping(true);
    s.setSending(true);
    s.setNotice('boom');

    useStore.getState().resetConversation();

    expect(useStore.getState()).toMatchObject({
      balance: 12,
      sending: false,
      peerTyping: false,
      notice: null,
    });
  });

  /**
   * There is one native audio player, so there can only be one playhead. These
   * assertions are about the shape of that: `setPlaying` replaces rather than
   * merges, and leaving the thread stops the sound.
   */
  it('holds one playing voice note at a time', () => {
    const s = useStore.getState();
    s.setPlaying({ messageId: 'a', positionMs: 1200, durationMs: 4000, pending: false });
    expect(useStore.getState().playing?.messageId).toBe('a');

    // Starting b while a is playing must not leave a's position behind: the
    // player has already stopped a, and a merged update would move the playhead
    // on the row that took over.
    s.setPlaying({ messageId: 'b', positionMs: 0, durationMs: 9000, pending: true });
    expect(useStore.getState().playing).toEqual({
      messageId: 'b',
      positionMs: 0,
      durationMs: 9000,
      pending: true,
    });
  });

  it('stops the playhead when the conversation is left', () => {
    // Audio from the thread you just walked out of should not keep playing over
    // the next one, and the marker has to clear with the sound.
    useStore
      .getState()
      .setPlaying({ messageId: 'a', positionMs: 10, durationMs: 4000, pending: false });
    useStore.getState().resetConversation();
    expect(useStore.getState().playing).toBeNull();
  });

  it('resets everything, as account deletion requires', () => {
    const s = useStore.getState();
    s.setBalance(12);
    s.setSending(true);
    s.openRefill();
    s.setNotice('boom');

    resetStore();

    expect(useStore.getState()).toMatchObject({
      balance: null,
      sending: false,
      peerTyping: false,
      refillVisible: false,
      notice: null,
    });
  });
});

/**
 * A confirmation must not be able to arrive wearing the failure surface.
 *
 * There was one channel and one appearance, so "Blocked.", "Reported.",
 * "Application submitted." and "Thanks, that helps the next person choose."
 * all rendered inside a red-bordered bar. It was visible on a device the
 * instant a rating was submitted: a thank-you in an error box.
 */
describe('notice tone', () => {
  beforeEach(() => resetStore());

  it('treats an unqualified notice as a failure', () => {
    useStore.getState().setNotice('Could not send.');
    expect(useStore.getState().noticeTone).toBe('error');
  });

  it('carries a confirmation tone when one is asked for', () => {
    useStore.getState().setNotice('Unblocked.', 'confirm');
    expect(useStore.getState().noticeTone).toBe('confirm');
  });

  it('does not leave a stale confirm tone on the next failure', () => {
    const s = useStore.getState();
    s.setNotice('Unblocked.', 'confirm');
    s.setNotice('Could not unblock right now.');
    expect(useStore.getState().noticeTone).toBe('error');
  });
});

/**
 * Every message the app phrases as good news is tagged as one. Source-level,
 * because the alternative is rendering each mutation and asserting a border
 * colour, far more machinery for a weaker claim.
 */
describe('success messages are tagged as confirmations', () => {
  const sources = ['src/api/safety.ts', 'src/api/provider.ts', 'src/api/chat.ts']
    .map(f => readFileSync(join(__dirname, '..', f), 'utf8'))
    .join('\n');

  it.each([
    'Blocked. They can no longer message you.',
    'Unblocked.',
    'Reported. Our team will review this.',
    'Application submitted. We will be in touch.',
    'Thanks, that helps the next person choose.',
  ])('tags %s', message => {
    expect(sources).toContain(`setNotice('${message}', 'confirm')`);
  });
});
