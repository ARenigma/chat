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
  notice: string | null;
  noticeTone: NoticeTone;
  playing: PlayingVoice | null;

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
  /**
   * Tone defaults to `error` because most notices are failures and a failure
   * mis-styled as a confirmation is the worse of the two mistakes.
   */
  setNotice: (notice: string | null, tone?: NoticeTone) => void;
  /** Leaving a conversation must not leak its presence into the next one. */
  resetConversation: () => void;
}

const INITIAL = {
  balance: null,
  sending: false,
  peerTyping: false,
  refillVisible: false,
  notice: null,
  noticeTone: 'error' as NoticeTone,
  playing: null,
} satisfies Omit<
  AppState,
  | 'setBalance'
  | 'setSending'
  | 'setPeerTyping'
  | 'setPlaying'
  | 'openRefill'
  | 'closeRefill'
  | 'setNotice'
  | 'resetConversation'
>;

export const useStore = create<AppState>()(set => ({
  ...INITIAL,

  setBalance: balance => set({ balance }),
  setSending: sending => set({ sending }),
  setPeerTyping: peerTyping => set({ peerTyping }),
  setPlaying: playing => set({ playing }),
  openRefill: () => set({ refillVisible: true }),
  closeRefill: () => set({ refillVisible: false }),
  setNotice: (notice, tone = 'error') => set({ notice, noticeTone: tone }),
  // `playing` goes with it: audio from the thread you just left should not keep
  // playing over the next one, and the marker has to clear with the sound.
  resetConversation: () =>
    set({ sending: false, peerTyping: false, notice: null, playing: null }),
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
