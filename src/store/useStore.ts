import { create } from 'zustand';
import { isLowBalance } from '../lib/tokenLedger';
import type { ActiveCall } from '../lib/routes/actions';

/**
 * Ephemeral UI state only, anything that survives a relaunch belongs to
 * React Query + Postgres. Deliberately flat, and deliberately narrow.
 *
 * This replaced the streaming state (`streamText`, `isStreaming`) when the chat
 * became human-to-human. The shape is not a rename: a model's reply arrived as a
 * growing string this store owned, whereas a person's reply arrives as a whole
 * row over Realtime and belongs to the React Query cache. What is left here is
 * only what Postgres does not store, whether the other person is typing, and
 * whether they are connected.
 */
/**
 * What a notice *is*, so it can be styled honestly.
 *
 * There was one channel and one appearance: a red-bordered bar. Which meant
 * "Blocked. They can no longer message you.", "Reported.", "Application
 * submitted." and "Thanks, that helps the next person choose." all arrived
 * looking like failures. Seen on a device right after submitting a rating: a
 * thank-you inside an error box.
 */
type NoticeTone = 'error' | 'confirm';

/**
 * Which voice note is playing, and how far in.
 *
 * One value rather than per-row state, because the recorder exposes a single
 * player object: starting note B stops note A whether or not anything asked it
 * to, so two rows believing they are both playing is not a state the hardware
 * can be in. `pending` covers the gap between the tap and the first audio, which
 * on a slow connection is long enough that a play button with no pending state
 * looks broken.
 */
interface PlayingVoice {
  messageId: string;
  positionMs: number;
  durationMs: number;
  pending: boolean;
}

/** What a peer is doing in the composer, mirrored from their device. */
export type PeerActivity = 'typing' | 'recording';

/**
 * A peer activity and the conversation it was heard in.
 *
 * Tagged since navigation step 6 (nav-migration §5): under the navigator two
 * chats can be mounted at once, one per tab, and an untagged "typing" would
 * light the header of whichever chat read it. `conversationId` is null only
 * when a writer does not know its thread yet.
 */
interface PeerActivityState {
  kind: PeerActivity;
  conversationId: string | null;
}

/** A chat request as the ring shows it.
 * @public Also read by the tests.
 */
export interface IncomingRequest {
  requestId: string;
  conversationId: string;
  peerId: string;
  peerName: string;
  /**
   * Local receipt time plus CHAT_RING_SECONDS (ms timestamp). Using the local
   * clock rather than the server's `expires_at` avoids device/server skew
   * lengthening or shortening the ring. nav-migration §3 (A8).
   */
  expiresAt: number;
  /**
   * The row's server `created_at`, the same instant as the member message that
   * opened it (077). What a Decline is anchored to, so the late push of that
   * message is recognised by server time on both sides, never this device's
   * clock (Greptile P1 on 6bb4114).
   */
  createdAt?: string;
}

interface AppState {
  balance: number | null;
  /** A `send_message` RPC is in flight. Distinct from the peer typing. */
  sending: boolean;
  /**
   * What the peer is DOING, not merely whether they are doing something.
   *
   * A boolean until 2026-09-17. the reference app carries the distinction on the wire as
   * separate actions and renders separate copy for each
   * (TL_sendMessageTypingAction vs TL_sendMessageRecordAudioAction,
   * MessagesController.java:11210-11213), and it matters here for the same
   * reason: this app has voice notes, and "typing" is simply untrue while
   * somebody is holding the mic.
   */
  peerActivity: PeerActivityState | null;
  refillVisible: boolean;
  /**
   * A session that just ended and has not been rated yet (goal item 14).
   *
   * Lives in the store rather than in the chat screen because a session can end
   * anywhere: a chat, a call started from the provider's page, or the server
   * ending it when the balance runs out. Whoever notices sets this; ONE sheet
   * at the App level renders it. `peerName` is carried along because the sheet
   * may outlive the screen that knew it.
   */
  pendingReview: { sessionId: string; peerName: string } | null;
  /**
   * A chat request ringing at this provider right now (goal item 13).
   *
   * In the store for the same reason `pendingReview` is: the ring has to cover
   * whatever screen the provider is on, and it arrives from a realtime
   * subscription that belongs to the app, not to a screen.
   */
  incomingRequest: IncomingRequest | null;
  /**
   * Requests that arrived while another was ringing, oldest first. Each rings
   * in turn once the one before it leaves (`clearIncomingRequest`).
   */
  queuedRequests: readonly IncomingRequest[];
  /**
   * Every request id that has rung in this session, for `setIncomingRequest`
   * to refuse a second ring of. Cleared with the account (`resetStore`).
   */
  rungRequestIds: readonly string[];
  notice: string | null;
  noticeTone: NoticeTone;
  playing: PlayingVoice | null;
  /**
   * M3 linear-determinate progress for media uploads, keyed by the pending
   * message id (PENDING_PREFIX + timestamp).  Fraction 0–1 while an XHR upload
   * is in flight; key is absent before the first progress event and after settle.
   *
   * Policy: https://m3.material.io/components/progress-indicators/guidelines —
   * determinate when the fraction is known (upload bytes), indeterminate when
   * not (e.g. minting a signed URL after the upload completes).
   */
  uploadProgress: Record<string, number>;
  /**
   * Set before triggering Google sign-in from the "Become a partner" link.
   * Cleared in App.tsx once the member tree mounts and the route is set.
   */
  pendingProviderApply: boolean;
  /**
   * The call on screen right now. Set synchronously when the Call route is
   * dispatched; cleared owner-checked on unmount. Prevents a second incoming
   * ring from being routed over a live call, and holds other intents until the
   * call ends. nav-migration §3.
   */
  activeCall: ActiveCall | null;

  setBalance: (balance: number | null) => void;
  setSending: (sending: boolean) => void;
  /**
   * Sets or clears the peer activity for `conversationId`. A clear that names
   * a conversation is OWNER-CHECKED: it leaves another conversation's activity
   * alone. A clear that names none clears whatever is there.
   */
  setPeerActivity: (activity: PeerActivity | null, conversationId?: string | null) => void;
  /**
   * Replaces rather than merges. A position update for a note that is no longer
   * the active one is a late callback from the player that has just been stopped,
   * and merging it would move the playhead on the row that took over.
   */
  setPlaying: (playing: PlayingVoice | null) => void;
  openRefill: () => void;
  closeRefill: () => void;
  requestReview: (sessionId: string, peerName: string) => void;
  clearReview: () => void;
  setIncomingRequest: (request: AppState['incomingRequest']) => void;
  /**
   * Owner-checked: clears only when `requestId` is still the ringing request.
   * Promotes the next queued request that has not expired.
   */
  clearIncomingRequest: (requestId: string) => void;
  /**
   * Tone defaults to `error` because most notices are failures and a failure
   * mis-styled as a confirmation is the worse of the two mistakes.
   */
  setNotice: (notice: string | null, tone?: NoticeTone) => void;
  setPendingProviderApply: (pending: boolean) => void;
  /**
   * Record a 0–1 upload fraction for a pending message.  Called from XHR
   * `upload.onprogress` so the bubble can render a determinate ProgressBar.
   */
  setUploadProgress: (id: string, fraction: number) => void;
  /** Remove the entry once the upload settles (success or failure). */
  clearUploadProgress: (id: string) => void;
  /**
   * Leaving a conversation must not leak its presence into the next one.
   *
   * `conversationId` (navigation step 6) makes the peer-activity part
   * owner-checked, so a chat unmounting in one tab cannot wipe the typing
   * indicator of a chat still mounted in another. The rest (send state,
   * notice, playhead, upload progress) is not per-conversation and clears as
   * before. With no id, everything clears, which is what the old tree's
   * leave paths still call.
   */
  resetConversation: (conversationId?: string) => void;
  /**
   * Mark a call as active. Returns the sequence number for owner-checked
   * `setActiveCallId` and `endActiveCall`. nav-migration §3.
   */
  beginCall: (c: Omit<ActiveCall, 'seq'>) => number;
  /** Update the callId once `start_call` returns. Owner-checked by `seq`. */
  setActiveCallId: (seq: number, callId: string) => void;
  /** Clear `activeCall`. Owner-checked: ignored when `seq` does not match. */
  endActiveCall: (seq: number) => void;
}

// Monotonically increasing sequence number for owner-checking call state.
// Module-level so `beginCall` can return it without threading state through set.
let _nextCallSeq = 0;

const INITIAL = {
  balance: null,
  sending: false,
  peerActivity: null,
  refillVisible: false,
  pendingReview: null,
  incomingRequest: null,
  queuedRequests: [] as readonly IncomingRequest[],
  rungRequestIds: [] as readonly string[],
  notice: null,
  noticeTone: 'error' as NoticeTone,
  playing: null,
  uploadProgress: {} as Record<string, number>,
  pendingProviderApply: false,
  activeCall: null,
} satisfies Omit<
  AppState,
  | 'setBalance'
  | 'setSending'
  | 'setPeerActivity'
  | 'setPlaying'
  | 'openRefill'
  | 'closeRefill'
  | 'requestReview'
  | 'clearReview'
  | 'setIncomingRequest'
  | 'clearIncomingRequest'
  | 'setNotice'
  | 'setPendingProviderApply'
  | 'setUploadProgress'
  | 'clearUploadProgress'
  | 'resetConversation'
  | 'beginCall'
  | 'setActiveCallId'
  | 'endActiveCall'
>;

export const useStore = create<AppState>()(set => ({
  ...INITIAL,

  setBalance: balance => set({ balance }),
  setSending: sending => set({ sending }),
  setPeerActivity: (activity, conversationId) =>
    set(state => {
      if (activity !== null) {
        return { peerActivity: { kind: activity, conversationId: conversationId ?? null } };
      }
      return ownsPeerActivity(state.peerActivity, conversationId) ? { peerActivity: null } : state;
    }),
  setPlaying: playing => set({ playing }),
  /*
   * The refill sheet alone. Its exclusion with the wallet page is kept by
   * `openRefill` in src/lib/routes/actions.ts, which closes the `Wallet` route
   * first: the page is a route since navigation step 7, not a store flag.
   */
  openRefill: () => set({ refillVisible: true }),
  closeRefill: () => set({ refillVisible: false }),
  /*
   * First writer wins: if a call and its chat both notice the same session
   * ending, the second call must not replace a sheet the member is already
   * looking at (or re-open one they just dismissed).
   */
  requestReview: (sessionId, peerName) =>
    set(state =>
      state.pendingReview === null ? { pendingReview: { sessionId, peerName } } : state,
    ),
  clearReview: () => set({ pendingReview: null }),
  /*
   * First ring wins, like the review sheet: a second request arriving while
   * the provider is deciding must not swap the face under their thumb. It is
   * queued, not dropped. Dropped, it was only ever a silent shade entry
   * (`foregroundPushAction` posts everything silently while a ring is up),
   * and nothing rang it when the first ring ran out or was accepted: a member
   * waiting with no announcement at all. Once per request id, since the
   * Realtime insert and `recoverPending` can both deliver the same one.
   *
   * Once per id for the SESSION, not only while it rings or waits: a request
   * that has already rung and left (answered, declined, run out) is refused
   * too. `recoverPending` runs on every resubscribe, and a request the
   * provider answered stays `pending` until the member confirms (086 sets
   * only `responded_at`), so it came back and rang again, where a Decline
   * then turned an answered request into a declined one.
   */
  setIncomingRequest: request =>
    set(state => {
      if (request === null) {
        return state;
      }
      const known =
        state.rungRequestIds.includes(request.requestId) ||
        state.queuedRequests.some(queued => queued.requestId === request.requestId);
      if (known) {
        return state;
      }
      // A request delivered after it expired (a late Realtime INSERT after a
      // reconnect) never rings: it would hold the ring slot for a dead request
      // and queue a live one behind it. The queue already drops expired ones.
      if (request.expiresAt <= Date.now()) {
        return state;
      }
      if (state.incomingRequest === null) {
        return {
          incomingRequest: request,
          rungRequestIds: [...state.rungRequestIds, request.requestId],
        };
      }
      return { queuedRequests: [...state.queuedRequests, request] };
    }),
  /*
   * Owner-checked: only clears when `requestId` is still the ringing request,
   * so a late callback from a request that already left cannot end the ring
   * that replaced it. The oldest queued request that has not expired rings next.
   */
  clearIncomingRequest: requestId =>
    set(state => {
      if (state.incomingRequest?.requestId !== requestId) {
        return state;
      }
      const now = Date.now();
      const live = state.queuedRequests.filter(queued => queued.expiresAt > now);
      const next = live[0] ?? null;
      return {
        incomingRequest: next,
        queuedRequests: live.slice(1),
        rungRequestIds: next === null ? state.rungRequestIds : [...state.rungRequestIds, next.requestId],
      };
    }),
  setNotice: (notice, tone = 'error') => set({ notice, noticeTone: tone }),
  setPendingProviderApply: pending => set({ pendingProviderApply: pending }),
  setUploadProgress: (id, fraction) =>
    set(s => ({ uploadProgress: { ...s.uploadProgress, [id]: fraction } })),
  clearUploadProgress: id =>
    set(s => {
      const { [id]: _dropped, ...rest } = s.uploadProgress;
      return { uploadProgress: rest };
    }),
  // `playing` goes with it: audio from the thread you just left should not keep
  // playing over the next one, and the marker has to clear with the sound.
  resetConversation: conversationId =>
    set(state => ({
      sending: false,
      peerActivity: ownsPeerActivity(state.peerActivity, conversationId)
        ? null
        : state.peerActivity,
      notice: null,
      playing: null,
      uploadProgress: {},
    })),

  beginCall: c => {
    const seq = _nextCallSeq++;
    set({ activeCall: { seq, ...c } });
    return seq;
  },
  setActiveCallId: (seq, callId) =>
    set(state =>
      state.activeCall?.seq === seq && state.activeCall !== null
        ? { activeCall: { ...state.activeCall, callId } }
        : state,
    ),
  endActiveCall: seq =>
    set(state => (state.activeCall?.seq === seq ? { activeCall: null } : state)),
}));

/**
 * Whether a clear from `conversationId` may clear `current`. An unnamed clear
 * always may; a named one only clears its own conversation's activity or an
 * untagged one.
 */
function ownsPeerActivity(
  current: PeerActivityState | null,
  conversationId: string | null | undefined,
): boolean {
  if (current === null || conversationId === undefined || conversationId === null) {
    return true;
  }
  return current.conversationId === null || current.conversationId === conversationId;
}

/** Test helper; also used to reset state after account deletion. */
export function resetStore(): void {
  useStore.setState({ ...INITIAL });
}

export const selectPeerActivity = (s: AppState): PeerActivity | null =>
  s.peerActivity?.kind ?? null;
/**
 * The activity as one conversation should show it: another conversation's
 * activity reads as nothing. Readers under the navigator use this, because two
 * chats can be mounted at once.
 */
export const selectPeerActivityIn =
  (conversationId: string | undefined) =>
  (s: AppState): PeerActivity | null => {
    const a = s.peerActivity;
    if (a === null) {
      return null;
    }
    return a.conversationId === null || a.conversationId === conversationId ? a.kind : null;
  };
export const selectIsLow = (s: AppState): boolean => isLowBalance(s.balance);
