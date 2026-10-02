/**
 * Pushed provider presence for members (migration 182).
 *
 * `provider_presence` is a real table (not a view), so Supabase Realtime can
 * push postgres_changes events when a provider transitions online↔offline.
 * Members mount `useProviderPresenceStream` once; it patches TanStack caches
 * in place so the UI updates instantly without waiting for the next poll.
 *
 * The existing polls on `useProviders`, `useConversations` and
 * `usePeerPresence` remain, relaxed to 60 s, as the safety-net fallback:
 * a missed realtime event heals itself within one poll cycle instead of the
 * previous 15–30 s.
 *
 * Architecture note: Realtime enforces RLS on postgres_changes, so a member
 * only receives rows they could have selected — blocked providers are hidden
 * at the socket level, not just filtered client-side.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { keys } from './chat';
import type {
  ConversationSummary,
  ProviderPresenceChange,
  ProviderSummary,
} from '../lib/database.types';
import type { PeerPresenceRow } from './chat';

// ---------------------------------------------------------------------------
// Pure cache-patching reducers — extracted for unit testing.
// ---------------------------------------------------------------------------

/**
 * Returns a new providers list with the matching provider's online and
 * last_seen_at fields replaced by the pushed values. No-ops if the id is not
 * found or the list is undefined.
 */
export function applyPresenceToProviders(
  list: ProviderSummary[] | undefined,
  change: ProviderPresenceChange,
): ProviderSummary[] | undefined {
  if (list === undefined) return undefined;
  return list.map(p =>
    p.id === change.provider_id
      ? { ...p, online: change.online, last_seen_at: change.last_seen_at }
      : p,
  );
}

/**
 * Returns a new conversation-list with every row whose peer_id matches the
 * provider patched with the pushed online / last_seen_at values. No-ops if
 * the id is not found or the list is undefined.
 */
export function applyPresenceToConversations(
  list: ConversationSummary[] | undefined,
  change: ProviderPresenceChange,
): ConversationSummary[] | undefined {
  if (list === undefined) return undefined;
  return list.map(c =>
    c.peer_id === change.provider_id
      ? { ...c, peer_online: change.online, peer_last_seen_at: change.last_seen_at }
      : c,
  );
}

/**
 * Returns a new peer-presence row with the pushed online / last_seen_at values.
 * Passes null and undefined through unchanged (null is a real answer: the
 * thread was removed; undefined means not yet loaded).
 */
export function applyPresenceToPeer(
  current: PeerPresenceRow | null | undefined,
  change: ProviderPresenceChange,
): PeerPresenceRow | null | undefined {
  if (current == null) return current;
  return {
    ...current,
    peer_online: change.online,
    peer_last_seen_at: change.last_seen_at,
  };
}

// ---------------------------------------------------------------------------
// The stream hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to `postgres_changes` on `public.provider_presence` and patches
 * three TanStack query caches in place whenever a provider transitions
 * online/offline:
 *
 *   - `keys.providers`               — online + last_seen_at per provider
 *   - `keys.conversationList`        — peer_online + peer_last_seen_at per thread
 *   - `['peer-presence', convId]`    — the open chat's peer row
 *
 * On SUBSCRIBED (including reconnect) all three key groups are invalidated
 * once so missed events during a socket outage heal within one refetch.
 *
 * Only active when `enabled` is true (caller passes `role === 'member'`).
 * A provider's own presence is written, not received here.
 *
 * Realtime enforces RLS on postgres_changes, so blocked providers are
 * filtered at the socket level and never reach this handler.
 */
export function useProviderPresenceStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const channel = supabase.channel('provider-presence-stream');

    channel.on<ProviderPresenceChange>(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'provider_presence',
      },
      payload => {
        // Both INSERT (first-time row, e.g. after backfill or first heartbeat)
        // and UPDATE (transition) carry the new row.
        const change = payload.new as ProviderPresenceChange;
        if (!change?.provider_id) return;

        // Patch providers cache.
        queryClient.setQueryData<ProviderSummary[]>(
          keys.providers,
          prev => applyPresenceToProviders(prev, change),
        );

        // Patch conversation-list cache.
        queryClient.setQueryData<ConversationSummary[]>(
          keys.conversationList,
          prev => applyPresenceToConversations(prev, change),
        );

        // Patch the open chat's peer-presence query, if any.
        // Find which conversation(s) have this provider as the peer.
        const conversations =
          queryClient.getQueryData<ConversationSummary[]>(keys.conversationList);
        const conversationIds = (conversations ?? [])
          .filter(c => c.peer_id === change.provider_id)
          .map(c => c.conversation_id);

        for (const convId of conversationIds) {
          queryClient.setQueryData<PeerPresenceRow | null>(
            ['peer-presence', convId],
            prev => applyPresenceToPeer(prev, change),
          );
        }
      },
    );

    void (async () => {
      // Ensure the realtime socket holds the current JWT before subscribing —
      // same pattern as useLiveConversation in realtime.ts.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.access_token !== undefined) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;

      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          // Invalidate all three key groups on (re)connect so any events
          // missed while the socket was down heal within the next refetch.
          // Push-primary/poll-fallback: the poll is the heal path.
          void queryClient.invalidateQueries({ queryKey: keys.providers });
          void queryClient.invalidateQueries({ queryKey: keys.conversationList });
          void queryClient.invalidateQueries({ queryKey: ['peer-presence'] });
        }
      });
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
