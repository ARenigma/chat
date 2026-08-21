/**
 * The live conversation: one Realtime channel carrying three different kinds of
 * signal, because they have three different durabilities.
 *
 *   - `postgres_changes` on `messages` — durable. The message exists whether or
 *     not anyone is listening, so the socket is a delivery optimisation, not the
 *     source of truth. A missed event is recovered by the query refetching.
 *   - `presence` — connection-scoped. "Is the other person here right now."
 *     Nothing to persist: if the socket drops, the answer is genuinely no.
 *   - `broadcast` typing — sub-second and disposable. Never written down.
 *
 * Realtime enforces RLS on `postgres_changes`, so a client is only ever sent
 * rows it could have selected. That is why the channel does not filter by
 * participant itself: the database already will not send someone else's
 * conversation. The `conversation_id` filter below is bandwidth, not security.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Message } from '../lib/database.types';
import {
  applyReadReceipt,
  mergeIncoming,
  unreadFromPeer,
  type TranscriptMessage,
} from '../lib/transcript';
import { useStore } from '../store/useStore';

/** How long a typing broadcast keeps the indicator up without a refresh. */
const TYPING_TTL_MS = 4_000;
/** Minimum gap between outbound typing broadcasts, per keystroke burst. */
const TYPING_THROTTLE_MS = 1_500;

export const messagesKey = (conversationId: string) => ['messages', conversationId] as const;

interface TypingPayload {
  userId: string;
}

export interface LiveConversation {
  /** Call on every keystroke; throttled internally. */
  notifyTyping: () => void;
}

/**
 * Subscribes to a conversation and folds everything it receives into the
 * React Query cache, so the transcript has exactly one source of truth whether a
 * message arrived by refetch or by socket.
 */
export function useLiveConversation(
  conversationId: string | undefined,
  selfId: string | undefined,
): LiveConversation {
  const queryClient = useQueryClient();
  const setPeerTyping = useStore(s => s.setPeerTyping);
  const setPeerOnline = useStore(s => s.setPeerOnline);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (conversationId === undefined || selfId === undefined) {
      return;
    }

    let cancelled = false;
    const key = messagesKey(conversationId);

    const write = (
      fn: (list: readonly TranscriptMessage[]) => TranscriptMessage[],
    ): void => {
      queryClient.setQueryData<TranscriptMessage[]>(key, prev => fn(prev ?? []));
    };

    const channel = supabase.channel(`conversation:${conversationId}`, {
      config: {
        // Keying presence by profile id means a reconnect replaces the old entry
        // instead of appearing as a second participant.
        presence: { key: selfId },
        // Our own typing broadcast coming back to us would flicker the peer
        // indicator on our own keystrokes.
        broadcast: { self: false },
      },
    });

    channel
      .on<Message>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          write(list => mergeIncoming(list, payload.new, selfId));
          if (payload.new.sender_id !== selfId) {
            // A message is a stronger signal than the typing broadcast: they
            // sent it, so they have stopped typing.
            setPeerTyping(false);
          }
        },
      )
      .on<Message>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          const { id, read_at } = payload.new;
          if (read_at !== null) {
            write(list => applyReadReceipt(list, id, read_at));
          }
        },
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const from = (payload as TypingPayload | undefined)?.userId;
        if (from === undefined || from === selfId) {
          return;
        }
        setPeerTyping(true);
        if (typingTimerRef.current !== null) {
          clearTimeout(typingTimerRef.current);
        }
        typingTimerRef.current = setTimeout(() => setPeerTyping(false), TYPING_TTL_MS);
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setPeerOnline(Object.keys(state).some(id => id !== selfId));
      });

    void (async () => {
      // Realtime authorises `postgres_changes` against the caller's JWT, so the
      // socket has to be holding the current one before we subscribe. Without
      // this a token refresh can leave the channel authenticated as the previous
      // session and silently deliver nothing.
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (data.session?.access_token !== undefined) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ userId: selfId, at: new Date().toISOString() });
          // A socket that was down may have missed inserts. Refetching on
          // (re)subscribe is what makes a dropped connection self-healing.
          void queryClient.invalidateQueries({ queryKey: key });
        }
      });
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (typingTimerRef.current !== null) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      channelRef.current = null;
      setPeerTyping(false);
      setPeerOnline(false);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, selfId, queryClient, setPeerTyping, setPeerOnline]);

  return useMemo<LiveConversation>(
    () => ({
      notifyTyping: () => {
        const channel = channelRef.current;
        if (channel === null || selfId === undefined) {
          return;
        }
        const now = Date.now();
        if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) {
          return;
        }
        lastTypingSentRef.current = now;
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: selfId } satisfies TypingPayload,
        });
      },
    }),
    [selfId],
  );
}

/**
 * Marks the peer's messages read once they are on screen.
 *
 * Batched into one `in` filter rather than a write per message, and it only ever
 * touches `read_at` — the RLS policy rejects marking your own message read, and
 * a trigger rejects any other column, so this is the whole of what a client may
 * write to `messages`.
 */
export function useMarkRead(conversationId: string | undefined, selfId: string | undefined): void {
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (conversationId === undefined || selfId === undefined) {
      return;
    }
    const key = messagesKey(conversationId);

    const flush = (): void => {
      const list = queryClient.getQueryData<TranscriptMessage[]>(key) ?? [];
      const ids = unreadFromPeer(list, selfId).filter(id => !inFlightRef.current.has(id));
      if (ids.length === 0) {
        return;
      }
      ids.forEach(id => inFlightRef.current.add(id));
      void supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids)
        .then(({ error }) => {
          if (error) {
            // Left out of `inFlight` so a transient failure retries on the next
            // cache change rather than being swallowed for the session.
            ids.forEach(id => inFlightRef.current.delete(id));
          }
        });
    };

    flush();
    const unsubscribe = queryClient.getQueryCache().subscribe(event => {
      if (event.query.queryHash === JSON.stringify(key)) {
        flush();
      }
    });
    return unsubscribe;
  }, [conversationId, selfId, queryClient]);
}
