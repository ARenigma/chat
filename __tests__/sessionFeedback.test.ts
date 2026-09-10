/**
 * "Feedback wired in after every session?" — the gate that makes the answer yes.
 *
 * Goal item 14 landed with migration 066 and ONE caller: ChatScreen, watching
 * `activeSession` cross from live to null. A voice or video session that ended
 * while the member was on CallScreen — every call that is not abandoned back
 * into the chat — was never rated, even though the store's own comment on
 * `requestReview` describes a call and a chat both noticing the same end. This
 * file pins the call half so it cannot be removed silently again, and pins the
 * two things the call half made newly possible to get wrong: asking twice for
 * one session, and asking for a session that billed nothing.
 *
 * Source-text assertions, with comments stripped first and the slices bounded to
 * the function under test. This repo has shipped gates that were kept green by
 * their own explanatory prose, so a claim that can be satisfied by a comment is
 * not a claim.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

/** Block comments and own-line line comments, so prose cannot satisfy a gate. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const call = withoutComments(read('src/screens/CallScreen.tsx'));
const sheet = withoutComments(read('src/components/SessionFeedbackSheet.tsx'));
const chat = withoutComments(read('src/screens/ChatScreen.tsx'));
const store = withoutComments(read('src/store/useStore.ts'));
const migration = read('supabase/migrations/066_session_reviews_and_ratings.sql');

/**
 * The review effect only, so nothing elsewhere in a 700-line screen can stand in
 * for it. Bounded by the next statement in the file rather than by a line count.
 */
const reviewEffect = call.slice(
  call.indexOf('const requestReview'),
  call.indexOf('void startCall('),
);

describe('a call asks for feedback too', () => {
  it('requests a review when the call screen goes away', () => {
    expect(reviewEffect).not.toBe('');
    // The store action, from the store, not a local re-implementation.
    expect(reviewEffect).toContain('const requestReview = useStore(s => s.requestReview)');
    // A cleanup: `() => () => {` is an unmount handler, and unmount is this
    // screen's single exit — End, Decline, the back dialog, a peer hang-up seen
    // by the heartbeat, a media failure and a server-side end all pop the route.
    expect(reviewEffect).toMatch(/useEffect\(\s*\(\) => \(\) => \{/);
    expect(reviewEffect).toContain('requestReview(billed, reviewPeerNameRef.current)');
  });

  it('covers every way a call ends by covering the one exit they share', () => {
    /*
     * Each of these is an end-of-call path, and each resolves through `onEnd`,
     * which pops the route and unmounts the screen. If one of them ever stops
     * going through `onEnd` it will stop asking for feedback, so they are named
     * here: the list is the claim that unmount is sufficient.
     *
     * 2026-09-08: the paths that end the call FROM CODE now go through
     * `finish`, which is `setNotice` + `onEnd` behind a once-only latch (see
     * the next test for why the latch exists). The claim this test makes is
     * unchanged — every path still reaches `onEnd` — so the funnel is asserted
     * once, here, and each path is then asserted to enter it.
     */
    expect(call).toMatch(/const finish = useCallback\([\s\S]{0,400}onEnd\(\);/);

    // The member hangs up.
    expect(call).toMatch(/testID="call-end"[\s\S]{0,200}onPress=\{onEnd\}/);
    // The member declines a ring (nothing billed — see the next test).
    expect(call).toMatch(/testID="call-decline"[\s\S]{0,200}onPress=\{onEnd\}/);
    // The hardware back button, via the confirm dialog.
    expect(call).toMatch(/setLeaveDialogVisible\(false\);\s*onEnd\(\);/);
    // The peer hangs up, or the balance runs out: the server ends the call and
    // the heartbeat reads it back.
    expect(call).toMatch(/r\.status === 'ended'[\s\S]{0,80}finish\(/);
    // The media dies under a call that had already been paid for.
    expect(call).toMatch(/connState === 'failed'[\s\S]{0,120}finish\(/);
    // The PEER LEAVES THE CHANNEL. Agora reports this the instant it happens
    // (`onUserOffline` -> 'closed'); before 2026-09-08 nothing handled it and
    // the remaining side sat on a live-looking call for up to one 20 s
    // heartbeat before the server's 'ended' was read back.
    expect(call).toMatch(/connState === 'closed'[\s\S]{0,1200}finish\(/);
    // The server says so — a decline while ringing, or a server-side end —
    // delivered by the row subscription rather than waited for.
    expect(call).toMatch(/useCallEnded\(callId, endedNotice\)/);
  });

  it('keeps the first end, so a decline is not overwritten by a hang-up', () => {
    /*
     * Two detectors now see a peer hang-up: the media adapter ('closed') and
     * the row subscription. Only the second one knows whether the call was
     * DECLINED or merely missed — the server records that distinction in
     * `end_call` and nothing read it until now. Without a latch the media
     * detector could land second and replace a true "Declined." with a generic
     * "Call ended.", which is the same class of lie the subscription was added
     * to remove.
     */
    const finish = call.slice(call.indexOf('const finish = useCallback'));
    expect(finish.slice(0, 300)).toMatch(/if \(endedRef\.current\) \{\s*return;\s*\}/);
    expect(finish.slice(0, 300)).toContain('endedRef.current = true');
    // The declined/missed wording exists at all, and comes from the server's
    // own word rather than from a timeout guessing.
    expect(call).toMatch(/ended\.status === 'declined'[\s\S]{0,160}Declined\./);
    expect(call).toMatch(/ended\.status === 'missed'/);
  });

  it('asks only for a session that billed, and does not use the phase to decide', () => {
    /*
     * `sessionId !== null` is the test. `start_call` returns a
     * `session_request_id` and no session, so a refused start, a ring cancelled
     * before it was answered and a declined incoming call all reach the cleanup
     * with nothing to rate. `answer_call` creates the row (at `pending_leases`,
     * billing nothing — 086:174), so an accepted call whose media then failed
     * has a session id to rate while never reaching `phase === 'active'`, which
     * is why the phase must not be the guard.
     */
    expect(reviewEffect).toContain('const billed = sessionIdRef.current');
    expect(reviewEffect).not.toContain('phaseRef');
    expect(reviewEffect).not.toContain("=== 'active'");
  });

  it('never asks about a call whose media never connected', () => {
    /*
     * Amit, 2026-09-07: "session end review should not fire when there was no
     * connection". Billing is NOT the same question as "was there a call".
     *
     * `answer_call` creates the paid_sessions row and bills minute one before
     * any media exists, so a call that was answered and then failed to connect
     * arrives at the cleanup with a real session id and nothing to review.
     * Asking "how was your session?" about a call that never audibly happened
     * invites a one-star rating of the network onto a provider's average.
     *
     * `connectedTrackedRef` is the right signal and not a new one: it is set
     * ONLY inside the `connState === 'connected'` branch and never reset, so at
     * cleanup it means "media connected at least once". `connState` itself is
     * useless here — by unmount it has moved to `closed`.
     */
    expect(reviewEffect).toMatch(
      /if \(\s*billed !== null &&\s*isMemberSideRef\.current &&\s*connectedTrackedRef\.current\s*\)/,
    );
    // The latch must stay a latch: set in the connected branch, never cleared.
    expect(call).toContain('const connectedTrackedRef = useRef(false)');
    expect(call).toMatch(/connState === 'connected'[\s\S]{0,200}connectedTrackedRef\.current = true/);
    expect(call).not.toMatch(/connectedTrackedRef\.current = false/);
    // And the id genuinely only arrives from the answered paths.
    expect(call).toContain('void answerCall(callId).then(result');
    expect(call).toMatch(/setSessionId\(result\.session_id \?\? null\)/);
  });

  it('never asks the provider, because the database will not accept it', () => {
    /*
     * Not a product preference. `submit_session_review` raises when the caller
     * is not the session's member, so a sheet on the provider's side would be a
     * Send button that cannot succeed. 006's rule, restated in 066, and it
     * decides the client.
     */
    const fn = migration.slice(
      migration.indexOf('create or replace function public.submit_session_review'),
      migration.indexOf('comment on function public.submit_session_review'),
    );
    expect(fn).toContain('if v_uid <> v_session.member_id then');
    expect(fn).toContain("raise exception 'only the member may review'");
    // The lenient conversation-level path says the same thing, so there is no
    // second door for a provider-authored review.
    expect(migration).toContain('if v_uid <> v_member then');

    // Which side we are on comes from the thread, not from `profiles.role`:
    // migration 007 lets a provider keep the threads they paid for, so a
    // provider CAN be the member of this session and must still be asked.
    expect(call).toContain("const isMemberSide = peerThread?.i_am_member ?? true");
    expect(reviewEffect).toContain('isMemberSideRef.current');
    // The chat half keeps its own gate.
    expect(chat).toMatch(/if \(isMemberSide && name !== ''\) \{\s*requestReview\(previous, name\);/);
  });
});

describe('one session, one prompt', () => {
  it('remembers what it has already asked, outside any single mount', () => {
    /*
     * `get_active_session` does not filter by channel, so the chat a member
     * lands on after hanging up reads back the call's own session row and
     * watches it end a second time. The store's first-writer-wins only holds
     * while a sheet is still up; once it has been answered `pendingReview` is
     * null again and the second notice would open a fresh sheet.
     */
    expect(sheet).toContain('const ASKED = new Set<string>()');
    expect(sheet).toContain('ASKED.add(pending.sessionId)');
    // A repeat notice is dropped, not left pending — pending would re-open it.
    expect(sheet).toMatch(/if \(ASKED\.has\(pending\.sessionId\)\) \{\s*clearReview\(\);\s*return;\s*\}/);
    // And the sheet renders only for the session this mount claimed, so the
    // `ASKED` entry it just wrote cannot hide it.
    expect(sheet).toContain('if (pending === null || askedFor !== pending.sessionId)');
    expect(sheet).toMatch(/const close = useCallback\(\(\) => \{[\s\S]{0,200}setAskedFor\(null\);/);
  });

  it('keeps the store guard that stops two screens racing for one sheet', () => {
    // Belt and braces, and the belt is not ours to remove: first writer wins
    // while a sheet is up, `ASKED` covers the case after it closes.
    expect(store).toMatch(/state\.pendingReview === null \? \{ pendingReview:/);
  });

  it('still lets the member out without answering', () => {
    // A rating prompt with no way past it is a toll gate on leaving a
    // conversation somebody may have found difficult. Skip must stay, and it
    // must reach the same `close` that clears the claim.
    expect(sheet).toContain('cancelLabel="Skip"');
    expect(sheet).toContain('onCancel={close}');
  });
});
