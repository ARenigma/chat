import { create } from 'zustand';
import { isLowBalance } from '../lib/tokenLedger';

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
export type NoticeTone = 'error' | 'confirm';

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
export interface PlayingVoice {
  messageId: string;
  positionMs: number;
  durationMs: number;
  pending: boolean;
}

export interface AppState {
  balance: number | null;
  /** A `send_message` RPC is in flight. Distinct from the peer typing. */
  sending: boolean;
  peerTyping: boolean;
  refillVisible: boolean;
  /** Full-page Recharge, opened only from the wallet pill. */
  walletVisible: boolean;
  /**
   * A session that just ended and has not been rated yet (goal item 14).
   *
   * Lives in the store rather than in ChatScreen because a session can end
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
  incomingRequest: {
    requestId: string;
    conversationId: string;
    peerId: string;
    peerName: string;
  } | null;
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

  setBalance: (balance: number | null) => void;
  setSending: (sending: boolean) => void;
  setPeerTyping: (typing: boolean) => void;
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
  clearIncomingRequest: () => void;
  openWallet: () => void;
  closeWallet: () => void;
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
  /** Leaving a conversation must not leak its presence into the next one. */
  resetConversation: () => void;
}

const INITIAL = {
  balance: null,
  sending: false,
  peerTyping: false,
  refillVisible: false,
  walletVisible: false,
  pendingReview: null,
  incomingRequest: null,
  notice: null,
  noticeTone: 'error' as NoticeTone,
  playing: null,
  uploadProgress: {} as Record<string, number>,
  pendingProviderApply: false,
} satisfies Omit<
  AppState,
  | 'setBalance'
  | 'setSending'
  | 'setPeerTyping'
  | 'setPlaying'
  | 'openRefill'
  | 'closeRefill'
  | 'requestReview'
  | 'clearReview'
  | 'setIncomingRequest'
  | 'clearIncomingRequest'
  | 'openWallet'
  | 'closeWallet'
  | 'setNotice'
  | 'setPendingProviderApply'
  | 'setUploadProgress'
  | 'clearUploadProgress'
  | 'resetConversation'
>;

export const useStore = create<AppState>()(set => ({
  ...INITIAL,

  setBalance: balance => set({ balance }),
  setSending: sending => set({ sending }),
  setPeerTyping: peerTyping => set({ peerTyping }),
  setPlaying: playing => set({ playing }),
  openRefill: () => set({ refillVisible: true, walletVisible: false }),
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
   * the provider is deciding must not swap the face under their thumb.
   */
  setIncomingRequest: request =>
    set(state => (state.incomingRequest === null ? { incomingRequest: request } : state)),
  clearIncomingRequest: () => set({ incomingRequest: null }),
  openWallet: () => set({ walletVisible: true, refillVisible: false }),
  closeWallet: () => set({ walletVisible: false }),
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
  resetConversation: () =>
    set({ sending: false, peerTyping: false, notice: null, playing: null, uploadProgress: {} }),
}));

/** Test helper; also used to reset state after account deletion. */
export function resetStore(): void {
  useStore.setState({ ...INITIAL });
}

/** Selectors, kept next to the store so components subscribe narrowly. */
export const selectBalance = (s: AppState): number | null => s.balance;
export const selectSending = (s: AppState): boolean => s.sending;
export const selectPeerTyping = (s: AppState): boolean => s.peerTyping;
export const selectIsLow = (s: AppState): boolean => isLowBalance(s.balance);
export const selectUploadProgress =
  (id: string) =>
  (s: AppState): number | undefined =>
    s.uploadProgress[id];
