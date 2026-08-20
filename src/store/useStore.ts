import { create } from 'zustand';
import { isLowBalance } from '../lib/tokenLedger';

/**
 * Ephemeral UI state only — anything that survives a relaunch belongs to
 * React Query + Postgres. Deliberately flat, and deliberately narrow.
 *
 * This replaced the streaming state (`streamText`, `isStreaming`) when the chat
 * became human-to-human. The shape is not a rename: a model's reply arrived as a
 * growing string this store owned, whereas a person's reply arrives as a whole
 * row over Realtime and belongs to the React Query cache. What is left here is
 * only what Postgres does not store — whether the other person is typing, and
 * whether they are connected.
 */
export interface AppState {
  balance: number | null;
  /** A `send_message` RPC is in flight. Distinct from the peer typing. */
  sending: boolean;
  peerTyping: boolean;
  peerOnline: boolean;
  refillVisible: boolean;
  notice: string | null;

  setBalance: (balance: number | null) => void;
  setSending: (sending: boolean) => void;
  setPeerTyping: (typing: boolean) => void;
  setPeerOnline: (online: boolean) => void;
  openRefill: () => void;
  closeRefill: () => void;
  setNotice: (notice: string | null) => void;
  /** Leaving a conversation must not leak its presence into the next one. */
  resetConversation: () => void;
}

const INITIAL = {
  balance: null,
  sending: false,
  peerTyping: false,
  peerOnline: false,
  refillVisible: false,
  notice: null,
} satisfies Omit<
  AppState,
  | 'setBalance'
  | 'setSending'
  | 'setPeerTyping'
  | 'setPeerOnline'
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
  setPeerOnline: peerOnline => set({ peerOnline }),
  openRefill: () => set({ refillVisible: true }),
  closeRefill: () => set({ refillVisible: false }),
  setNotice: notice => set({ notice }),
  resetConversation: () =>
    set({ sending: false, peerTyping: false, peerOnline: false, notice: null }),
}));

/** Test helper; also used to reset state after account deletion. */
export function resetStore(): void {
  useStore.setState({ ...INITIAL });
}

/** Selectors — kept next to the store so components subscribe narrowly. */
export const selectBalance = (s: AppState): number | null => s.balance;
export const selectSending = (s: AppState): boolean => s.sending;
export const selectPeerTyping = (s: AppState): boolean => s.peerTyping;
export const selectPeerOnline = (s: AppState): boolean => s.peerOnline;
export const selectIsLow = (s: AppState): boolean => isLowBalance(s.balance);
