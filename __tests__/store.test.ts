import { resetStore, selectIsLow, useStore } from '../src/store/useStore';
import { LOW_BALANCE_THRESHOLD } from '../src/lib/tokenLedger';

describe('useStore', () => {
  beforeEach(resetStore);

  it('starts with an unknown balance and no stream', () => {
    const s = useStore.getState();
    expect(s.balance).toBeNull();
    expect(s.isStreaming).toBe(false);
    expect(s.streamText).toBe('');
    expect(s.refillVisible).toBe(false);
  });

  it('clears any stale text and notice when a stream begins', () => {
    useStore.getState().setStreamText('left over');
    useStore.getState().setNotice('old failure');
    useStore.getState().beginStream();

    const s = useStore.getState();
    expect(s.isStreaming).toBe(true);
    expect(s.streamText).toBe('');
    expect(s.notice).toBeNull();
  });

  it('publishes cumulative text, not appended fragments', () => {
    const { beginStream, setStreamText } = useStore.getState();
    beginStream();
    setStreamText('He');
    setStreamText('Hey th');
    setStreamText('Hey there');
    expect(useStore.getState().streamText).toBe('Hey there');
  });

  it('drops the live text when the stream ends, so the bubble unmounts once', () => {
    const { beginStream, setStreamText, endStream } = useStore.getState();
    beginStream();
    setStreamText('partial');
    endStream();

    const s = useStore.getState();
    expect(s.isStreaming).toBe(false);
    expect(s.streamText).toBe('');
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

  it('resets everything, as account deletion requires', () => {
    const s = useStore.getState();
    s.setBalance(12);
    s.beginStream();
    s.setStreamText('mid flight');
    s.openRefill();
    s.setNotice('boom');

    resetStore();

    expect(useStore.getState()).toMatchObject({
      balance: null,
      streamText: '',
      isStreaming: false,
      refillVisible: false,
      notice: null,
    });
  });
});
