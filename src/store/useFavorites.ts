import { create } from 'zustand';
import { storage } from '../lib/storage';

/**
 * Saved favourites — provider ids the member has hearted.
 *
 * Its own store, not the ephemeral `useStore` (which is UI-only by contract) and
 * not Postgres (a favourites table is a follow-up when it needs to sync across
 * devices). It persists to MMKV so a heart survives a relaunch, which is the
 * whole point of the question "where are they saved". Hydrated once at module
 * load; every toggle writes through synchronously.
 */
const KEY = 'favorites.v1';

function load(): readonly string[] {
  const raw = storage.get(KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface FavoritesState {
  ids: readonly string[];
  toggle: (id: string) => void;
}

export const useFavorites = create<FavoritesState>((set, get) => ({
  ids: load(),
  toggle: id => {
    const current = get().ids;
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id];
    storage.set(KEY, JSON.stringify(next));
    set({ ids: next });
  },
}));
