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
    expect(s.peerActivity).toBeNull();
    expect(s.refillVisible).toBe(false);
    expect(s.walletVisible).toBe(false);
  });

  /**
   * `sending` is about this device's outbound RPC and `peerActivity` about the
   * other person. Conflating them, as a single `isStreaming` flag would, is
   * what makes a UI show "replying…" because *you* are typing.
   */
  it('keeps our own send state independent of the peer activity', () => {
    useStore.getState().setSending(true);
    expect(useStore.getState().peerActivity).toBeNull();

    useStore.getState().setPeerActivity('typing');
    useStore.getState().setSending(false);
    expect(useStore.getState().peerActivity).toBe('typing');
  });

  /*
   * A boolean until 2026-09-17. the reference app carries typing and recording as
   * separate wire actions and renders separate copy for each
   * (MessagesController.java:11210-11213), and this app has voice notes, so
   * "typing" was simply untrue for the whole length of one being recorded.
   */
  it('distinguishes recording from typing, because they are not the same claim', () => {
    useStore.getState().setPeerActivity('recording');
    expect(useStore.getState().peerActivity).toBe('recording');

    useStore.getState().setPeerActivity('typing');
    expect(useStore.getState().peerActivity).toBe('typing');

    useStore.getState().setPeerActivity(null);
    expect(useStore.getState().peerActivity).toBeNull();
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

  it('opens the wallet page independently of the refill sheet', () => {
    useStore.getState().openWallet();
    expect(useStore.getState().walletVisible).toBe(true);
    expect(useStore.getState().refillVisible).toBe(false);
    useStore.getState().openRefill();
    expect(useStore.getState().walletVisible).toBe(false);
    expect(useStore.getState().refillVisible).toBe(true);
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
    s.setPeerActivity('typing');
    s.setSending(true);
    s.setNotice('boom');

    useStore.getState().resetConversation();

    expect(useStore.getState()).toMatchObject({
      balance: 12,
      sending: false,
      peerActivity: null,
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
      peerActivity: null,
      refillVisible: false,
      walletVisible: false,
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

  describe('a chat request that arrives while another rings', () => {
    // expiresAt is now a local ms timestamp (nav-migration §3, A8).
    const FUTURE = Date.now() + 30_000;
    const PAST = Date.now() - 1_000;
    const request = (id: string, extra: { expiresAt?: number } = {}) => ({
      requestId: id,
      conversationId: `c-${id}`,
      peerId: `p-${id}`,
      peerName: `Member ${id}`,
      expiresAt: FUTURE,
      ...extra,
    });

    it('keeps the ringing one on screen and rings the next when it leaves, oldest first', () => {
      // First-writer-wins used to DROP the second request: a silent shade
      // entry and no ring once the first ran out or was accepted.
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r2'));
      s.setIncomingRequest(request('r3'));
      expect(useStore.getState().incomingRequest?.requestId).toBe('r1');
      useStore.getState().clearIncomingRequest('r1');
      expect(useStore.getState().incomingRequest?.requestId).toBe('r2');
      useStore.getState().clearIncomingRequest('r2');
      expect(useStore.getState().incomingRequest?.requestId).toBe('r3');
      useStore.getState().clearIncomingRequest('r3');
      expect(useStore.getState().incomingRequest).toBeNull();
    });

    it('queues a request once, however many times it is delivered', () => {
      // The Realtime insert and recoverPending can both deliver the same row.
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r2'));
      s.setIncomingRequest(request('r2'));
      expect(useStore.getState().queuedRequests.map(q => q.requestId)).toEqual(['r2']);
      useStore.getState().clearIncomingRequest('r1');
      useStore.getState().clearIncomingRequest('r2');
      expect(useStore.getState().incomingRequest).toBeNull();
    });

    it('skips a queued request that expired while it waited', () => {
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r2', { expiresAt: PAST }));
      s.setIncomingRequest(request('r3', { expiresAt: FUTURE + 30_000 }));
      useStore.getState().clearIncomingRequest('r1');
      expect(useStore.getState().incomingRequest?.requestId).toBe('r3');
    });

    it('owner-checks the clear: a stale requestId does nothing', () => {
      // A late callback from a request that already ran out must not end the
      // ring of the one that replaced it.
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r2'));
      useStore.getState().clearIncomingRequest('r1'); // r1 leaves, r2 rings
      useStore.getState().clearIncomingRequest('r1'); // stale — should be a no-op
      expect(useStore.getState().incomingRequest?.requestId).toBe('r2');
    });

    it('never rings a request a second time once it has rung and left, answered or run out', () => {
      // recoverPending re-delivers a request that is still `pending` on every
      // resubscribe, including one the provider already answered.
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      useStore.getState().clearIncomingRequest('r1'); // answered
      useStore.getState().setIncomingRequest(request('r1'));
      expect(useStore.getState().incomingRequest).toBeNull();
      // One promoted from the queue has rung too.
      useStore.getState().setIncomingRequest(request('r2'));
      useStore.getState().setIncomingRequest(request('r3'));
      useStore.getState().clearIncomingRequest('r2'); // r2 timed out, r3 rings
      useStore.getState().clearIncomingRequest('r3'); // r3 answered
      useStore.getState().setIncomingRequest(request('r3'));
      useStore.getState().setIncomingRequest(request('r2'));
      expect(useStore.getState().incomingRequest).toBeNull();
      expect(useStore.getState().queuedRequests).toEqual([]);
      // The next account starts with nothing rung.
      resetStore();
      useStore.getState().setIncomingRequest(request('r1'));
      expect(useStore.getState().incomingRequest?.requestId).toBe('r1');
    });

    it('forgets the queue with the rest of the account on reset', () => {
      const s = useStore.getState();
      s.setIncomingRequest(request('r1'));
      s.setIncomingRequest(request('r2'));
      resetStore();
      // After reset, any stale clear is a no-op.
      useStore.getState().clearIncomingRequest('r1');
      expect(useStore.getState().incomingRequest).toBeNull();
    });
  });

  it('does not leave a stale confirm tone on the next failure', () => {
    const s = useStore.getState();
    s.setNotice('Unblocked.', 'confirm');
    s.setNotice('Could not unblock right now.');
    expect(useStore.getState().noticeTone).toBe('error');
  });
});

describe('activeCall (nav-migration §3)', () => {
  beforeEach(resetStore);

  it('starts null', () => {
    expect(useStore.getState().activeCall).toBeNull();
  });

  it('beginCall sets the call and returns a seq', () => {
    const seq = useStore.getState().beginCall({ direction: 'out', peerId: 'p1', callId: null });
    const call = useStore.getState().activeCall;
    expect(call).not.toBeNull();
    expect(call?.seq).toBe(seq);
    expect(call?.direction).toBe('out');
    expect(call?.peerId).toBe('p1');
    expect(call?.callId).toBeNull();
  });

  it('setActiveCallId updates the callId owner-checked', () => {
    const seq = useStore.getState().beginCall({ direction: 'out', peerId: 'p1', callId: null });
    useStore.getState().setActiveCallId(seq, 'call-abc');
    expect(useStore.getState().activeCall?.callId).toBe('call-abc');

    // A stale seq does nothing.
    useStore.getState().setActiveCallId(seq + 99, 'call-xyz');
    expect(useStore.getState().activeCall?.callId).toBe('call-abc');
  });

  it('endActiveCall clears owner-checked, stale seq is a no-op', () => {
    const seq = useStore.getState().beginCall({ direction: 'in', peerId: 'p2', callId: 'cid' });
    useStore.getState().endActiveCall(seq + 99); // stale — no-op
    expect(useStore.getState().activeCall).not.toBeNull();
    useStore.getState().endActiveCall(seq);
    expect(useStore.getState().activeCall).toBeNull();
  });

  it('beginCall for a second call replaces the first (glare is the caller\'s job)', () => {
    useStore.getState().beginCall({ direction: 'in', peerId: 'p1', callId: 'c1' });
    const seq2 = useStore.getState().beginCall({ direction: 'out', peerId: 'p2', callId: null });
    expect(useStore.getState().activeCall?.seq).toBe(seq2);
    useStore.getState().endActiveCall(seq2);
    expect(useStore.getState().activeCall).toBeNull();
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
