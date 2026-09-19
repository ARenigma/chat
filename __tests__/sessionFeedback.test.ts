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
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

/**
 * The LAST migration that defines a function, which is the one that is live.
 *
 * Reading a named migration file is how this repo has repeatedly pinned a fact
 * that a later migration had already superseded — `start_call` is live in 079,
 * not 073; `answer_call` in 037, not 011. `submit_session_review` arrived in 066
 * and was rewritten by 100 (NULL-safe comparison, once a deleted member's
 * session can carry a NULL member_id), so an assertion against 066's text keeps
 * passing while describing a function that no longer exists.
 */
const lastDefinitionOf = (fn: string): string => {
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  const marker = `create or replace function public.${fn}`;
  const file = readdirSync(dir)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .filter(name => readFileSync(join(dir, name), 'utf8').includes(marker))
    .pop();
  if (file === undefined) throw new Error(`no migration defines ${fn}`);
  return readFileSync(join(dir, file), 'utf8');
};

/** Block comments and own-line line comments, so prose cannot satisfy a gate. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const call = withoutComments(read('src/screens/CallScreen.tsx'));
const sheet = withoutComments(read('src/components/SessionFeedbackSheet.tsx'));
const chat = withoutComments(read('src/chat-v2/useChatV2Controller.ts'));
const chatScreen = withoutComments(read('src/chat-v2/ChatScreenV2.tsx'));
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
    // delivered by the row subscription rather than waited for. The third
    // argument (added 2026-09-17) reports a non-terminal 'active' status
    // instead — the callee answered — and does not itself end the call, so
    // it is asserted separately in callControlsAreWired.test.ts rather than
    // here, which is specifically the end-of-call funnel.
    expect(call).toMatch(/useCallEnded\(callId, endedNotice, onCalleeAnswered\)/);
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
    const live = lastDefinitionOf('submit_session_review');
    const fn = live.slice(
      live.indexOf('create or replace function public.submit_session_review'),
      live.indexOf('comment on function public.submit_session_review'),
    );
    // `is distinct from`, not `<>`. 100 made a deleted member's session carry a
    // NULL member_id, and `v_uid <> NULL` is NULL — `if NULL` does not raise, so
    // the plain comparison failed OPEN on exactly that row.
    expect(fn).toContain('if v_uid is distinct from v_session.member_id then');
    expect(fn).toContain("raise exception 'only the member may review'");
    // The lenient conversation-level path says the same thing, so there is no
    // second door for a provider-authored review.
    expect(migration).toContain('if v_uid <> v_member then');

    // Which side we are on comes from the thread, not from `profiles.role`:
    // migration 007 lets a provider keep the threads they paid for, so a
    // provider CAN be the member of this session and must still be asked.
    expect(call).toContain("const isMemberSide = peerThread?.i_am_member ?? true");
    expect(reviewEffect).toContain('isMemberSideRef.current');
    // The chat half keeps its own gate, in the one place it asks — so both
    // the edge-watcher and the leave path inherit it.
    expect(chat).toMatch(
      /if \(benchmarkReadOnly \|\| !isMemberSide \|\| displayName === ''\) \{\s*return;\s*\}\s*requestReview\(sessionId, displayName\);/,
    );

    /*
     * 2026-09-13: neither screen's gate is the guarantee. Both compute
     * `peerThread?.i_am_member ?? true`, and `?? true` is also what a MISSING
     * summary row looks like — so a provider whose row has not arrived reads as
     * "member" and gets a sheet inviting them to rate a member. Inverting the
     * default is not available either: a member calling straight from the
     * directory legitimately has no summary row yet. So the guess stays in the
     * screens for the optimistic UI, and the sheet reads the session row before
     * it will open.
     */
    expect(sheet).toContain("from('paid_sessions')");
    expect(sheet).toContain("select('member_id')");
    expect(sheet).toMatch(/if \(!wasTheMember\) \{\s*clearReview\(\);\s*return;\s*\}/);
    // Cleared, not parked: the store keeps the FIRST writer, so a pendingReview
    // stuck behind a read that never answers would swallow every later session.
    expect(sheet).toMatch(/if \(memberUnknown\) \{\s*clearReview\(\);\s*return;\s*\}/);
  });

  it('asks after the leave-and-end exit, which is the ordinary way out', () => {
    /*
     * The edge-watcher fires when `activeSession` crosses live -> null, which
     * needs the invalidated `get_active_session` to refetch. `confirmEnd` (the
     * End chip) leaves the member on screen, so it does. `confirmLeave` calls
     * `onBack()` inside the same `onSuccess` and unmounts the screen in that
     * tick — the edge is never observed. So the dominant exit from a chat ended
     * the session and never asked how it went. It now asks for itself.
     */
    expect(chatScreen).toContain('askReview(sessionId)');
    // Double-firing is already handled — the store keeps the first writer and
    // the sheet's ASKED set drops a repeat for the same id — so the watcher and
    // this call cannot produce two sheets when both do observe the same end.
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
