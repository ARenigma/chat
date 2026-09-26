/**
 * "Busy, wait ~N m" on the provider card (owner decision 2026-09-27,
 * migration 154).
 *
 * One RPC per poll for the whole visible directory, not one per row and not a
 * JS timer per card: the minutes are server-derived (the balance-limited
 * remaining time of the session the provider is in) and only the server can
 * compute them honestly, so the client re-reads rather than counting down.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { ProviderBusyWait } from '../lib/database.types';
import {
  NO_BUSY_WAITS,
  busyWaitIds,
  busyWaitsToMap,
  chunkBusyWaitIds,
  type BusyWaits,
} from '../lib/busyWaits';

export { withBusyWaits, type BusyWaits } from '../lib/busyWaits';

/** The directory's poll, so busy state and the list it decorates move together. */
const BUSY_WAITS_POLL_MS = 30_000;

export const busyWaitsKey = (ids: readonly string[]) =>
  ['providers', 'busy', ids.join(',')] as const;

async function fetchBusyWaits(ids: readonly string[]): Promise<ProviderBusyWait[]> {
  const pages = await Promise.all(
    chunkBusyWaitIds(ids).map(async chunk => {
      const { data, error } = await supabase.rpc('provider_busy_waits', {
        p_provider_ids: chunk,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data ?? [];
    }),
  );
  return pages.flat();
}

/**
 * providerId -> wait minutes (or null for "Busy" with no estimate), for the
 * given directory ids. A provider absent from the map is not in a session.
 *
 * `focused` is the screen's focus, e.g. react-navigation's `useIsFocused()`.
 * It maps to TanStack's `subscribed`, so a screen underneath another stops
 * polling (https://tanstack.com/query/latest/docs/framework/react/react-native,
 * "Disable queries on out of focus screens"). The app-background pause and the
 * refetch on return come from AppState wired to `focusManager` in App.tsx,
 * with `refetchIntervalInBackground: false`, as `useProviders` relies on.
 *
 * Until the first answer, and after a failure with nothing cached, the map is
 * empty: every card reads as not busy, which is what the directory showed
 * before this existed.
 */
export function useProviderBusyWaits(
  ids: readonly string[],
  { focused = true }: { focused?: boolean } = {},
): BusyWaits {
  const sorted = useMemo(() => busyWaitIds(ids), [ids]);

  const query = useQuery({
    queryKey: busyWaitsKey(sorted),
    queryFn: () => fetchBusyWaits(sorted),
    select: busyWaitsToMap,
    enabled: sorted.length > 0,
    subscribed: focused,
    staleTime: 15_000,
    refetchInterval: BUSY_WAITS_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return query.data ?? NO_BUSY_WAITS;
}
