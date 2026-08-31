import { create } from 'zustand';
import { storage } from '../lib/storage';
import type { RailPrefs } from '../lib/railPrefs';

export type { RailPrefs } from '../lib/railPrefs';
export {
  compareConversations,
  isPinned,
  visibleOnList,
  visibleOnRail,
} from '../lib/railPrefs';

/**
 * Local conversation chrome: pin, hide-from-rail, delete-from-lists.
 *
 * Not Postgres. Pin and rail-hide are this-device layout. Delete means gone
 * from my lists on this device; the other person's view is unchanged.
 * Remove ≠ delete: Remove drops the face from the Home rail only.
 */
const KEY = 'railPrefs.v1';

const EMPTY: RailPrefs = { pinned: [], hiddenFromRail: [], deleted: [] };

function load(): RailPrefs {
  const raw = storage.get(KEY);
  if (raw === null) {
    return EMPTY;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return EMPTY;
    }
    const rec = parsed as Record<string, unknown>;
    const ids = (v: unknown): readonly string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    return {
      pinned: ids(rec.pinned),
      hiddenFromRail: ids(rec.hiddenFromRail),
      deleted: ids(rec.deleted),
    };
  } catch {
    return EMPTY;
  }
}

function persist(next: RailPrefs): void {
  storage.set(KEY, JSON.stringify(next));
}

function toggleIn(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

interface RailPrefsState extends RailPrefs {
  togglePin: (peerId: string) => void;
  hideFromRail: (peerId: string) => void;
  unhideFromRail: (peerId: string) => void;
  deleteLocal: (peerId: string) => void;
}

export const useRailPrefs = create<RailPrefsState>((set, get) => ({
  ...load(),
  togglePin: peerId => {
    const next = { ...get(), pinned: toggleIn(get().pinned, peerId) };
    persist(next);
    set(next);
  },
  hideFromRail: peerId => {
    const hiddenFromRail = get().hiddenFromRail.includes(peerId)
      ? get().hiddenFromRail
      : [...get().hiddenFromRail, peerId];
    const next = { ...get(), hiddenFromRail };
    persist(next);
    set(next);
  },
  unhideFromRail: peerId => {
    const next = {
      ...get(),
      hiddenFromRail: get().hiddenFromRail.filter(id => id !== peerId),
    };
    persist(next);
    set(next);
  },
  deleteLocal: peerId => {
    const deleted = get().deleted.includes(peerId)
      ? get().deleted
      : [...get().deleted, peerId];
    const next = {
      ...get(),
      deleted,
      pinned: get().pinned.filter(id => id !== peerId),
      hiddenFromRail: get().hiddenFromRail.filter(id => id !== peerId),
    };
    persist(next);
    set(next);
  },
}));
