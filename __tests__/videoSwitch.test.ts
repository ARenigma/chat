import { videoSwitchEvents, type VideoSwitchRow } from '../src/lib/videoSwitch';

const ME = 'me';
const PEER = 'peer';
const T0 = Date.parse('2026-09-24T10:00:00Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const idle: VideoSwitchRow = {
  upgrade_requested_by: null,
  upgrade_requested_at: null,
  upgrade_result: null,
  upgrade_resolved_at: null,
};
const none = { requestAt: null, resolvedAt: null };

describe('videoSwitchEvents', () => {
  it("tells the side that did NOT ask about the peer's request, once", () => {
    const row = { ...idle, upgrade_requested_by: PEER, upgrade_requested_at: at(0) };
    const first = videoSwitchEvents(none, row, ME, T0 + 1000);
    expect(first.events).toEqual([{ kind: 'request', requestedBy: PEER }]);
    // The channel re-reads the row after a reconnect: no second prompt.
    expect(videoSwitchEvents(first.seen, row, ME, T0 + 2000).events).toEqual([]);
  });

  it("does not prompt the requester with their own request", () => {
    const row = { ...idle, upgrade_requested_by: ME, upgrade_requested_at: at(0) };
    expect(videoSwitchEvents(none, row, ME, T0 + 1000).events).toEqual([]);
  });

  it('does not prompt for a request already past its 30 s window', () => {
    const row = { ...idle, upgrade_requested_by: PEER, upgrade_requested_at: at(0) };
    expect(videoSwitchEvents(none, row, ME, T0 + 31_000).events).toEqual([]);
  });

  it('delivers the outcome even when the request UPDATE was missed', () => {
    // The requester's device never saw the pending row, only the resolved one,
    // where upgrade_requested_by is already null (the Greptile P1).
    const resolved = { ...idle, upgrade_result: 'declined' as const, upgrade_resolved_at: at(5000) };
    expect(videoSwitchEvents(none, resolved, ME, T0 + 6000).events).toEqual([
      { kind: 'resolved', result: 'declined' },
    ]);
  });

  it('reports accept, balance refusal, and expiry as distinct outcomes', () => {
    for (const result of ['accepted', 'insufficient_balance', 'expired'] as const) {
      const row = { ...idle, upgrade_result: result, upgrade_resolved_at: at(1000) };
      expect(videoSwitchEvents(none, row, ME, T0 + 2000).events).toEqual([{ kind: 'resolved', result }]);
    }
  });

  it('ignores an outcome from long before this screen subscribed', () => {
    const row = { ...idle, upgrade_result: 'accepted' as const, upgrade_resolved_at: at(0) };
    expect(videoSwitchEvents(none, row, ME, T0 + 5 * 60_000).events).toEqual([]);
  });

  it('a second request after a decline prompts again', () => {
    const first = videoSwitchEvents(
      none,
      { ...idle, upgrade_requested_by: PEER, upgrade_requested_at: at(0) },
      ME,
      T0 + 500,
    );
    const again = videoSwitchEvents(
      first.seen,
      { ...idle, upgrade_requested_by: PEER, upgrade_requested_at: at(20_000) },
      ME,
      T0 + 20_500,
    );
    expect(again.events).toEqual([{ kind: 'request', requestedBy: PEER }]);
  });

  it('a late re-read of an OLDER outcome does not override a newer one', () => {
    // The server accepted (t=1s), then fell back to voice (t=5s, 136). A row
    // read started before the fallback lands last with the accept.
    const newer = videoSwitchEvents(
      none,
      { ...idle, upgrade_result: 'insufficient_balance', upgrade_resolved_at: at(5000) },
      ME,
      T0 + 6000,
    );
    const late = videoSwitchEvents(
      newer.seen,
      { ...idle, upgrade_result: 'accepted', upgrade_resolved_at: at(1000) },
      ME,
      T0 + 6500,
    );
    expect(late.events).toEqual([]);
    expect(late.seen.resolvedAt).toBe(at(5000));
  });

  it('a late read of a pending row does not reopen consent after its outcome', () => {
    const resolved = videoSwitchEvents(
      none,
      { ...idle, upgrade_result: 'declined', upgrade_resolved_at: at(4000) },
      ME,
      T0 + 4500,
    );
    const stalePending = videoSwitchEvents(
      resolved.seen,
      { ...idle, upgrade_requested_by: PEER, upgrade_requested_at: at(1000) },
      ME,
      T0 + 5000,
    );
    expect(stalePending.events).toEqual([]);
  });
});
