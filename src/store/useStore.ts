import { create } from 'zustand';
import { isLowBalance } from '../lib/tokenLedger';

/**
 * Ephemeral UI state only — anything that survives a relaunch belongs to
 * React Query + Postgres. Deliberately flat: the streaming text lives here so
 * exactly one subscriber (`StreamingBubble`) re-renders per frame while the
 * transcript's `FlatList` keeps a stable `data` reference and never re-renders.
 */
export interface AppState {
  balance: number | null;
  streamText: string;
  isStreaming: boolean;
  refillVisible: boolean;
  notice: string | null;

  setBalance: (balance: number | null) => void;
  beginStream: () => void;
  setStreamText: (text: string) => void;
  endStream: () => void;
  openRefill: () => void;
  closeRefill: () => void;
  setNotice: (notice: string | null) => void;
}

const INITIAL = {
  balance: null,
  streamText: '',
  isStreaming: false,
  refillVisible: false,
  notice: null,
} satisfies Omit<
  AppState,
  | 'setBalance'
  | 'beginStream'
  | 'setStreamText'
  | 'endStream'
  | 'openRefill'
  | 'closeRefill'
  | 'setNotice'
>;

export const useStore = create<AppState>()(set => ({
  ...INITIAL,

  setBalance: balance => set({ balance }),
  beginStream: () => set({ isStreaming: true, streamText: '', notice: null }),
  setStreamText: text => set({ streamText: text }),
  endStream: () => set({ isStreaming: false, streamText: '' }),
  openRefill: () => set({ refillVisible: true }),
  closeRefill: () => set({ refillVisible: false }),
  setNotice: notice => set({ notice }),
}));

/** Test helper; also used to reset state after account deletion. */
export function resetStore(): void {
  useStore.setState({ ...INITIAL });
}

/** Selectors — kept next to the store so components subscribe narrowly. */
export const selectBalance = (s: AppState): number | null => s.balance;
export const selectStreamText = (s: AppState): string => s.streamText;
export const selectIsStreaming = (s: AppState): boolean => s.isStreaming;
export const selectIsLow = (s: AppState): boolean => isLowBalance(s.balance);
