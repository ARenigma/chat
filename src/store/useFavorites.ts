import { create } from 'zustand';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { storage } from '../lib/storage';

/**
 * Saved favourites — cross-device, server-backed (migration 125).
 *
 * The MMKV store was replaced with Postgres so favourites survive reinstalls and
 * sync across devices. The local MMKV snapshot is still written on every toggle
 * as a read-through cache so the heart renders instantly without waiting for the
 * RPC round-trip.
 *
 * Both roles can favourite:
 *   member  → favourites providers  (the original direction)
 *   provider → favourites members   (new, 2026-09-20)
 */
const LOCAL_KEY = 'favorites.v1';

function loadLocal(): readonly string[] {
  const raw = storage.get(LOCAL_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

function saveLocal(ids: readonly string[]): void {
  storage.set(LOCAL_KEY, JSON.stringify([...ids]));
}

// ─── Local-optimistic store (fast UI sync) ──────────────────────────────────

interface FavoritesState {
  ids: readonly string[];
  toggle: (id: string) => void;
}

export const useFavorites = create<FavoritesState>((set, get) => ({
  ids: loadLocal(),
  toggle: id => {
    const current = get().ids;
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id];
    saveLocal(next);
    set({ ids: next });
  },
}));

// ─── Server-backed hooks (migration 125) ────────────────────────────────────

const favoriteKeys = {
  mine: ['my-favorites'] as const,
};

interface FavoriteRow {
  id: string;
  liked_id: string;
  liked_role: 'member' | 'provider';
  created_at: string;
}

/** Load the current user's server-side favourites and sync the MMKV cache. */
export function useServerFavorites() {
  return useQuery<FavoriteRow[]>({
    queryKey: favoriteKeys.mine,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)('get_my_favorites');
      if (error) throw new Error(error.message);
      const rows = (data as unknown as FavoriteRow[] | null) ?? [];
      // Keep MMKV in sync so `useFavorites.ids` is accurate even before the
      // query resolves on the next app open.
      const ids = rows.map(r => r.liked_id);
      saveLocal(ids);
      useFavorites.setState({ ids });
      return rows;
    },
  });
}

