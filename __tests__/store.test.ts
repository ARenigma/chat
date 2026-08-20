import { resetStore, selectIsLow, useStore } from '../src/store/useStore';
import { LOW_BALANCE_THRESHOLD } from '../src/lib/tokenLedger';

describe('useStore', () => {
  beforeEach(resetStore);

  it('starts with an unknown balance and a quiet conversation', () => {
    const s = useStore.getState();
    expect(s.balance).toBeNull();
    expect(s.sending).toBe(false);
    expect(s.peerTyping).toBe(false);
    expect(s.peerOnline).toBe(false);
    expect(s.refillVisible).toBe(false);
  });

  /**
   * `sending` is about this device's outbound RPC and `peerTyping` about the
   * other person. Conflating them — as a single `isStreaming` flag would — is
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
    s.setPeerOnline(true);
    s.setSending(true);
    s.setNotice('boom');

    useStore.getState().resetConversation();

    expect(useStore.getState()).toMatchObject({
      balance: 12,
      sending: false,
      peerTyping: false,
      peerOnline: false,
      notice: null,
    });
  });

  it('resets everything, as account deletion requires', () => {
    const s = useStore.getState();
    s.setBalance(12);
    s.setSending(true);
    s.setPeerOnline(true);
    s.openRefill();
    s.setNotice('boom');

    resetStore();

    expect(useStore.getState()).toMatchObject({
      balance: null,
      sending: false,
      peerTyping: false,
      peerOnline: false,
      refillVisible: false,
      notice: null,
    });
  });
});
